import type { GridResult, PaletteColor, Rgb } from './types';
import { effectiveIndex } from './mapping';

/** 色差上限取值范围：三通道差值平方和的理论最小值与最大值（3×255²） */
export const QUALITY_THRESHOLD_MIN = 0;
export const QUALITY_THRESHOLD_MAX = 3 * 255 * 255; // 195075

/** 单个超限格的核查明细 */
export interface QualityIssue {
  /** 行号，从 1 开始 */
  row: number;
  /** 列号，从 1 开始 */
  col: number;
  /** 行优先线性下标，用于网格描边定位 */
  index: number;
  /** 原像素颜色 */
  src: Rgb;
  /** 最终选色的色板下标（0 起始；人工校色时为人工色号） */
  paletteIndex: number;
  /** 原色与最终选色的三通道差值平方和 */
  distance: number;
}

/** 一次质量核查的结果：明细按行、列顺序排列 */
export interface QualityReport {
  /** 核查时使用的色差上限 */
  threshold: number;
  /** 超限格明细，严格按行优先（行号、列号）排序 */
  issues: QualityIssue[];
  /** 超限格数量 */
  overCount: number;
  /** 超限格中的最大偏差；无超限格时为 0 */
  maxDistance: number;
}

/** 两个颜色的三通道差值平方和 */
export function colorSquaredDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/**
 * 基于最终映射结果（含人工校色）与色板生成质量核查报告。
 *
 * 规则：
 * - 逐格取原像素与「最终选色」（有人工指定时为人工色号，否则为自动命中）的
 *   三通道差值平方和；距离严格大于上限才记为超限（等于上限属于允许范围）；
 * - 全透明空格不参与核查，永远不进入明细；
 * - 明细按行优先遍历生成，天然按行号、列号排序；
 * - 不修改映射结果本身，采购文本与备料核验不受影响。
 */
export function buildQualityReport(
  result: GridResult,
  palette: readonly PaletteColor[],
  threshold: number,
): QualityReport {
  const issues: QualityIssue[] = [];
  let maxDistance = 0;
  for (const cell of result.cells) {
    if (cell.blank || !cell.src) continue;
    const paletteIndex = effectiveIndex(cell);
    const target = palette[paletteIndex];
    if (!target) continue;
    const distance = colorSquaredDistance(cell.src, target.rgb);
    if (distance > threshold) {
      issues.push({
        row: cell.row,
        col: cell.col,
        index: (cell.row - 1) * result.width + (cell.col - 1),
        src: cell.src,
        paletteIndex,
        distance,
      });
      if (distance > maxDistance) maxDistance = distance;
    }
  }
  return { threshold, issues, overCount: issues.length, maxDistance };
}

/** 色差上限录入非法原因 */
export type ThresholdErrorReason = 'empty' | 'negative' | 'decimal' | 'outOfRange' | 'invalid';

export type ThresholdParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: ThresholdErrorReason };

/**
 * 校验色差上限录入：去首尾空白后必须是 0–195075（含端点）的十进制整数。
 * 空值、负数、小数、越界及其它非整数内容分别给出对应原因。
 */
export function parseThreshold(raw: string): ThresholdParseResult {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  // 负号开头的数字（整数或小数）一律按负数拒绝
  if (/^-(\d+(\.\d+)?|\.\d+)$/.test(s)) return { ok: false, reason: 'negative' };
  // 含小数点的非负数字：小数
  if (/^(\d+\.\d*|\.\d+)$/.test(s)) return { ok: false, reason: 'decimal' };
  // 只接受十进制整数字符串；字母、科学计数法、十六进制、符号等一律无效
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid' };
  const n = Number(s);
  if (n < QUALITY_THRESHOLD_MIN || n > QUALITY_THRESHOLD_MAX) {
    return { ok: false, reason: 'outOfRange' };
  }
  return { ok: true, value: n };
}

/** 色差上限录入非法原因的中文描述 */
export function thresholdErrorText(reason: ThresholdErrorReason): string {
  switch (reason) {
    case 'empty':
      return '请填写色差上限';
    case 'negative':
      return '色差上限不能为负数';
    case 'decimal':
      return '色差上限必须为整数';
    case 'outOfRange':
      return `色差上限需为 ${QUALITY_THRESHOLD_MIN} 至 ${QUALITY_THRESHOLD_MAX} 之间的整数`;
    default:
      return '色差上限不是有效的整数';
  }
}
