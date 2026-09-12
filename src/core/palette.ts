import type { PaletteColor } from './types';

export const PALETTE_MIN = 2;
export const PALETTE_MAX = 16;

/** 六位大写十六进制色值，如 FF0000 */
const HEX_RE = /^[0-9A-F]{6}$/;

export type PaletteParseResult =
  | { ok: true; colors: PaletteColor[] }
  | { ok: false; error: string };

/**
 * 解析色板输入：以任意空白分隔的 2–16 个六位大写十六进制色值，
 * 依次排列、互不重复。
 */
export function parsePalette(input: string): PaletteParseResult {
  const tokens = input.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < PALETTE_MIN || tokens.length > PALETTE_MAX) {
    return {
      ok: false,
      error: `色板需要 ${PALETTE_MIN} 至 ${PALETTE_MAX} 个色值，当前为 ${tokens.length} 个`,
    };
  }
  const seen = new Set<string>();
  const colors: PaletteColor[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const hex = tokens[i];
    if (!HEX_RE.test(hex)) {
      return {
        ok: false,
        error: `第 ${i + 1} 个色值「${hex}」不是六位大写十六进制色值`,
      };
    }
    if (seen.has(hex)) {
      return { ok: false, error: `色值 ${hex} 重复出现，色板颜色必须互不重复` };
    }
    seen.add(hex);
    colors.push({
      hex,
      rgb: {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      },
    });
  }
  return { ok: true, colors };
}
