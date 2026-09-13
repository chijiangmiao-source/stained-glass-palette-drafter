import { expect, test, type Page } from '@playwright/test';
import { makePng, px, TRANSPARENT } from './helpers';
import { DEFAULT_CELL_SIZE, GRID_LABEL_H, GRID_LABEL_W } from '../../src/core/layout';

const FILE_INPUT = '[data-testid="file-input"]';
const PALETTE_INPUT = '[data-testid="palette-input"]';
const APPLY_BUTTON = '[data-testid="apply-palette"]';
const GRID_CANVAS = '[data-testid="grid-canvas"]';
const EXPORT_PREVIEW = '[data-testid="export-preview"]';
const GENERATE_BUTTON = '[data-testid="generate-check"]';
const CLEAR_BUTTON = '[data-testid="clear-check"]';
const CHECK_SHEET = '[data-testid="check-sheet"]';
const CHECK_SUMMARY = '[data-testid="check-summary"]';
const STALE_NOTICE = '[data-testid="stale-notice"]';
const STOCK_ERRORS = '[data-testid="stock-errors"]';

const PALETTE_RGB = ['FF0000', '00FF00', '0000FF'].join('\n');
// 2×2：红、绿 / 蓝、透明 → 红绿蓝各 1 片
const PNG = makePng(2, 2, [px('FF0000'), px('00FF00'), px('0000FF'), TRANSPARENT]);
const EXPORT_TEXT = ['1\t1\t1', '1\t2\t2', '2\t1\t3'].join('\n');

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

/** 核验单中某色号行的某一列（demand/stock/allocated/remaining/shortfall） */
function checkCell(page: Page, index: number, field: string) {
  return page.locator(`[data-testid="check-row-${index}"] .${field}`);
}

test('录入库存生成核验单：充足结果逐色正确，人工校色后旧单提示过期', async ({ page }) => {
  await setupMapped(page);

  // 录入各色号库存（非负整数）并生成核验单
  await page.fill('[data-testid="stock-input-1"]', '3');
  await page.fill('[data-testid="stock-input-2"]', '1');
  await page.fill('[data-testid="stock-input-3"]', '2');
  await page.click(GENERATE_BUTTON);

  // 逐色核对：需求快照、可用库存、领用量、剩余量、缺口
  await expect(checkCell(page, 1, 'demand')).toHaveText('1');
  await expect(checkCell(page, 1, 'stock')).toHaveText('3');
  await expect(checkCell(page, 1, 'allocated')).toHaveText('1');
  await expect(checkCell(page, 1, 'remaining')).toHaveText('2');
  await expect(checkCell(page, 1, 'shortfall')).toHaveText('0');
  await expect(checkCell(page, 2, 'demand')).toHaveText('1');
  await expect(checkCell(page, 2, 'stock')).toHaveText('1');
  await expect(checkCell(page, 2, 'allocated')).toHaveText('1');
  await expect(checkCell(page, 2, 'remaining')).toHaveText('0');
  await expect(checkCell(page, 2, 'shortfall')).toHaveText('0');
  await expect(checkCell(page, 3, 'demand')).toHaveText('1');
  await expect(checkCell(page, 3, 'stock')).toHaveText('2');
  await expect(checkCell(page, 3, 'allocated')).toHaveText('1');
  await expect(checkCell(page, 3, 'remaining')).toHaveText('1');
  await expect(checkCell(page, 3, 'shortfall')).toHaveText('0');
  await expect(page.locator(CHECK_SUMMARY)).toHaveText('可直接备料');
  await expect(page.locator(STALE_NOTICE)).toHaveCount(0);

  // 核验不改变网格统计与采购文本
  await expect(statsCount(page, 1)).toHaveText('1');
  await expect(statsCount(page, 2)).toHaveText('1');
  await expect(statsCount(page, 3)).toHaveText('1');
  await expect(page.locator(EXPORT_PREVIEW)).toHaveValue(EXPORT_TEXT);

  // 人工校色：第 1 行第 2 列由绿改蓝 → 最终计数变为 1/0/2
  const p = await cellCenter(page, 1, 2);
  await page.mouse.click(p.x, p.y);
  await page.click('[data-testid="color-option-3"]');
  await expect(statsCount(page, 2)).toHaveText('0');
  await expect(statsCount(page, 3)).toHaveText('2');

  // 旧核验单保留为已过期快照并明确提示重新生成
  await expect(page.locator(STALE_NOTICE)).toBeVisible();
  await expect(page.locator(STALE_NOTICE)).toContainText('已过期');
  await expect(page.locator(STALE_NOTICE)).toContainText('重新生成');
  // 快照内容不随校色变化，表单中的当前需求已同步为最新计数
  await expect(checkCell(page, 2, 'demand')).toHaveText('1');
  await expect(page.locator(CHECK_SUMMARY)).toHaveText('可直接备料');
  await expect(page.locator('[data-testid="stock-demand-2"]')).toHaveText('0');
  await expect(page.locator('[data-testid="stock-demand-3"]')).toHaveText('2');

  // 库存草稿保留，直接重新生成：新快照覆盖旧单，过期提示消失
  await page.click(GENERATE_BUTTON);
  await expect(page.locator(STALE_NOTICE)).toHaveCount(0);
  await expect(checkCell(page, 2, 'demand')).toHaveText('0');
  await expect(checkCell(page, 2, 'allocated')).toHaveText('0');
  await expect(checkCell(page, 2, 'remaining')).toHaveText('1');
  await expect(checkCell(page, 3, 'demand')).toHaveText('2');
  await expect(checkCell(page, 3, 'allocated')).toHaveText('2');
  await expect(checkCell(page, 3, 'remaining')).toHaveText('0');
  await expect(page.locator(CHECK_SUMMARY)).toHaveText('可直接备料');
});

