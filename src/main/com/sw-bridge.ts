// src/main/com/sw-bridge.ts
//
// SolidWorks COM 桥接层。
//
// 关键设计:
// 1. winax 是 Windows 原生模块,在 macOS / Linux 上 require 会直接崩。
//    我们在真正 connect() 的时候才 require,开发/非 Windows 平台不会挂。
// 2. isConnected() 不仅检查 this.swApp 存在,还通过调用 RevisionNumber() 做心跳。
// 3. 脚本执行(runVBAMacro / runPythonScript)放在 scripts/ 目录,这里只管连接。

import type { SWDocumentType, SWStatus } from '../../shared/types';

type WinaxModule = {
  Object: new (progid: string, opts?: { activate?: boolean }) => any;
};

export class SolidWorksBridge {
  private swApp: any = null;

  /**
   * 尝试连接到已运行的 SolidWorks 实例。
   * 策略:
   * - 优先 winax(COM 自动激活,连接到现有实例)
   * - 失败则返回 false,调用方决定是否提示启动 SolidWorks
   *
   * 不主动启动 SolidWorks —— 让用户自己控制(避免意外拉起不需要的进程)。
   */
  async connect(): Promise<boolean> {
    if (process.platform !== 'win32') {
      // 非 Windows 平台直接标记未连接,便于在 macOS 上开发 UI
      this.swApp = null;
      return false;
    }

    try {
      // 延迟 require,避免在非 Windows 平台加载失败
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const winax: WinaxModule = require('winax');
      this.swApp = new winax.Object('SldWorks.Application', { activate: true });
      return true;
    } catch (err) {
      this.swApp = null;
      return false;
    }
  }

  disconnect(): void {
    // winax 不需要显式释放,交给 GC
    this.swApp = null;
  }

  /**
   * 心跳 —— 通过调用一次 RevisionNumber() 判断 SolidWorks 是否还活着。
   * 用户可能关了 SW 但应用还开着,这时需要把状态同步给 UI。
   */
  isConnected(): boolean {
    if (!this.swApp) return false;
    try {
      const version = this.swApp.RevisionNumber();
      return !!version;
    } catch {
      this.swApp = null;
      return false;
    }
  }

  getVersion(): string | undefined {
    if (!this.swApp) return undefined;
    try {
      return String(this.swApp.RevisionNumber());
    } catch {
      return undefined;
    }
  }

  getActiveDocument(): any {
    if (!this.swApp) return null;
    try {
      return this.swApp.ActiveDoc ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 判断当前活动文档类型。
   * SolidWorks 的 GetType 返回:
   *   1 = Part
   *   2 = Assembly
   *   3 = Drawing
   */
  getDocumentType(): SWDocumentType {
    const doc = this.getActiveDocument();
    if (!doc) return null;
    try {
      const t: number = doc.GetType();
      if (t === 1) return 'part';
      if (t === 2) return 'assembly';
      if (t === 3) return 'drawing';
      return null;
    } catch {
      return null;
    }
  }

  getActiveDocumentPath(): string | undefined {
    const doc = this.getActiveDocument();
    if (!doc) return undefined;
    try {
      const p = doc.GetPathName();
      return typeof p === 'string' && p.length > 0 ? p : undefined;
    } catch {
      return undefined;
    }
  }

  /** 聚合状态,方便一次性发给渲染进程 */
  getStatus(): SWStatus {
    const connected = this.isConnected();
    if (!connected) return { connected: false };
    return {
      connected: true,
      version: this.getVersion(),
      activeDocumentType: this.getDocumentType(),
      activeDocumentPath: this.getActiveDocumentPath(),
    };
  }

  /** 暴露底层 swApp 给 ScriptEngine 使用(仅主进程内部) */
  getRawApp(): any {
    return this.swApp;
  }
}

// 单例
let instance: SolidWorksBridge | null = null;
export function getBridge(): SolidWorksBridge {
  if (!instance) instance = new SolidWorksBridge();
  return instance;
}
