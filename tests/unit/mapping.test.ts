import { describe, expect, it } from 'vitest';
import { parsePalette } from '../../src/core/palette';
import { quantizePixels } from '../../src/core/quantize';
import { applyOverrides, effectiveIndex, isManual } from '../../src/core/mapping';
import { buildExportText } from '../../src/core/export';
import type { GridResult, PaletteColor } from '../../src/core/types';

function paletteOf(input: string): PaletteColor[] {
  const r = parsePalette(input);
  if (!r.ok) throw new Error(r.error);
  return r.colors;
}

function gridOf(data: number[], width: number, height: number, palette: PaletteColor[]): GridResult {
  const r = quantizePixels(data, width, height, palette);
  if (!r.ok) throw new Error(r.error);
  return r.result;
}

describe('applyOverrides', () => {
  // 2×2：红、绿 / 蓝、透明；色板 1=红 2=绿 3=蓝
  const rgba = [
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    0, 0, 0, 0,
  ];

  it('无人工指定时与自动映射逐格一致（计数、格子与导出文本）', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const base = gridOf(rgba, 2, 2, palette);
    const out = applyOverrides(base, new Map());

    expect(out.cells).toEqual(base.cells);
    expect(out.counts).toEqual([1, 1, 1]);
    expect(buildExportText(out)).toBe(buildExportText(base));
    expect(buildExportText(out)).toBe('1\t1\t1\n1\t2\t2\n2\t1\t3');
  });

  it('改色后格子标记人工指定并增减计数，导出文本同步', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const base = gridOf(rgba, 2, 2, palette);
    // 第 1 行第 2 列（自动为绿=下标 1）改为蓝=下标 2
    const out = applyOverrides(base, new Map([[1, 2]]));
    const cell = out.cells[1];

    expect(cell.paletteIndex).toBe(1); // 自动命中保留
    expect(cell.manualIndex).toBe(2);
    expect(effectiveIndex(cell)).toBe(2);
    expect(isManual(cell)).toBe(true);
    expect(out.counts).toEqual([1, 0, 2]); // 绿 -1、蓝 +1
    // 空格与未校色格不受影响
    expect(isManual(out.cells[3])).toBe(false);
    expect(out.cells[0].manualIndex).toBe(-1);
    // 导出采用最终色号
    expect(buildExportText(out)).toBe('1\t1\t1\n1\t2\t3\n2\t1\t3');
  });

  it('恢复自动计算后格子、计数与导出文本回到自动结果', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const base = gridOf(rgba, 2, 2, palette);
    const changed = applyOverrides(base, new Map([[1, 2]]));
    // 以当前合成结果为底再剥离覆盖，等价于恢复自动计算
    const restored = applyOverrides(changed, new Map());

    expect(restored.cells[1].manualIndex).toBe(-1);
    expect(effectiveIndex(restored.cells[1])).toBe(1);
    expect(isManual(restored.cells[1])).toBe(false);
    expect(restored.counts).toEqual([1, 1, 1]);
    expect(restored.cells).toEqual(base.cells);
    expect(buildExportText(restored)).toBe(buildExportText(base));
  });

  it('多次改色同一格只影响最终色号，计数不错乱', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const base = gridOf(rgba, 2, 2, palette);
    // 绿格先改红再改蓝
    const step1 = applyOverrides(base, new Map([[1, 0]]));
    expect(step1.counts).toEqual([2, 0, 1]);
    const step2 = applyOverrides(base, new Map([[1, 2]]));
    expect(step2.counts).toEqual([1, 0, 2]);
  });

  it('空格永远不被人工指定，且不计入任何色号', () => {
    const palette = paletteOf('FF0000\n00FF00');
    const base = gridOf([0, 0, 0, 0, 255, 0, 0, 255], 2, 1, palette);
    // 即便覆盖集合误含空格下标 0，空格仍保持空白
    const out = applyOverrides(base, new Map([[0, 1]]));
    expect(out.cells[0].blank).toBe(true);
    expect(effectiveIndex(out.cells[0])).toBe(-1);
    expect(out.counts).toEqual([1, 0]);
    expect(buildExportText(out)).toBe('1\t2\t1');
  });
});
