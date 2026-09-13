import { describe, expect, it } from 'vitest';
import {
  buildInventoryCheck,
  parseStock,
  stockErrorText,
  validateStockInputs,
} from '../../src/core/inventory';
import { parsePalette } from '../../src/core/palette';
import type { PaletteColor } from '../../src/core/types';

function paletteOf(input: string): PaletteColor[] {
  const r = parsePalette(input);
  if (!r.ok) throw new Error(r.error);
  return r.colors;
}

const PALETTE = paletteOf('FF0000\n00FF00\n0000FF');

describe('buildInventoryCheck：分配公式', () => {
  it('库存充足时领用量等于需求，剩余量为库存减需求，缺口为 0', () => {
    const sheet = buildInventoryCheck(PALETTE, [2, 1, 3], [5, 1, 4]);
    expect(
      sheet.rows.map((r) => [r.demand, r.stock, r.allocated, r.remaining, r.shortfall]),
    ).toEqual([
      [2, 5, 2, 3, 0],
      [1, 1, 1, 0, 0],
      [3, 4, 3, 1, 0],
    ]);
    expect(sheet.sufficient).toBe(true);
  });

  it('库存不足时领用量取需求与库存的较小者，缺口为需求减领用量', () => {
    const sheet = buildInventoryCheck(PALETTE, [5, 3, 0], [3, 10, 0]);
    expect(sheet.rows[0]).toMatchObject({ allocated: 3, remaining: 0, shortfall: 2 });
    expect(sheet.rows[1]).toMatchObject({ allocated: 3, remaining: 7, shortfall: 0 });
    expect(sheet.rows[2]).toMatchObject({ allocated: 0, remaining: 0, shortfall: 0 });
    expect(sheet.sufficient).toBe(false);
  });

  it('合法的零库存仍参与缺口计算：领用量为 0，缺口等于需求', () => {
    const sheet = buildInventoryCheck(PALETTE, [4, 0, 2], [0, 0, 2]);
    expect(sheet.rows[0]).toMatchObject({ demand: 4, stock: 0, allocated: 0, remaining: 0, shortfall: 4 });
    // 需求为 0 且库存为 0：无缺口，不算不足
    expect(sheet.rows[1]).toMatchObject({ demand: 0, stock: 0, allocated: 0, remaining: 0, shortfall: 0 });
    expect(sheet.rows[2]).toMatchObject({ demand: 2, stock: 2, allocated: 2, remaining: 0, shortfall: 0 });
    expect(sheet.sufficient).toBe(false);
  });

  it('任一色号有缺口即汇总为库存不足，全部无缺口才可直备料', () => {
    expect(buildInventoryCheck(PALETTE, [1, 1, 1], [1, 1, 1]).sufficient).toBe(true);
    expect(buildInventoryCheck(PALETTE, [1, 1, 1], [1, 0, 1]).sufficient).toBe(false);
    expect(buildInventoryCheck(PALETTE, [0, 0, 0], [0, 0, 0]).sufficient).toBe(true);
  });
});

describe('buildInventoryCheck：按色板顺序', () => {
  it('核验行严格按色板顺序排列，色号从 1 开始并携带对应色值', () => {
    // 需求与库存刻意无序，验证行序只跟随色板而非数值
    const sheet = buildInventoryCheck(PALETTE, [9, 0, 4], [1, 8, 2]);
    expect(sheet.rows.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(sheet.rows.map((r) => r.hex)).toEqual(['FF0000', '00FF00', '0000FF']);
    expect(sheet.rows.map((r) => [r.demand, r.stock])).toEqual([
      [9, 1],
      [0, 8],
      [4, 2],
    ]);
  });

  it('核验单是生成时的快照：修改传入数组不影响已生成的结果', () => {
    const demands = [1, 2, 3];
    const stocks = [3, 2, 1];
    const sheet = buildInventoryCheck(PALETTE, demands, stocks);
    demands[0] = 99;
    stocks[0] = 99;
    expect(sheet.rows[0].demand).toBe(1);
    expect(sheet.rows[0].stock).toBe(3);
  });
});

describe('parseStock：输入边界', () => {
  it('接受非负整数（含零与前后空白）', () => {
    expect(parseStock('0')).toEqual({ ok: true, value: 0 });
    expect(parseStock('7')).toEqual({ ok: true, value: 7 });
    expect(parseStock('  42  ')).toEqual({ ok: true, value: 42 });
    expect(parseStock('007')).toEqual({ ok: true, value: 7 });
    expect(parseStock(String(Number.MAX_SAFE_INTEGER))).toEqual({
      ok: true,
      value: Number.MAX_SAFE_INTEGER,
    });
  });

  it('空值被拒绝', () => {
    expect(parseStock('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseStock('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('负数被拒绝', () => {
    expect(parseStock('-1')).toEqual({ ok: false, reason: 'negative' });
    expect(parseStock('-3.5')).toEqual({ ok: false, reason: 'negative' });
  });

  it('小数被拒绝', () => {
    expect(parseStock('1.5')).toEqual({ ok: false, reason: 'decimal' });
    expect(parseStock('2.')).toEqual({ ok: false, reason: 'decimal' });
    expect(parseStock('.5')).toEqual({ ok: false, reason: 'decimal' });
  });

  it('超出安全整数被拒绝', () => {
    expect(parseStock(String(Number.MAX_SAFE_INTEGER + 1))).toEqual({
      ok: false,
      reason: 'unsafe',
    });
    expect(parseStock('99999999999999999999')).toEqual({ ok: false, reason: 'unsafe' });
  });

  it('其它非数字内容被拒绝', () => {
    expect(parseStock('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseStock('1e3')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseStock('0x10')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseStock('1,000')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('validateStockInputs：批量校验并定位色号', () => {
  it('全部合法时按色板顺序返回库存数组', () => {
    expect(validateStockInputs(['3', '0', '12'])).toEqual({ ok: true, stocks: [3, 0, 12] });
  });

  it('任一非法即整体失败，全部错误各自定位到对应色号', () => {
    const r = validateStockInputs(['', '-2', '5', '1.5', '9007199254740992']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      { paletteIndex: 0, reason: 'empty', input: '' },
      { paletteIndex: 1, reason: 'negative', input: '-2' },
      { paletteIndex: 3, reason: 'decimal', input: '1.5' },
      { paletteIndex: 4, reason: 'unsafe', input: '9007199254740992' },
    ]);
  });

  it('错误原因有明确中文描述', () => {
    expect(stockErrorText('empty')).toContain('未填写');
    expect(stockErrorText('negative')).toContain('负数');
    expect(stockErrorText('decimal')).toContain('整数');
    expect(stockErrorText('unsafe')).toContain('安全整数');
    expect(stockErrorText('invalid')).toContain('非负整数');
  });
});
