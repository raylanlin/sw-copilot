// src/main/com/context-collector.ts
//
// 从当前打开的 SolidWorks 文档中采集上下文信息。
// 采集的信息会注入到 AI 的 system prompt 中，
// 让 AI 知道用户当前在操作什么文件、有哪些特征和尺寸。
//
// 所有 COM 调用都 try-catch 包裹，采集失败不影响主流程。

import type { SolidWorksBridge } from './sw-bridge';

export interface SWDocumentContext {
  /** 文件名（不含路径） */
  fileName: string;
  /** 完整路径 */
  filePath: string;
  /** 文档类型 */
  docType: 'part' | 'assembly' | 'drawing';
  /** SolidWorks 版本 */
  swVersion?: string;
  /** 活动配置名称 */
  activeConfiguration?: string;
  /** 特征树（名称 + 类型），最多 50 个 */
  features: Array<{ name: string; type: string; suppressed: boolean }>;
  /** 尺寸列表（名称 + 当前值 mm），最多 30 个 */
  dimensions: Array<{ fullName: string; value: number }>;
  /** 自定义属性 */
  customProperties: Record<string, string>;
  /** 装配体组件列表（仅装配体），最多 50 个 */
  components?: Array<{ name: string; fileName: string; suppressed: boolean }>;
  /** 材料名称（仅零件） */
  material?: string;
}

/**
 * 从当前活动文档采集上下文。
 * 如果没有打开文档或 SolidWorks 未连接，返回 null。
 */
export function collectDocumentContext(bridge: SolidWorksBridge): SWDocumentContext | null {
  if (!bridge.isConnected()) return null;

  const swApp = bridge.getRawApp();
  if (!swApp) return null;

  const doc = bridge.getActiveDocument();
  if (!doc) return null;

  const docTypeNum = safeCall(() => doc.GetType(), 0);
  const docType = docTypeNum === 1 ? 'part' : docTypeNum === 2 ? 'assembly' : docTypeNum === 3 ? 'drawing' : null;
  if (!docType) return null;

  const filePath = safeCall(() => doc.GetPathName(), '') as string;
  const fileName = filePath ? filePath.split('\\').pop() || filePath : '(未保存)';

  const ctx: SWDocumentContext = {
    fileName,
    filePath,
    docType,
    swVersion: bridge.getVersion(),
    activeConfiguration: safeCall(() => doc.ConfigurationManager?.ActiveConfiguration?.Name, undefined),
    features: collectFeatures(doc),
    dimensions: collectDimensions(doc),
    customProperties: collectCustomProperties(doc),
  };

  // 零件特有信息
  if (docType === 'part') {
    ctx.material = safeCall(() => doc.GetMaterialPropertyName2('', ''), undefined);
  }

  // 装配体特有信息
  if (docType === 'assembly') {
    ctx.components = collectComponents(doc);
  }

  return ctx;
}

/**
 * 将上下文格式化为可嵌入 system prompt 的文本。
 */
export function formatContextForPrompt(ctx: SWDocumentContext): string {
  const lines: string[] = [
    `## 当前 SolidWorks 文档信息`,
    `- 文件: ${ctx.fileName}`,
    `- 类型: ${ctx.docType === 'part' ? '零件' : ctx.docType === 'assembly' ? '装配体' : '工程图'}`,
  ];

  if (ctx.activeConfiguration) {
    lines.push(`- 活动配置: ${ctx.activeConfiguration}`);
  }
  if (ctx.material) {
    lines.push(`- 材料: ${ctx.material}`);
  }
  if (ctx.swVersion) {
    lines.push(`- SolidWorks 版本: ${ctx.swVersion}`);
  }

  // 特征树
  if (ctx.features.length > 0) {
    lines.push('', '### 特征树');
    for (const f of ctx.features) {
      const sup = f.suppressed ? ' [已压缩]' : '';
      lines.push(`- ${f.name} (${f.type})${sup}`);
    }
    if (ctx.features.length >= 50) {
      lines.push('- ... (超过 50 个，已截断)');
    }
  }

  // 尺寸
  if (ctx.dimensions.length > 0) {
    lines.push('', '### 主要尺寸');
    for (const d of ctx.dimensions) {
      lines.push(`- ${d.fullName} = ${d.value.toFixed(2)} mm`);
    }
    if (ctx.dimensions.length >= 30) {
      lines.push('- ... (超过 30 个，已截断)');
    }
  }

  // 装配体组件
  if (ctx.components && ctx.components.length > 0) {
    lines.push('', '### 装配体组件');
    for (const c of ctx.components) {
      const sup = c.suppressed ? ' [已压缩]' : '';
      lines.push(`- ${c.name} → ${c.fileName}${sup}`);
    }
    if (ctx.components.length >= 50) {
      lines.push('- ... (超过 50 个，已截断)');
    }
  }

  // 自定义属性
  const propKeys = Object.keys(ctx.customProperties);
  if (propKeys.length > 0) {
    lines.push('', '### 自定义属性');
    for (const k of propKeys) {
      lines.push(`- ${k}: ${ctx.customProperties[k]}`);
    }
  }

  return lines.join('\n');
}

