// src/main/scripts/engine.ts
//
// 脚本执行引擎 v2。
//
// 执行策略（按优先级）：
// 1. VBScript via cscript.exe：Windows 原生，无需额外安装，可靠
// 2. Python + win32com：如果用户指定 python 脚本
// 3. VBA via RunMacro2：保留作为最后 fallback
//
// 所有方案都支持通过临时 JSON 文件回传执行结果。

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import type { ScriptLanguage, ScriptResult } from '../../shared/types';
import { validateScript } from './sanitizer';
import { vbaToVbs, detectRuntimes } from './vba-macro-writer';
import type { SolidWorksBridge } from '../com/sw-bridge';

const PYTHON_TIMEOUT_MS = 60_000;
const VBS_TIMEOUT_MS = 30_000;
const VBA_TIMEOUT_MS = 30_000;

type Runtime = 'python' | 'cscript' | 'com';

export class ScriptEngine {
  private preferredRuntime: Runtime | null = null;
  private runtimeDetected = false;

  constructor(private readonly bridge: SolidWorksBridge) {}

  async detectRuntime(): Promise<Runtime> {
    if (this.runtimeDetected && this.preferredRuntime) return this.preferredRuntime;
    const runtimes = await detectRuntimes();
    if (runtimes.includes('cscript')) {
      this.preferredRuntime = 'cscript';
    } else if (runtimes.includes('python')) {
      this.preferredRuntime = 'python';
    } else {
      this.preferredRuntime = 'com';
    }
    this.runtimeDetected = true;
    return this.preferredRuntime;
  }

  getRuntime(): Runtime | null {
    return this.preferredRuntime;
  }

  async run(code: string, language: ScriptLanguage): Promise<ScriptResult> {
    const validation = validateScript(code, language);
    if (!validation.safe) {
      return {
        success: false, output: '',
        error: `安全校验未通过: ${validation.issues.join('; ')}`,
        duration: 0,
      };
    }

    const start = Date.now();
    try {
      if (language === 'python') {
        return await this.runPython(code, start);
      }
      // VBA: 优先用 cscript 执行转换后的 VBS
      const runtime = await this.detectRuntime();
      if (runtime === 'cscript') return await this.runVBS(code, start);
      return await this.runVBACom(code, start);
    } catch (err) {
      return {
        success: false, output: '',
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      };
    }
  }

  // ===== VBScript 执行（主路径）=====
  private async runVBS(vbaCode: string, startedAt: number): Promise<ScriptResult> {
    const ts = Date.now();
    const resultPath = path.join(os.tmpdir(), `sw_result_${ts}.json`);
    const scriptPath = path.join(os.tmpdir(), `sw_macro_${ts}.vbs`);

    const vbsCode = vbaToVbs(vbaCode, { resultFilePath: resultPath });
    fs.writeFileSync(scriptPath, vbsCode, 'utf8');

    return new Promise<ScriptResult>((resolve) => {
      // 使用 System32 下的 cscript 完整路径，避免 PATH 环境变量不含 System32 的情况
      const cscriptPath = `${process.env.SYSTEMROOT || 'C:\\Windows'}\\System32\\cscript.exe`;
      const child = exec(
        `"${cscriptPath}" //NoLogo "${scriptPath}"`,
        { timeout: VBS_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
        (error, stdout, stderr) => {
          const resultData = readResultFile(resultPath);
          safeUnlink(scriptPath);
          safeUnlink(resultPath);

          if (error) {
            resolve({
              success: false,
              output: stdout || '',
              error: resultData?.message || stderr || error.message,
              duration: Date.now() - startedAt,
              data: resultData ?? undefined,
            });
          } else {
            resolve({
              success: resultData?.success ?? true,
              output: resultData?.message || stdout || '',
              error: stderr ? String(stderr) : undefined,
              duration: Date.now() - startedAt,
              data: resultData ?? undefined,
            });
          }
        },
      );
      child.on('error', (err) => {
        safeUnlink(scriptPath);
        safeUnlink(resultPath);
        resolve({ success: false, output: '', error: err.message, duration: Date.now() - startedAt });
      });
    });
  }

  // ===== Python 执行 =====
  private runPython(code: string, startedAt: number): Promise<ScriptResult> {
    const ts = Date.now();
    const resultPath = path.join(os.tmpdir(), `sw_result_${ts}.json`);
    const scriptPath = path.join(os.tmpdir(), `sw_script_${ts}.py`);

    const enrichedCode = `import os as __os__\n__result_path__ = r"${resultPath}"\n\n${code}`;
    fs.writeFileSync(scriptPath, enrichedCode, 'utf8');

    return new Promise<ScriptResult>((resolve) => {
      const child = exec(
        `python "${scriptPath}"`,
        { timeout: PYTHON_TIMEOUT_MS, windowsHide: true },
        (error, stdout, stderr) => {
          const resultData = readResultFile(resultPath);
          safeUnlink(scriptPath);
          safeUnlink(resultPath);

          if (error) {
            resolve({
              success: false, output: stdout ?? '',
              error: resultData?.message || stderr || error.message,
              duration: Date.now() - startedAt, data: resultData ?? undefined,
            });
          } else {
            resolve({
              success: resultData?.success ?? true,
              output: resultData?.message || stdout || '',
              error: stderr ? String(stderr) : undefined,
              duration: Date.now() - startedAt, data: resultData ?? undefined,
            });
          }
        },
      );
      child.on('error', (err) => {
        safeUnlink(scriptPath);
        safeUnlink(resultPath);
        resolve({ success: false, output: '', error: err.message, duration: Date.now() - startedAt });
      });
    });
  }

  // ===== COM 直接执行（fallback）=====
  private async runVBACom(code: string, startedAt: number): Promise<ScriptResult> {
    if (!this.bridge.isConnected()) {
      return { success: false, output: '', error: 'SolidWorks 未连接', duration: Date.now() - startedAt };
    }
    const tempPath = path.join(os.tmpdir(), `sw_macro_${Date.now()}.swp`);
    fs.writeFileSync(tempPath, code, 'utf8');
    try {
      const swApp = this.bridge.getRawApp();
      const execP = new Promise<ScriptResult>((resolve) => {
        try {
          const result = swApp.RunMacro2(tempPath, '', 'main', 1, 0);
          resolve({ success: result === 0 || result === true, output: '', duration: Date.now() - startedAt });
        } catch (err) {
          resolve({ success: false, output: '', error: err instanceof Error ? err.message : String(err), duration: Date.now() - startedAt });
        }
      });
      const timeoutP = new Promise<ScriptResult>((resolve) => {
        setTimeout(() => resolve({ success: false, output: '', error: `VBA 执行超时 (${VBA_TIMEOUT_MS / 1000}s)`, duration: Date.now() - startedAt }), VBA_TIMEOUT_MS);
      });
      return await Promise.race([execP, timeoutP]);
    } finally {
      safeUnlink(tempPath);
    }
  }
}

function safeUnlink(p: string): void {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

function readResultFile(p: string): { success: boolean; message: string } | null {
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch { /* ignore */ }
  return null;
}
