import type { CellInfo, GridResult } from './types';

/** 某格最终采用的色板下标（0 起始）：有人工指定时优先人工指定，否则取自动命中 */
export function effectiveIndex(cell: CellInfo): number {
  return cell.manualIndex >= 0 ? cell.manualIndex : cell.paletteIndex;
}

/** 该格是否已被人工校色（空格永远不算） */
export function isManual(cell: CellInfo): boolean {
  return !cell.blank && cell.manualIndex >= 0;
}

export type OverrideMap = ReadonlyMap<number, number>;

/**
 * 以自动映射结果为底，叠加逐格人工校色（单元格行优先下标 → 人工色板下标），
 * 集中合成最终色号并重新统计片数。网格、统计与导出都以合成结果为唯一来源；
 * 覆盖集为空时输出与自动映射逐格一致。
 */
export function applyOverrides(base: GridResult, overrides: OverrideMap): GridResult {
  // 人工命中完全由覆盖集合决定：剥离或恢复只需改集合，自动命中始终保留在底图
  const cells = base.cells.map((cell) => {
    const idx = (cell.row - 1) * base.width + (cell.col - 1);
    const manual = cell.blank ? -1 : overrides.get(idx) ?? -1;
    return manual === cell.manualIndex ? cell : { ...cell, manualIndex: manual };
  });

  const counts = new Array<number>(base.counts.length).fill(0);
  for (const cell of cells) {
    if (cell.blank) continue;
    counts[effectiveIndex(cell)]++;
  }
  return { width: base.width, height: base.height, cells, counts };
}
