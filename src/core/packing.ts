import type { GridResult, PaletteColor } from './types';
import { effectiveIndex } from './mapping';

/** 每箱容量取值范围：1–999 片 */
export const PACKING_CAPACITY_MIN = 1;
export const PACKING_CAPACITY_MAX = 999;

/** 装入箱中的一片玻璃：非透明格坐标（行、列均从 1 开始） */
export interface PackedPiece {
  row: number;
  col: number;
}

/** 批次单中的一箱：同一色号的连续一段坐标 */
export interface PackingBox {
  /** 箱号，从 1 开始，按色板顺序连续编号 */
  boxNumber: number;
  /** 色板下标（0 起始） */
  paletteIndex: number;
  /** 色号（色板序号，从 1 开始） */
  colorIndex: number;
  /** 六位大写十六进制色值，不含 '#' */
  hex: string;
  /** 本箱片数 */
  count: number;
  /** 本箱坐标，按行优先（行号、列号）顺序排列 */
  pieces: PackedPiece[];
  /** 现场是否已装 */
  packed: boolean;
}

/**
 * 装箱批次单：创建时的容量与分箱结果快照，以及逐箱已装状态。
 * 创建后不随映射变化；映射变化时由 App 整体清除。
 */
export interface PackingPlan {
  /** 每箱容量（片） */
  capacity: number;
  /** 总片数（非透明格数） */
  totalPieces: number;
  /** 总箱数 */
  totalBoxes: number;
  /** 各箱，按色板顺序排列；同色数量超过容量时连续拆箱 */
  boxes: PackingBox[];
}

/**
 * 由最终映射结果（含人工校色）生成装箱批次单。
 *
 * 分组规则：
 * - 逐格取最终色号（有人工指定时为人工色号），按色板顺序稳定分组；
 * - 同色格按行优先（行号、列号）顺序排列；
 * - 同色数量超过容量时连续拆箱，最后一箱可不足容量；
 * - 箱号按色板顺序从 1 开始连续编号，片数为 0 的色号不占箱；
 * - 每个非透明格恰好进入唯一一箱（无遗漏、无重复）。
 *
 * 契约：capacity 为 1–999 的整数（由 parseCapacity 保证）。
 * 全透明版图（没有任何非透明格）返回 null：没有可装箱玻璃，不创建记录。
 */
export function buildPackingPlan(
  result: GridResult,
  palette: readonly PaletteColor[],
  capacity: number,
): PackingPlan | null {
  // 行优先单趟遍历：各色桶内天然按行号、列号有序
  const buckets: PackedPiece[][] = palette.map(() => []);
  for (const cell of result.cells) {
    if (cell.blank) continue;
    buckets[effectiveIndex(cell)].push({ row: cell.row, col: cell.col });
  }

  const boxes: PackingBox[] = [];
  let totalPieces = 0;
  for (let i = 0; i < palette.length; i++) {
    const bucket = buckets[i];
    totalPieces += bucket.length;
    for (let start = 0; start < bucket.length; start += capacity) {
      const pieces = bucket.slice(start, start + capacity);
      boxes.push({
        boxNumber: boxes.length + 1,
        paletteIndex: i,
        colorIndex: i + 1,
        hex: palette[i].hex,
        count: pieces.length,
        pieces,
        packed: false,
      });
    }
  }

  if (boxes.length === 0) return null;
  return { capacity, totalPieces, totalBoxes: boxes.length, boxes };
}

/** 已装箱数 */
export function packedBoxCount(plan: PackingPlan): number {
  return plan.boxes.reduce((n, box) => n + (box.packed ? 1 : 0), 0);
}

/** 下一箱：按箱号顺序第一箱未装的；全部装完时为 null */
export function nextUnpackedBox(plan: PackingPlan): PackingBox | null {
  return plan.boxes.find((box) => !box.packed) ?? null;
}

/**
 * 把指定箱标记为已装，返回更新后的批次单（原批次单不被修改）。
 * 箱号不存在或该箱已装时原样返回。
 */
export function markBoxPacked(plan: PackingPlan, boxNumber: number): PackingPlan {
  const box = plan.boxes.find((b) => b.boxNumber === boxNumber);
  if (!box || box.packed) return plan;
  return {
    ...plan,
    boxes: plan.boxes.map((b) => (b.boxNumber === boxNumber ? { ...b, packed: true } : b)),
  };
}

/** 容量录入非法原因 */
export type CapacityErrorReason = 'empty' | 'negative' | 'decimal' | 'outOfRange' | 'invalid';

export type CapacityParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: CapacityErrorReason };

/**
 * 校验每箱容量录入：去首尾空白后必须是 1–999（含端点）的十进制整数。
 * 空值、负数、小数、越界及其它非整数内容分别给出对应原因。
 */
export function parseCapacity(raw: string): CapacityParseResult {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  // 负号开头的数字（整数或小数）一律按负数拒绝
  if (/^-(\d+(\.\d+)?|\.\d+)$/.test(s)) return { ok: false, reason: 'negative' };
  // 含小数点的非负数字：小数
  if (/^(\d+\.\d*|\.\d+)$/.test(s)) return { ok: false, reason: 'decimal' };
  // 只接受十进制整数字符串；字母、科学计数法、十六进制、符号等一律无效
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid' };
  const n = Number(s);
  if (n < PACKING_CAPACITY_MIN || n > PACKING_CAPACITY_MAX) {
    return { ok: false, reason: 'outOfRange' };
  }
  return { ok: true, value: n };
}

/** 容量录入非法原因的中文描述 */
export function capacityErrorText(reason: CapacityErrorReason): string {
  switch (reason) {
    case 'empty':
      return '请填写每箱容量';
    case 'negative':
      return '每箱容量不能为负数';
    case 'decimal':
      return '每箱容量必须为整数';
    case 'outOfRange':
      return `每箱容量需为 ${PACKING_CAPACITY_MIN} 至 ${PACKING_CAPACITY_MAX} 之间的整数`;
    default:
      return '每箱容量不是有效的整数';
  }
}
