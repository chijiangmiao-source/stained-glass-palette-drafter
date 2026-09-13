import { describe, expect, it } from 'vitest';
import { parsePalette } from '../../src/core/palette';
import { quantizePixels } from '../../src/core/quantize';
import type { PaletteColor } from '../../src/core/types';

function paletteOf(input: string): PaletteColor[] {
  const r = parsePalette(input);
  if (!r.ok) throw new Error(r.error);
  return r.colors;
}

/** 按行优先拼装 RGBA 像素数组 */
function rgba(...pixels: Array<[number, number, number, number]>): number[] {
  return pixels.flat();
}

describe('quantizePixels', () => {
  it('精确命中色板颜色', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const r = quantizePixels(rgba([0, 255, 0, 255]), 1, 1, palette);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.cells[0].paletteIndex).toBe(1);
      expect(r.result.counts).toEqual([0, 1, 0]);
    }
  });

  it('按三通道差值平方和取最近色', () => {
    const palette = paletteOf('000000\nFFFFFF');
    // 224^2*3 = 150528 > 31^2*3 = 2883 → 更靠近白色
    const nearWhite = quantizePixels(rgba([224, 224, 224, 255]), 1, 1, palette);
    expect(nearWhite.ok && nearWhite.result.cells[0].paletteIndex).toBe(1);
    // 32^2*3 = 3072 < 223^2*3 → 更靠近黑色
    const nearBlack = quantizePixels(rgba([32, 32, 32, 255]), 1, 1, palette);
    expect(nearBlack.ok && nearBlack.result.cells[0].paletteIndex).toBe(0);
  });

  it('并列时取色板中最靠前者（与顺序无关地验证两种排列）', () => {
    // (127)^2 = 16129，(127-254)^2 = 16129 → 与 000000、FE0000 等距
    const p1 = paletteOf('000000\nFE0000');
    const r1 = quantizePixels(rgba([127, 0, 0, 255]), 1, 1, p1);
    expect(r1.ok && r1.result.cells[0].paletteIndex).toBe(0);

    const p2 = paletteOf('FE0000\n000000');
    const r2 = quantizePixels(rgba([127, 0, 0, 255]), 1, 1, p2);
    expect(r2.ok && r2.result.cells[0].paletteIndex).toBe(0);
  });

  it('三通道等距并列时也取最靠前者', () => {
    const palette = paletteOf('FF0000\n00FF00\n0000FF');
    const r = quantizePixels(rgba([254, 254, 254, 255]), 1, 1, palette);
    expect(r.ok && r.result.cells[0].paletteIndex).toBe(0);
  });

  it('完全透明像素视为空格且不计入统计', () => {
    const palette = paletteOf('FF0000\n00FF00');
    const r = quantizePixels(rgba([0, 0, 0, 0], [255, 0, 0, 255]), 2, 1, palette);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.cells[0]).toEqual({
        row: 1,
        col: 1,
        blank: true,
        src: null,
        paletteIndex: -1,
        manualIndex: -1,
      });
      expect(r.result.cells[1].blank).toBe(false);
      expect(r.result.counts).toEqual([1, 0]);
    }
  });

  it('透明度不是 0 或 255 时拒绝整图', () => {
    const palette = paletteOf('FF0000\n00FF00');
    for (const a of [1, 128, 254]) {
      const r = quantizePixels(rgba([255, 0, 0, 255], [0, 255, 0, a]), 2, 1, palette);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toContain(`透明度为 ${a}`);
        expect(r.error).toContain('第 1 行第 2 列');
      }
    }
  });

  it('行号、列号按行优先从 1 开始编号', () => {
    const palette = paletteOf('000000\nFFFFFF');
    const r = quantizePixels(
      rgba([0, 0, 0, 255], [255, 255, 255, 255], [255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [255, 255, 255, 255]),
      3,
      2,
      palette,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.result.cells.map((c) => [c.row, c.col])).toEqual([
        [1, 1], [1, 2], [1, 3],
        [2, 1], [2, 2], [2, 3],
      ]);
      expect(r.result.cells.map((c) => c.paletteIndex)).toEqual([0, 1, 1, 0, 0, 1]);
      expect(r.result.counts).toEqual([3, 3]);
    }
  });

  it('保留原图 8 位 sRGB 整数颜色', () => {
    const palette = paletteOf('010203\nFFFFFF');
    const r = quantizePixels(rgba([1, 2, 3, 255]), 1, 1, palette);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result.cells[0].src).toEqual({ r: 1, g: 2, b: 3 });
  });
});
