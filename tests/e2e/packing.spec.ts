import { expect, test, type Page } from '@playwright/test';
import { makePng, px, TRANSPARENT } from './helpers';
import { DEFAULT_CELL_SIZE, GRID_LABEL_H, GRID_LABEL_W } from '../../src/core/layout';

const FILE_INPUT = '[data-testid="file-input"]';
const PALETTE_INPUT = '[data-testid="palette-input"]';
const APPLY_BUTTON = '[data-testid="apply-palette"]';
const GRID_CANVAS = '[data-testid="grid-canvas"]';
const EXPORT_PREVIEW = '[data-testid="export-preview"]';
const CAPACITY_INPUT = '[data-testid="capacity-input"]';
const CREATE_BUTTON = '[data-testid="create-plan"]';
const CAPACITY_ERROR = '[data-testid="capacity-error"]';
const PLAN = '[data-testid="packing-plan"]';
const SUMMARY = '[data-testid="packing-summary"]';
const PROGRESS = '[data-testid="packing-progress"]';
const NEXT = '[data-testid="packing-next"]';
const COMPLETE = '[data-testid="packing-complete"]';

const PALETTE_RGB = ['FF0000', '00FF00', '0000FF'].join('\n');
// 4×2：红 红 绿 绿 / 蓝 蓝 蓝 透明 → 红 2 片、绿 2 片、蓝 3 片
const PNG = makePng(4, 2, [
  px('FF0000'), px('FF0000'), px('00FF00'), px('00FF00'),
  px('0000FF'), px('0000FF'), px('0000FF'), TRANSPARENT,
]);
const EXPORT_TEXT = [
  '1\t1\t1', '1\t2\t1', '1\t3\t2', '1\t4\t2',
  '2\t1\t3', '2\t2\t3', '2\t3\t3',
].join('\n');

async function setupMapped(page: Page) {
  await page.goto('/');
  await page.setInputFiles(FILE_INPUT, { name: 'case.png', mimeType: 'image/png', buffer: PNG });
  await page.fill(PALETTE_INPUT, PALETTE_RGB);
  await page.click(APPLY_BUTTON);
}

/** 网格中某格中心在页面中的坐标（先把画布滚动回视口内） */
async function cellCenter(page: Page, row: number, col: number) {
  await page.locator(GRID_CANVAS).scrollIntoViewIfNeeded();
  const box = await page.locator(GRID_CANVAS).boundingBox();
  if (!box) throw new Error('网格画布不存在');
  const s = DEFAULT_CELL_SIZE;
  return {
    x: box.x + GRID_LABEL_W + (col - 0.5) * s,
    y: box.y + GRID_LABEL_H + (row - 0.5) * s,
  };
}

function statsCount(page: Page, index: number) {
  return page.locator(`[data-testid="stats-row-${index}"] .count`);
}

/** 批次单中某箱的某一列（box-number/color-index/range/count） */
function boxCell(page: Page, boxNumber: number, field: string) {
  return page.locator(`[data-testid="pack-box-${boxNumber}"] .${field}`);
}

