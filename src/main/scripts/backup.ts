// src/main/scripts/backup.ts
//
// 脚本执行前自动备份当前文档。
// 备份到系统临时目录，执行成功后可选择删除。

import * as path from 'path';
import * as os from 'os';
import type { SolidWorksBridge } from '../com/sw-bridge';

const BACKUP_DIR = path.join(os.tmpdir(), 'sw-copilot-backups');

export interface BackupResult {
  success: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * 备份当前活动文档。
 * 通过 COM 调用 SaveAs3 保存一份副本到临时目录。
 */
export async function backupActiveDocument(bridge: SolidWorksBridge): Promise<BackupResult> {
  if (!bridge.isConnected()) {
    return { success: false, error: 'SolidWorks 未连接' };
  }

  const doc = bridge.getActiveDocument();
  if (!doc) {
    return { success: false, error: '没有打开的文档' };
  }

  try {
    const originalPath = doc.GetPathName();
    if (!originalPath) {
      // 文档未保存过，跳过备份
      return { success: true, backupPath: undefined };
    }

    // 确保备份目录存在
    const fs = await import('fs');
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    // 生成备份文件名：原名_backup_timestamp.ext
    const ext = path.extname(originalPath);
    const base = path.basename(originalPath, ext);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `${base}_backup_${timestamp}${ext}`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    // 用 SaveAs3 保存副本（不改变当前文档的路径）
    // ⚠️ Errors/Warnings 是 COM ByRef 参数，winax 不支持 JS 按引用传参，
    //    所以最可靠的检查是看备份文件是否真的创建了。
    const saveResult = doc.Extension.SaveAs3(
      backupPath,
      0,  // version: current
      1,  // options: silent
      null,
      null,
      0,  // errors (ignored)
      0,  // warnings (ignored)
    );

    // 检查备份文件是否实际创建
    const fs2 = await import('fs');
    if (!fs2.existsSync(backupPath)) {
      return { success: false, error: 'SaveAs3 未创建备份文件，可能是权限或路径问题' };
    }

    // SaveAs3 可能会把活动文档切换到备份路径，需要重新打开原始文件
    const currentPath = doc.GetPathName();
    if (currentPath !== originalPath) {
      const swApp = bridge.getRawApp();
      const reopenedDoc = swApp.OpenDoc7(originalPath, '', 1, '');
      if (!reopenedDoc) {
        return {
          success: false,
          error: `SaveAs3 切换了活动文档，且无法重新打开原文件: ${originalPath}`,
          backupPath,
        };
      }
    }

    return { success: true, backupPath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 清理指定备份文件。
 */
export function removeBackup(backupPath: string): void {
  try {
    const fs = require('fs');
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
  } catch {
    // 清理失败不影响主流程
  }
}

/**
 * 清理所有超过 24 小时的旧备份。
 */
export function cleanOldBackups(): void {
  try {
    const fs = require('fs');
    if (!fs.existsSync(BACKUP_DIR)) return;

    const files = fs.readdirSync(BACKUP_DIR);
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > ONE_DAY) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // ignore
  }
}

function getDocType(ext: string): number {
  switch (ext.toLowerCase()) {
    case '.sldprt': return 1;  // swDocPART
    case '.sldasm': return 2;  // swDocASSEMBLY
    case '.slddrw': return 3;  // swDocDRAWING
    default: return 1;
  }
}