test('非法库存定位到色号并阻止生成，零库存参与缺口，清空只移除核验单与草稿', async ({ page }) => {
  await page.goto('/');
  // 未完成映射时不可生成
  await expect(page.locator(GENERATE_BUTTON)).toBeDisabled();
  await expect(page.locator('[data-testid="inventory-no-palette"]')).toBeVisible();

  await page.setInputFiles(FILE_INPUT, { name: 'case.png', mimeType: 'image/png', buffer: PNG });
  await page.fill(PALETTE_INPUT, PALETTE_RGB);
  await page.click(APPLY_BUTTON);
  await expect(page.locator(GENERATE_BUTTON)).toBeEnabled();

  // 空值：三个色号均未填写，全部定位并阻止生成
  await page.click(GENERATE_BUTTON);
  await expect(page.locator('[data-testid="stock-error-1"]')).toContainText('色号 1');
  await expect(page.locator('[data-testid="stock-error-1"]')).toContainText('未填写');
  await expect(page.locator('[data-testid="stock-error-2"]')).toContainText('色号 2');
  await expect(page.locator('[data-testid="stock-error-3"]')).toContainText('色号 3');
  await expect(page.locator(CHECK_SHEET)).toHaveCount(0);

  // 负数：定位到色号 1 并阻止生成
  await page.fill('[data-testid="stock-input-1"]', '-2');
  await page.click(GENERATE_BUTTON);
  await expect(page.locator('[data-testid="stock-error-1"]')).toContainText('色号 1');
  await expect(page.locator('[data-testid="stock-error-1"]')).toContainText('负数');
  await expect(page.locator(CHECK_SHEET)).toHaveCount(0);

  // 小数与超出安全整数同样定位并阻止；色号 2 的零库存合法不报错
  await page.fill('[data-testid="stock-input-1"]', '1.5');
  await page.fill('[data-testid="stock-input-2"]', '0');
  await page.fill('[data-testid="stock-input-3"]', '9007199254740992');
  await page.click(GENERATE_BUTTON);
  await expect(page.locator('[data-testid="stock-error-1"]')).toContainText('整数');
  await expect(page.locator('[data-testid="stock-error-3"]')).toContainText('安全整数');
  await expect(page.locator('[data-testid="stock-error-2"]')).toHaveCount(0);
  await expect(page.locator(CHECK_SHEET)).toHaveCount(0);

  // 全部改为合法的零库存：仍参与缺口计算，汇总为库存不足
  await page.fill('[data-testid="stock-input-1"]', '0');
  await page.fill('[data-testid="stock-input-3"]', '0');
  await page.click(GENERATE_BUTTON);
  await expect(page.locator(STOCK_ERRORS)).toHaveCount(0);
  await expect(checkCell(page, 1, 'stock')).toHaveText('0');
  await expect(checkCell(page, 1, 'allocated')).toHaveText('0');
  await expect(checkCell(page, 1, 'remaining')).toHaveText('0');
  await expect(checkCell(page, 1, 'shortfall')).toHaveText('1');
  await expect(checkCell(page, 3, 'shortfall')).toHaveText('1');
  await expect(page.locator(CHECK_SUMMARY)).toContainText('库存不足');
  await expect(page.locator(CHECK_SUMMARY)).toContainText('3');

  // 清空：只移除核验单与库存草稿，网格统计与采购文本不变
  await page.click(CLEAR_BUTTON);
  await expect(page.locator(CHECK_SHEET)).toHaveCount(0);
  await expect(page.locator(STALE_NOTICE)).toHaveCount(0);
  await expect(page.locator(STOCK_ERRORS)).toHaveCount(0);
  await expect(page.locator('[data-testid="stock-input-1"]')).toHaveValue('');
  await expect(page.locator('[data-testid="stock-input-2"]')).toHaveValue('');
  await expect(page.locator('[data-testid="stock-input-3"]')).toHaveValue('');
  await expect(page.locator(CLEAR_BUTTON)).toHaveCount(0);
  await expect(statsCount(page, 1)).toHaveText('1');
  await expect(statsCount(page, 2)).toHaveText('1');
  await expect(statsCount(page, 3)).toHaveText('1');
  await expect(page.locator(EXPORT_PREVIEW)).toHaveValue(EXPORT_TEXT);
});