test('映射后创建批次单，逐箱装完走到完成态，网格统计与采购文本不变', async ({ page }) => {
  await page.goto('/');
  // 未完成映射时不可创建
  await expect(page.locator(CREATE_BUTTON)).toBeDisabled();
  await expect(page.locator('[data-testid="packing-no-mapping"]')).toBeVisible();

  await page.setInputFiles(FILE_INPUT, { name: 'case.png', mimeType: 'image/png', buffer: PNG });
  await page.fill(PALETTE_INPUT, PALETTE_RGB);
  await page.click(APPLY_BUTTON);
  await expect(page.locator(CREATE_BUTTON)).toBeEnabled();

  // 每箱 2 片：红 2、绿 2、蓝 3 → 4 箱（蓝色连续拆为两箱）
  await page.fill(CAPACITY_INPUT, '2');
  await page.click(CREATE_BUTTON);

  await expect(page.locator(SUMMARY)).toHaveText('每箱 2 片，共 7 片 / 4 箱');
  await expect(page.locator(PROGRESS)).toContainText('已装 0 / 4 箱（0%）');
  await expect(page.locator(NEXT)).toHaveText('下一箱：第 1 箱（色号 1，2 片）');

  // 各箱按色板顺序展示：箱号、色号、坐标范围与片数
  await expect(boxCell(page, 1, 'box-number')).toHaveText('1');
  await expect(boxCell(page, 1, 'color-index')).toHaveText('1');
  await expect(boxCell(page, 1, 'hex')).toHaveText('#FF0000');
  await expect(boxCell(page, 1, 'range')).toHaveText('第 1 行第 1 列 → 第 1 行第 2 列');
  await expect(boxCell(page, 1, 'count')).toHaveText('2');
  await expect(boxCell(page, 2, 'color-index')).toHaveText('2');
  await expect(boxCell(page, 2, 'hex')).toHaveText('#00FF00');
  await expect(boxCell(page, 2, 'range')).toHaveText('第 1 行第 3 列 → 第 1 行第 4 列');
  await expect(boxCell(page, 2, 'count')).toHaveText('2');
  await expect(boxCell(page, 3, 'color-index')).toHaveText('3');
  await expect(boxCell(page, 3, 'hex')).toHaveText('#0000FF');
  await expect(boxCell(page, 3, 'range')).toHaveText('第 2 行第 1 列 → 第 2 行第 2 列');
  await expect(boxCell(page, 3, 'count')).toHaveText('2');
  // 蓝色余下 1 片连续拆为第 4 箱：单片箱只列一个坐标
  await expect(boxCell(page, 4, 'color-index')).toHaveText('3');
  await expect(boxCell(page, 4, 'range')).toHaveText('第 2 行第 3 列');
  await expect(boxCell(page, 4, 'count')).toHaveText('1');

  // 逐箱标记已装：完成比例与下一箱提示即时更新
  await page.click('[data-testid="pack-button-1"]');
  await expect(page.locator(PROGRESS)).toContainText('已装 1 / 4 箱（25%）');
  await expect(page.locator(NEXT)).toHaveText('下一箱：第 2 箱（色号 2，2 片）');
  await expect(page.locator('[data-testid="pack-box-1"] .packed-label')).toHaveText('已装');
  await expect(page.locator('[data-testid="pack-button-1"]')).toHaveCount(0);

  await page.click('[data-testid="pack-button-2"]');
  await expect(page.locator(PROGRESS)).toContainText('已装 2 / 4 箱（50%）');
  await expect(page.locator(NEXT)).toHaveText('下一箱：第 3 箱（色号 3，2 片）');

  await page.click('[data-testid="pack-button-3"]');
  await expect(page.locator(PROGRESS)).toContainText('已装 3 / 4 箱（75%）');
  await expect(page.locator(NEXT)).toHaveText('下一箱：第 4 箱（色号 3，1 片）');

  await page.click('[data-testid="pack-button-4"]');
  await expect(page.locator(PROGRESS)).toContainText('已装 4 / 4 箱（100%）');
  await expect(page.locator(NEXT)).toHaveCount(0);
  await expect(page.locator(COMPLETE)).toHaveText('全部装箱完成：4 箱共 7 片。');

  // 装箱不改变网格、统计与采购文本
  await expect(statsCount(page, 1)).toHaveText('2');
  await expect(statsCount(page, 2)).toHaveText('2');
  await expect(statsCount(page, 3)).toHaveText('3');
  await expect(page.locator(EXPORT_PREVIEW)).toHaveValue(EXPORT_TEXT);
});

