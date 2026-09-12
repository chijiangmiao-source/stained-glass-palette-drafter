import { describe, expect, it } from 'vitest';
import { parsePalette } from '../../src/core/palette';
import { quantizePixels } from '../../src/core/quantize';
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

describe('buildExportText', () => {
  it('按行优先记录非空格像素，制表符分隔、LF 连接、末尾无换行', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    // 2×2：红、透明、蓝、绿
    const grid = gridOf(
      [
        255, 0, 0, 255,
        0, 0, 0, 0,
        0, 0, 255, 255,
        0, 255, 0, 255,
      ],
      2,
      2,
      palette,
    );
    const text = buildExportText(grid);
    expect(text).toBe('1\t1\t1\n2\t1\t3\n2\t2\t2');
    expect(text.endsWith('\n')).toBe(false);
    expect(text).not.toContain('\r');
  });

  it('单像素导出只有一行且无换行', () => {
    const palette = paletteOf('FF0000\n00FF00');
    const grid = gridOf([0, 255, 0, 255], 1, 1, palette);
    expect(buildExportText(grid)).toBe('1\t1\t2');
  });

  it('全部透明时导出空字符串（空文件）', () => {
    const palette = paletteOf('FF0000\n00FF00');
    const grid = gridOf([0, 0, 0, 0, 0, 0, 0, 0], 2, 1, palette);
    expect(buildExportText(grid)).toBe('');
  });

  it('导出与统计逐格一致：每色记录数等于片数', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const grid = gridOf(
      [
        255, 0, 0, 255,
        0, 0, 0, 0,
        0, 0, 254, 255,
        250, 0, 0, 255,
        0, 255, 0, 255,
        0, 0, 0, 0,
      ],
      3,
      2,
      palette,
    );
    const text = buildExportText(grid);
    const lines = text.split('\n');
    expect(lines).toHaveLength(grid.counts.reduce((a, b) => a + b, 0));
    for (let p = 0; p < palette.length; p++) {
      const n = lines.filter((l) => l.endsWith(`\t${p + 1}`)).length;
      expect(n).toBe(grid.counts[p]);
    }
    // 行优先顺序：行号单调不减
    const rows = lines.map((l) => Number(l.split('\t')[0]));
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
  });
});