// ===== 内部采集函数 =====

function collectFeatures(doc: any): SWDocumentContext['features'] {
  const features: SWDocumentContext['features'] = [];
  try {
    let feat = doc.FirstFeature();
    let count = 0;
    while (feat && count < 50) {
      const name = safeCall(() => feat.Name, '');
      const type = safeCall(() => feat.GetTypeName2(), '');
      const suppressed = safeCall(() => feat.IsSuppressed(), false);

      // 跳过系统特征（如原点、基准面等，类型以 "Origin" 开头的）
      if (type && !type.startsWith('Origin') && name) {
        features.push({ name, type, suppressed });
        count++;
      }
      feat = safeCall(() => feat.GetNextFeature(), null);
    }
  } catch {
    // 特征遍历失败，返回空列表
  }
  return features;
}

function collectDimensions(doc: any): SWDocumentContext['dimensions'] {
  const dims: SWDocumentContext['dimensions'] = [];
  try {
    let feat = doc.FirstFeature();
    let count = 0;
    while (feat && count < 30) {
      let dispDim = safeCall(() => feat.GetFirstDisplayDimension(), null);
      while (dispDim && count < 30) {
        const dim = safeCall(() => dispDim.GetDimension2(0), null);
        if (dim) {
          const fullName = safeCall(() => dim.FullName, '');
          // GetSystemValue3 返回米，转毫米
          const valueM = safeCall(() => dim.GetSystemValue3(1, null), null);
          if (fullName && valueM !== null) {
            dims.push({ fullName, value: valueM * 1000 });
            count++;
          }
        }
        dispDim = safeCall(() => feat.GetNextDisplayDimension(dispDim), null);
      }
      feat = safeCall(() => feat.GetNextFeature(), null);
    }
  } catch {
    // ignore
  }
  return dims;
}

function collectCustomProperties(doc: any): Record<string, string> {
  const props: Record<string, string> = {};
  try {
    const mgr = doc.Extension?.CustomPropertyManager?.('');
    if (!mgr) return props;

    const names = safeCall(() => mgr.GetNames(), null);
    if (!names || !Array.isArray(names)) return props;

    for (const name of names.slice(0, 20)) {
      const val = safeCall(() => {
        const out = { Value: '', ResolvedValue: '' };
        mgr.Get5(name, false, out.Value, out.ResolvedValue, false);
        return out.ResolvedValue || out.Value;
      }, '');
      if (val) props[name] = val;
    }
  } catch {
    // ignore
  }
  return props;
}

function collectComponents(doc: any): SWDocumentContext['components'] {
  const comps: NonNullable<SWDocumentContext['components']> = [];
  try {
    const components = safeCall(() => doc.GetComponents(true), null);
    if (!components || !Array.isArray(components)) return comps;

    for (const comp of components.slice(0, 50)) {
      const name = safeCall(() => comp.Name2, '');
      const pathName = safeCall(() => comp.GetPathName(), '');
      const suppressed = safeCall(() => comp.IsSuppressed(), false);
      const fileName = pathName ? pathName.split('\\').pop() || pathName : '';
      if (name) {
        comps.push({ name, fileName, suppressed });
      }
    }
  } catch {
    // ignore
  }
  return comps;
}

/** 安全调用 COM 方法，失败返回默认值 */
function safeCall<T>(fn: () => T, defaultValue: T): T {
  try {
    return fn();
  } catch {
    return defaultValue;
  }
}
