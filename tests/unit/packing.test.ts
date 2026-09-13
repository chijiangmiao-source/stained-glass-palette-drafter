import { describe, expect, it } from 'vitest';
import {
  buildPackingPlan,
  capacityErrorText,
  markBoxPacked,
  nextUnpackedBox,
  packedBoxCount,
  parseCapacity,
  PACKING_CAPACITY_MAX,
  PACKING_CAPACITY_MIN,
} from '../../src/core/packing';
import { parsePalette } from '../../src/core/palette';
import { quantizePixels } from '../../src/core/quantize';
import { applyOverrides } from '../../src/core/mapping';
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

const PALETTE = paletteOf('FF0000\n00FF00\n0000FF');

const R = [255, 0, 0, 255];
const G = [0, 255, 0, 255];
const B = [0, 0, 255, 255];
const T = [0, 0, 0, 0]; // 全透明

function rgba(...pixels: number[][]): number[] {
  return pixels.flat();
}

describe('buildPackingPlan：分组顺序与连续拆箱', () => {
  it('按色板顺序分组，同色按行优先排列，箱号连续', () => {
    // 3×2：蓝 红 绿 / 红 蓝 绿 → 红 2 片、绿 2 片、蓝 2 片（刻意交错，验证只跟随色号与行列）
    const grid = gridOf(rgba(B, R, G, R, B, G), 3, 2, PALETTE);
    const plan = buildPackingPlan(grid, PALETTE, 10);
    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.capacity).toBe(10);
    expect(plan.totalPieces).toBe(6);
    expect(plan.totalBoxes).toBe(3);
    expect(
      plan.boxes.map((b) => [b.boxNumber, b.colorIndex, b.hex, b.count]),
    ).toEqual([
      [1, 1, 'FF0000', 2],
      [2, 2, '00FF00', 2],
      [3, 3, '0000FF', 2],
    ]);
    // 同色坐标按行优先（行号、列号）顺序
    expect(plan.boxes[0].pieces).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
    ]);
    expect(plan.boxes[1].pieces).toEqual([
      { row: 1, col: 3 },
      { row: 2, col: 3 },
    ]);
    expect(plan.boxes[2].pieces).toEqual([
      { row: 1, col: 1 },
      { row: 2, col: 2 },
    ]);
  });

  it('同色数量超过容量时连续拆箱，最后一箱不足容量', () => {
    // 5×1：5 个红 → 容量 2 时拆为 2/2/1 三箱
    const grid = gridOf(rgba(R, R, R, R, R), 5, 1, PALETTE);
    const plan = buildPackingPlan(grid, PALETTE, 2);
    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.totalBoxes).toBe(3);
    expect(plan.boxes.map((b) => [b.boxNumber, b.count])).toEqual([
      [1, 2],
      [2, 2],
      [3, 1],
    ]);
    expect(plan.boxes[0].pieces).toEqual([
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]);
    expect(plan.boxes[1].pieces).toEqual([
      { row: 1, col: 3 },
      { row: 1, col: 4 },
    ]);
    expect(plan.boxes[2].pieces).toEqual([{ row: 1, col: 5 }]);
    expect(plan.boxes.every((b) => b.colorIndex === 1)).toBe(true);
  });

  it('数量恰好是容量整数倍时不产生空箱', () => {
    const grid = gridOf(rgba(R, R, R, R), 2, 2, PALETTE);
    const plan = buildPackingPlan(grid, PALETTE, 2);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.totalBoxes).toBe(2);
    expect(plan.boxes.map((b) => b.count)).toEqual([2, 2]);
  });

  it('片数为 0 的色号不占箱，箱号跳过该色继续连续编号', () => {
    // 2×1：红 蓝 → 绿（色号 2）为 0 片
    const grid = gridOf(rgba(R, B), 2, 1, PALETTE);
    const plan = buildPackingPlan(grid, PALETTE, 5);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.boxes.map((b) => [b.boxNumber, b.colorIndex])).toEqual([
      [1, 1],
      [2, 3],
    ]);
  });

  it('分组跟随人工校色后的最终色号', () => {
    // 2×2：红 绿 / 蓝 透明；把第 1 行第 2 列由绿改为蓝
    const base = gridOf(rgba(R, G, B, T), 2, 2, PALETTE);
    const final = applyOverrides(base, new Map([[1, 2]]));
    const plan = buildPackingPlan(final, PALETTE, 10);
    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.totalPieces).toBe(3);
    expect(plan.boxes.map((b) => [b.boxNumber, b.colorIndex, b.count])).toEqual([
      [1, 1, 1],
      [2, 3, 2],
    ]);
    expect(plan.boxes[1].pieces).toEqual([
      { row: 1, col: 2 },
      { row: 2, col: 1 },
    ]);
  });

  it('全透明版图返回 null：没有可装箱玻璃，不创建记录', () => {
    const grid = gridOf(rgba(T, T, T, T), 2, 2, PALETTE);
    expect(buildPackingPlan(grid, PALETTE, 10)).toBeNull();
  });
});

describe('buildPackingPlan：容量边界', () => {
  // 3×1：红 绿 蓝 各 1 片
  const grid = gridOf(rgba(R, G, B), 3, 1, PALETTE);

  it('容量为 1 时每片独占一箱', () => {
    const plan = buildPackingPlan(grid, PALETTE, PACKING_CAPACITY_MIN);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.totalBoxes).toBe(3);
    expect(plan.boxes.map((b) => [b.boxNumber, b.colorIndex, b.count])).toEqual([
      [1, 1, 1],
      [2, 2, 1],
      [3, 3, 1],
    ]);
  });

  it('容量为 999 时每色一箱装完', () => {
    const plan = buildPackingPlan(grid, PALETTE, PACKING_CAPACITY_MAX);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.totalBoxes).toBe(3);
    expect(plan.boxes.map((b) => b.count)).toEqual([1, 1, 1]);
  });

  it('容量恰等于同色数量时只拆一箱', () => {
    const two = gridOf(rgba(R, R), 2, 1, PALETTE);
    const plan = buildPackingPlan(two, PALETTE, 2);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.totalBoxes).toBe(1);
    expect(plan.boxes[0].count).toBe(2);
  });
});