test('非法容量定位报错且无副作用，校色与重应用色板清除批次单，全透明不创建记录', async ({ page }) => {
  await setupMapped(page);

  // 空值、小数、越界：定位报错且不创建记录
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toContainText('请填写');
  await expect(page.locator(PLAN)).toHaveCount(0);

  await page.fill(CAPACITY_INPUT, '1.5');
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toContainText('整数');
  await expect(page.locator(PLAN)).toHaveCount(0);

  await page.fill(CAPACITY_INPUT, '0');
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toContainText('1 至 999');
  await expect(page.locator(PLAN)).toHaveCount(0);

  await page.fill(CAPACITY_INPUT, '1000');
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toContainText('1 至 999');
  await expect(page.locator(PLAN)).toHaveCount(0);

  // 合法容量创建批次单并装第 1 箱
  await page.fill(CAPACITY_INPUT, '2');
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toHaveCount(0);
  await expect(page.locator(SUMMARY)).toHaveText('每箱 2 片，共 7 片 / 4 箱');
  await page.click('[data-testid="pack-button-1"]');
  await expect(page.locator(PROGRESS)).toContainText('已装 1 / 4 箱（25%）');

  // 已有批次单时非法容量：报错保留，批次单与装箱进度不受影响
  await page.fill(CAPACITY_INPUT, '0');
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toContainText('1 至 999');
  await expect(page.locator(SUMMARY)).toHaveText('每箱 2 片，共 7 片 / 4 箱');
  await expect(page.locator(PROGRESS)).toContainText('已装 1 / 4 箱（25%）');
  await expect(page.locator('[data-testid="pack-box-1"] .packed-label')).toHaveText('已装');
  await expect(page.locator('[data-testid="pack-button-2"]')).toBeVisible();

  // 改回合法容量可重新创建（装箱状态随之重置）
  await page.fill(CAPACITY_INPUT, '2');
  await page.click(CREATE_BUTTON);
  await expect(page.locator(CAPACITY_ERROR)).toHaveCount(0);
  await expect(page.locator(PROGRESS)).toContainText('已装 0 / 4 箱（0%）');

  // 人工校色：第 1 行第 1 列由红改蓝 → 批次单清除，避免现场沿用旧计划
  const p = await cellCenter(page, 1, 1);
  await page.mouse.click(p.x, p.y);
  await page.click('[data-testid="color-option-3"]');
  await expect(statsCount(page, 1)).toHaveText('1');
  await expect(statsCount(page, 3)).toHaveText('4');
  await expect(page.locator(PLAN)).toHaveCount(0);

  // 按校色后的最终映射重新创建：红 1、绿 2、蓝 4 → 4 箱
  await page.click(CREATE_BUTTON);
  await expect(page.locator(SUMMARY)).toHaveText('每箱 2 片，共 7 片 / 4 箱');
  await expect(boxCell(page, 1, 'color-index')).toHaveText('1');
  await expect(boxCell(page, 1, 'range')).toHaveText('第 1 行第 2 列');
  await expect(boxCell(page, 1, 'count')).toHaveText('1');
  await expect(boxCell(page, 3, 'color-index')).toHaveText('3');
  await expect(boxCell(page, 3, 'range')).toHaveText('第 1 行第 1 列 → 第 2 行第 1 列');
  await expect(boxCell(page, 4, 'range')).toHaveText('第 2 行第 2 列 → 第 2 行第 3 列');

  // 重新应用色板：批次单清除
  await page.click(APPLY_BUTTON);
  await expect(page.locator(PLAN)).toHaveCount(0);

  // 全透明版图：提示没有可装箱玻璃，不创建记录
  const blank = makePng(2, 2, [TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT]);
  await page.setInputFiles(FILE_INPUT, { name: 'blank.png', mimeType: 'image/png', buffer: blank });
  await expect(page.locator('[data-testid="packing-no-pieces"]')).toBeVisible();
  await expect(page.locator(CREATE_BUTTON)).toBeDisabled();
  await expect(page.locator(PLAN)).toHaveCount(0);
});
