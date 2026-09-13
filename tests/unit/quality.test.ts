import { describe, expect, it } from 'vitest';
import { parsePalette } from '../../src/core/palette';
import { quantizePixels } from '../../src/core/quantize';
import { applyOverrides } from '../../src/core/mapping';
import {
  buildQualityReport,
  colorSquaredDistance,
  parseThreshold,
  QUALITY_THRESHOLD_MAX,
  thresholdErrorText,
} from '../../src/core/quality';
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

describe('colorSquaredDistance', () => {
  it('按三通道差值平方和计算距离', () => {
    expect(colorSquaredDistance({ r: 10, g: 20, b: 30 }, { r: 13, g: 16, b: 60 })).toBe(
      3 * 3 + 4 * 4 + 30 * 30,
    );
  });

  it('同色距离为 0，最大可能距离为 3×255² = 195075', () => {
    expect(colorSquaredDistance({ r: 7, g: 8, b: 9 }, { r: 7, g: 8, b: 9 })).toBe(0);
    expect(colorSquaredDistance({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBe(
      QUALITY_THRESHOLD_MAX,
    );
  });
});

describe('buildQualityReport：自动命中样本', () => {
  const palette = paletteOf('FF0000\n00FF00\n0000FF');
  // 2×2：精确红（dist 0）、近蓝 0000FE（自动蓝，dist 1）/ 黑 000000（三色并列取红，dist 65025）、透明
  const rgba = [
    255, 0, 0, 255,
    0, 0, 254, 255,
    0, 0, 0, 255,
    0, 0, 0, 0,
  ];

  it('阈值 0 时所有与最终选色不完全一致的非空格均超限', () => {
    const base = gridOf(rgba, 2, 2, palette);
    const report = buildQualityReport(base, palette, 0);

    expect(report.overCount).toBe(2);
    expect(report.maxDistance).toBe(65025);
    expect(report.issues.map((i) => [i.row, i.col, i.distance])).toEqual([
      [1, 2, 1],
      [2, 1, 65025],
    ]);
  });

  it('阈值边界：距离等于上限不算超限，严格大于才算', () => {
    const base = gridOf(rgba, 2, 2, palette);

    // 上限 1：dist 1 的格恰好等于上限，不超限；仅 dist 65025 的格超限
    const atOne = buildQualityReport(base, palette, 1);
    expect(atOne.overCount).toBe(1);
    expect(atOne.issues.map((i) => [i.row, i.col])).toEqual([[2, 1]]);
    expect(atOne.maxDistance).toBe(65025);

    // 上限 65025：最大偏差也恰好等于上限，无超限格
    const atMax = buildQualityReport(base, palette, 65025);
    expect(atMax.overCount).toBe(0);
    expect(atMax.issues).toEqual([]);
    expect(atMax.maxDistance).toBe(0);
  });

  it('明细按行号、列号（行优先）排序，携带原色、最终色板下标与线性下标', () => {
    // 3×2：红、近蓝、黑（并列红）/ 绿、近红 7F0000、透明
    const data = [
      255, 0, 0, 255,
      0, 0, 254, 255,
      0, 0, 0, 255,
      0, 255, 0, 255,
      127, 0, 0, 255,
      0, 0, 0, 0,
    ];
    const base = gridOf(data, 3, 2, palette);
    const report = buildQualityReport(base, palette, 0);

    expect(report.issues.map((i) => [i.row, i.col])).toEqual([
      [1, 2],
      [1, 3],
      [2, 2],
    ]);
    const [a, b, c] = report.issues;
    expect(a.index).toBe(1);
    expect(a.src).toEqual({ r: 0, g: 0, b: 254 });
    expect(a.paletteIndex).toBe(2); // 最终选色为蓝
    expect(b.index).toBe(2);
    expect(b.paletteIndex).toBe(0); // 并列取最前的红
    expect(c.index).toBe(4);
    expect(c.distance).toBe(128 * 128); // 16384
    expect(report.maxDistance).toBe(65025);
  });

  it('透明空格不参与核查，全透明版图为零个超限格', () => {
    const base = gridOf([0, 0, 0, 0, 0, 0, 0, 0], 2, 1, palette);
    const report = buildQualityReport(base, palette, 0);
    expect(report.overCount).toBe(0);
    expect(report.maxDistance).toBe(0);
    expect(report.issues).toEqual([]);
  });
});

describe('buildQualityReport：人工改色样本', () => {
  const palette = paletteOf('FF0000\n00FF00\n0000FF');
  // 1×2：近蓝 0000FE（自动蓝 dist 1）、精确绿（dist 0）
  const rgba = [0, 0, 254, 255, 0, 255, 0, 255];

  it('距离对最终选色（人工色号）计算，而非自动命中', () => {
    const base = gridOf(rgba, 2, 1, palette);
    // 第 1 列（idx 0）由自动蓝改为红：0000FE 对 FF0000 = 255² + 0² + 254² = 129541
    const result = applyOverrides(base, new Map([[0, 0]]));
    const report = buildQualityReport(result, palette, 0);

    expect(report.overCount).toBe(1);
    const issue = report.issues[0];
    expect([issue.row, issue.col]).toEqual([1, 1]);
    expect(issue.paletteIndex).toBe(0); // 人工色号
    expect(issue.distance).toBe(255 * 255 + 254 * 254);
    expect(report.maxDistance).toBe(129541);
  });

  it('人工色导致的超阈值在阈值边界两侧行为正确', () => {
    const base = gridOf(rgba, 2, 1, palette);
    const result = applyOverrides(base, new Map([[0, 0]]));

    expect(buildQualityReport(result, palette, 129540).overCount).toBe(1);
    // 距离恰好等于上限：不超限
    const atBoundary = buildQualityReport(result, palette, 129541);
    expect(atBoundary.overCount).toBe(0);
    expect(atBoundary.maxDistance).toBe(0);
  });

  it('人工改色后核查结果即时重算：同格反复改色距离随之变化', () => {
    const base = gridOf(rgba, 2, 1, palette);
    // 第 1 列改绿：0000FE 对 00FF00 = 255² + 254² = 129541（红通道差值为 0）
    const green = applyOverrides(base, new Map([[0, 1]]));
    expect(buildQualityReport(green, palette, 0).issues[0].distance).toBe(129541);
    // 改回蓝（与自动一致）：距离回到 1
    const blue = applyOverrides(base, new Map([[0, 2]]));
    const report = buildQualityReport(blue, palette, 0);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].distance).toBe(1);
    expect(report.issues[0].paletteIndex).toBe(2);
  });
});

describe('parseThreshold', () => {
  it('接受 0 至 195075 的十进制整数（含两端边界）并容忍首尾空白', () => {
    expect(parseThreshold('0')).toEqual({ ok: true, value: 0 });
    expect(parseThreshold(String(QUALITY_THRESHOLD_MAX))).toEqual({ ok: true, value: 195075 });
    expect(parseThreshold('  5000 ')).toEqual({ ok: true, value: 5000 });
  });

  it('空值（含纯空白）报 empty', () => {
    expect(parseThreshold('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseThreshold('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('负数（含负小数）报 negative', () => {
    expect(parseThreshold('-1')).toEqual({ ok: false, reason: 'negative' });
    expect(parseThreshold('-0')).toEqual({ ok: false, reason: 'negative' });
    expect(parseThreshold('-1.5')).toEqual({ ok: false, reason: 'negative' });
  });

  it('小数报 decimal', () => {
    expect(parseThreshold('1.5')).toEqual({ ok: false, reason: 'decimal' });
    expect(parseThreshold('0.0')).toEqual({ ok: false, reason: 'decimal' });
    expect(parseThreshold('.5')).toEqual({ ok: false, reason: 'decimal' });
  });

  it('超出 0–195075 报 outOfRange', () => {
    expect(parseThreshold('195076')).toEqual({ ok: false, reason: 'outOfRange' });
    expect(parseThreshold('99999999999999999999')).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('其它非整数内容报 invalid，且每种原因都有中文说明', () => {
    expect(parseThreshold('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseThreshold('1e3')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseThreshold('12px')).toEqual({ ok: false, reason: 'invalid' });
    for (const reason of ['empty', 'negative', 'decimal', 'outOfRange', 'invalid'] as const) {
      expect(thresholdErrorText(reason).length).toBeGreaterThan(0);
    }
  });
});
