import type { GridResult, PaletteColor } from './types';

export type QuantizeResult =
  | { ok: true; result: GridResult }
  | { ok: false; error: string };

/**
 * 把 RGBA 像素数组（行优先，每像素 4 字节）映射到色板。
 *
 * 规则：
 * - 透明度为 0 的像素视为空格；
 * - 透明度既不是 0 也不是 255 时拒绝整图；
 * - 不透明像素直接取 8 位 sRGB 整数，与各色板颜色计算三通道差值平方和，
 *   取最小者；并列时取色板中最靠前者。不做伽马转换、抖动或邻域修正。
 */
export function quantizePixels(
  data: ArrayLike<number>,
  width: number,
  height: number,
  palette: PaletteColor[],
): QuantizeResult {
  if (palette.length === 0) {
    return { ok: false, error: '色板为空，无法映射' };
  }
  const total = width * height;
  const cells: GridResult['cells'] = new Array(total);
  const counts: number[] = new Array(palette.length).fill(0);

  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / width) + 1;
    const col = (i % width) + 1;
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];

    if (a === 0) {
      cells[i] = { row, col, blank: true, src: null, paletteIndex: -1, manualIndex: -1 };
      continue;
    }
    if (a !== 255) {
      return {
        ok: false,
        error: `第 ${row} 行第 ${col} 列像素的透明度为 ${a}，仅允许 0 或 255，已拒绝整图`,
      };
    }

    let best = 0;
    let bestDist = Infinity;
    for (let p = 0; p < palette.length; p++) {
      const c = palette[p].rgb;
      const dr = r - c.r;
      const dg = g - c.g;
      const db = b - c.b;
      const dist = dr * dr + dg * dg + db * db;
      // 严格小于才更新：并列时保留最靠前的色板颜色
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }
    counts[best]++;
    cells[i] = {
      row,
      col,
      blank: false,
      src: { r, g, b },
      paletteIndex: best,
      manualIndex: -1,
    };
  }

  return { ok: true, result: { width, height, cells, counts } };
}
