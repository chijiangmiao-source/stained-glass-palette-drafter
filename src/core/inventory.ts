import type { PaletteColor } from './types';

/** 单个色号的备料核验行：需求快照、可用库存与按色板顺序算出的领用量、剩余量、缺口 */
export interface InventoryCheckRow {
  /** 色号（色板序号，从 1 开始） */
  index: number;
  /** 六位大写十六进制色值，不含 '#'，如 "FF0000" */
  hex: string;
  /** 需求片数：生成核验单时的最终色片数快照 */
  demand: number;
  /** 可用库存：录入的非负整数 */
  stock: number;
  /** 领用量 = min(需求, 库存) */
  allocated: number;
  /** 剩余量 = 库存 − 领用量 */
  remaining: number;
  /** 缺口 = 需求 − 领用量 */
  shortfall: number;
}

/**
 * 备料核验单：生成时的需求快照与每色核验结果。
 * 生成后即为固定快照，不随后续映射变化；是否过期由组件层判定。
 */
export interface InventoryCheckSheet {
  /** 按色板顺序排列，每色一行 */
  rows: InventoryCheckRow[];
  /** 全部色号缺口均为 0 时为 true：可直接备料；否则库存不足 */
  sufficient: boolean;
}

/** 库存录入非法原因 */
export type StockErrorReason = 'empty' | 'negative' | 'decimal' | 'unsafe' | 'invalid';

export type StockParseResult =
  | { ok: true; value: number }
  | { ok: false; reason: StockErrorReason };

/**
 * 校验单个库存录入：去除首尾空白后必须是非负整数，且不超出安全整数范围。
 * 空值、负数、小数、超出安全整数、其它非数字内容分别给出对应原因；
 * 合法的零库存通过校验，仍参与缺口计算。
 */
export function parseStock(raw: string): StockParseResult {
  const s = raw.trim();
  if (s === '') return { ok: false, reason: 'empty' };
  // 负号开头的数字（整数或小数）一律按负数拒绝
  if (/^-(\d+(\.\d+)?|\.\d+)$/.test(s)) return { ok: false, reason: 'negative' };
  // 含小数点的非负数字：小数
  if (/^(\d+\.\d*|\.\d+)$/.test(s)) return { ok: false, reason: 'decimal' };
  // 只接受十进制整数字符串；字母、科学计数法、十六进制等一律无效
  if (!/^\d+$/.test(s)) return { ok: false, reason: 'invalid' };
  const n = Number(s);
  if (!Number.isSafeInteger(n)) return { ok: false, reason: 'unsafe' };
  return { ok: true, value: n };
}

/** 单个色号的库存录入错误，paletteIndex 用于定位到对应色号 */
export interface StockInputError {
  /** 色板下标（0 起始） */
  paletteIndex: number;
  reason: StockErrorReason;
  /** 原始录入内容 */
  input: string;
}

export type StockInputsValidation =
  | { ok: true; stocks: number[] }
  | { ok: false; errors: StockInputError[] };

/**
 * 批量校验各色号库存录入（与色板一一对应、按色板顺序排列）。
 * 任一色号非法即整体阻止生成，并返回全部错误（各自定位到对应色号）。
 */
export function validateStockInputs(inputs: readonly string[]): StockInputsValidation {
  const stocks: number[] = new Array(inputs.length);
  const errors: StockInputError[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const r = parseStock(inputs[i]);
    if (r.ok) {
      stocks[i] = r.value;
    } else {
      errors.push({ paletteIndex: i, reason: r.reason, input: inputs[i] });
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, stocks };
}

/** 库存录入非法原因的中文描述 */
export function stockErrorText(reason: StockErrorReason): string {
  switch (reason) {
    case 'empty':
      return '未填写库存';
    case 'negative':
      return '库存不能为负数';
    case 'decimal':
      return '库存必须为整数';
    case 'unsafe':
      return '库存超出安全整数范围';
    default:
      return '库存不是有效的非负整数';
  }
}

/**
 * 生成备料核验单（纯计算契约）：以当前最终色片数为需求快照，
 * 按色板顺序逐色计算 领用量 = min(需求, 库存)、剩余量 = 库存 − 领用量、
 * 缺口 = 需求 − 领用量；全部色号缺口为 0 时判定「可直接备料」，否则「库存不足」。
 *
 * 契约：demands、stocks 与 palette 等长且均为非负安全整数
 * （库存由 validateStockInputs 保证，需求来自映射层计数）。
 */
export function buildInventoryCheck(
  palette: readonly PaletteColor[],
  demands: readonly number[],
  stocks: readonly number[],
): InventoryCheckSheet {
  const rows: InventoryCheckRow[] = palette.map((color, i) => {
    const demand = demands[i] ?? 0;
    const stock = stocks[i] ?? 0;
    const allocated = Math.min(demand, stock);
    return {
      index: i + 1,
      hex: color.hex,
      demand,
      stock,
      allocated,
      remaining: stock - allocated,
      shortfall: demand - allocated,
    };
  });
  return { rows, sufficient: rows.every((row) => row.shortfall === 0) };
}