describe('buildPackingPlan：坐标无遗漏无重复', () => {
  it('各箱坐标合并后恰好等于全部非透明格，每格只出现一次', () => {
    // 4×3：含透明格与三种颜色交错，容量 3 迫使多色拆箱
    const pixels = [
      R, G, T, B,
      B, R, G, T,
      G, B, R, R,
    ];
    const grid = gridOf(rgba(...pixels), 4, 3, PALETTE);
    const expected: string[] = [];
    grid.cells.forEach((cell) => {
      if (!cell.blank) expected.push(`${cell.row},${cell.col}`);
    });

    const plan = buildPackingPlan(grid, PALETTE, 3);
    expect(plan).not.toBeNull();
    if (!plan) return;

    const actual = plan.boxes.flatMap((b) => b.pieces.map((p) => `${p.row},${p.col}`));
    // 无重复
    expect(new Set(actual).size).toBe(actual.length);
    // 无遗漏：与全部非透明格一一对应
    expect([...actual].sort()).toEqual([...expected].sort());
    // 片数汇总一致
    expect(plan.boxes.reduce((n, b) => n + b.count, 0)).toBe(expected.length);
    expect(plan.totalPieces).toBe(expected.length);
    // 每箱 count 与坐标数组等长
    for (const box of plan.boxes) {
      expect(box.count).toBe(box.pieces.length);
    }
  });
});

describe('parseCapacity：输入边界', () => {
  it('接受 1–999 的整数（含端点与前后空白）', () => {
    expect(parseCapacity('1')).toEqual({ ok: true, value: 1 });
    expect(parseCapacity('999')).toEqual({ ok: true, value: 999 });
    expect(parseCapacity('  24  ')).toEqual({ ok: true, value: 24 });
    expect(parseCapacity('007')).toEqual({ ok: true, value: 7 });
  });

  it('空值被拒绝', () => {
    expect(parseCapacity('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseCapacity('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('负数被拒绝', () => {
    expect(parseCapacity('-1')).toEqual({ ok: false, reason: 'negative' });
    expect(parseCapacity('-2.5')).toEqual({ ok: false, reason: 'negative' });
  });

  it('小数被拒绝', () => {
    expect(parseCapacity('1.5')).toEqual({ ok: false, reason: 'decimal' });
    expect(parseCapacity('2.')).toEqual({ ok: false, reason: 'decimal' });
    expect(parseCapacity('.5')).toEqual({ ok: false, reason: 'decimal' });
  });

  it('越界被拒绝：0 与超过 999', () => {
    expect(parseCapacity('0')).toEqual({ ok: false, reason: 'outOfRange' });
    expect(parseCapacity('1000')).toEqual({ ok: false, reason: 'outOfRange' });
    expect(parseCapacity('999999')).toEqual({ ok: false, reason: 'outOfRange' });
  });

  it('其它非数字内容被拒绝', () => {
    expect(parseCapacity('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCapacity('1e3')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseCapacity('0x10')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('错误原因有明确中文描述', () => {
    expect(capacityErrorText('empty')).toContain('请填写');
    expect(capacityErrorText('negative')).toContain('负数');
    expect(capacityErrorText('decimal')).toContain('整数');
    expect(capacityErrorText('outOfRange')).toContain('1 至 999');
    expect(capacityErrorText('invalid')).toContain('有效的整数');
  });
});

describe('批次单装箱进度', () => {
  // 2×2：红 红 / 绿 透明 → 容量 1：第 1、2 箱红，第 3 箱绿
  const grid = gridOf(rgba(R, R, G, T), 2, 2, PALETTE);

  it('新批次单全部未装，下一箱为第 1 箱', () => {
    const plan = buildPackingPlan(grid, PALETTE, 1);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.boxes.every((b) => !b.packed)).toBe(true);
    expect(packedBoxCount(plan)).toBe(0);
    expect(nextUnpackedBox(plan)?.boxNumber).toBe(1);
  });

  it('标记已装只更新指定箱，原批次单不被修改', () => {
    const plan = buildPackingPlan(grid, PALETTE, 1);
    if (!plan) throw new Error('应有批次单');
    const next = markBoxPacked(plan, 2);

    expect(next).not.toBe(plan);
    expect(next.boxes[1].packed).toBe(true);
    expect(plan.boxes[1].packed).toBe(false); // 原单不变
    expect(packedBoxCount(next)).toBe(1);
    expect(nextUnpackedBox(next)?.boxNumber).toBe(1); // 第 1 箱仍未装
  });

  it('逐箱装完后下一箱为 null，未知箱号与重复标记原样返回', () => {
    let plan = buildPackingPlan(grid, PALETTE, 1);
    if (!plan) throw new Error('应有批次单');

    expect(markBoxPacked(plan, 99)).toBe(plan); // 未知箱号：原样返回
    plan = markBoxPacked(plan, 1);
    expect(markBoxPacked(plan, 1)).toBe(plan); // 重复标记：原样返回

    plan = markBoxPacked(plan, 2);
    expect(nextUnpackedBox(plan)?.boxNumber).toBe(3);
    plan = markBoxPacked(plan, 3);
    expect(packedBoxCount(plan)).toBe(3);
    expect(nextUnpackedBox(plan)).toBeNull();
  });
});
