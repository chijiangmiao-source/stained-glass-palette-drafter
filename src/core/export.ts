import type { GridResult } from './types';
import { effectiveIndex } from './mapping';

/**
 * 生成导出文本：按行优先记录非空格像素，
 * 每行一条记录：行号、列号、色板序号（均从 1 开始），
 * 三个字段以单个制表符分隔，记录以 LF 分隔，文件末尾不换行。
 * 色号取该格的最终命中（有人工校色时为人工色号，否则为自动命中）。
 * 没有不透明像素时返回空字符串（导出空文件）。
 */
export function buildExportText(result: GridResult): string {
  const lines: string[] = [];
  for (const cell of result.cells) {
    if (cell.blank) continue;
    lines.push(`${cell.row}\t${cell.col}\t${effectiveIndex(cell) + 1}`);
  }
  return lines.join('\n');
}
