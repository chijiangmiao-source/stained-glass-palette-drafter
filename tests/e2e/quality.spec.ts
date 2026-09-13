import { expect, test, type Page } from '@playwright/test';
import { makePng, px, TRANSPARENT } from './helpers';
import { DEFAULT_CELL_SIZE, GRID_LABEL_H, GRID_LABEL_W, QUALITY_STROKE } from '../../src/core/layout';

const FILE_INPUT = '[data-testid="file-input"]';
const PALETTE_INPUT = '[data-testid="palette-input"]';
const APPLY_BUTTON = '[data-testid="apply-palette"]';
const GRID_CANVAS = '[data-testid="grid-canvas"]';
const THRESHOLD_INPUT = '[data-testid="quality-threshold-input"]';
const START_BUTTON = '[data-testid="quality-start"]';
const END_BUTTON = '[data-testid="quality-end"]';
const QUALITY_ERROR = '[data-testid="quality-error"]';
const OVER_COUNT = '[data-testid="quality-over-count"]';
const MAX_DISTANCE = '[data-testid="quality-max-distance"]';
const NO_ISSUES = '[data-testid="quality-no-issues"]';

const PALETTE_RGB = ['FF0000', '00FF00', '0000FF'].join('\n');
// 2×2：精确红、近蓝 0000FE（自动蓝，dist 1）/ 精确绿、透明
const PNG = makePng(2, 2, [px('FF0000'), px('0000FE'), px('00FF00'), TRANSPARENT]);

async function setupMapped(page: Page) {
  await page.goto('/');
  await page.setInputFiles(FILE_INPUT, { name: 'case.png', mimeType: 'image/png', buffer: PNG });
  await page.fill(PALETTE_INPUT, PALETTE_RGB);
  await page.click(APPLY_BUTTON);
}

async function startCheck(page: Page, threshold: string) {
  await page.fill(THRESHOLD_INPUT, threshold);
  await page.click(START_BUTTON);
}

/** 网格中某格中心在页面中的坐标 */
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

/** 读取画布某格内部 (fx, fy) 比例处的实际像素颜色 */
async function readCellPoint(page: Page, row: number, col: number, fx: number, fy: number) {
  return page.evaluate(
    ([lw, lh, s, r, c, fx_, fy_]) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="grid-canvas"]');
      if (!canvas) throw new Error('网格画布不存在');
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法获取画布上下文');
      const x = Math.round((lw + (c - 1 + fx_) * s) * dpr);
      const y = Math.round((lh + (r - 1 + fy_) * s) * dpr);
      return Array.from(ctx.getImageData(x, y, 1, 1).data);
    },
    [GRID_LABEL_W, GRID_LABEL_H, DEFAULT_CELL_SIZE, row, col, fx, fy],
  );
}

const STROKE_RGB = [...Buffer.from(QUALITY_STROKE.slice(1), 'hex').values(), 255].map(Number);

test('开始核查：统计、明细、阈值边界与网格描边一致', async ({ page }) => {
  await setupMapped(page);

  // 未开启时没有结束按钮与统计
  await expect(page.locator(END_BUTTON)).toHaveCount(0);
  await expect(page.locator('[data-testid="quality-summary"]')).toHaveCount(0);

  // 阈值 0：近蓝格 0000FE→蓝 dist 1，超限；精确色不超限；透明格不进入明细
  await startCheck(page, '0');
  await expect(page.locator('[data-testid="quality-summary"]')).toBeVisible();
  await expect(page.locator(OVER_COUNT)).toHaveText('1');
  await expect(page.locator(MAX_DISTANCE)).toHaveText('1');

  // 核查本身不改变映射：采购文本仍是自动映射结果
  await expect(page.locator('[data-testid="export-preview"]')).toHaveValue(
    ['1\t1\t1', '1\t2\t3', '2\t1\t2'].join('\n'),
  );

  const row1 = page.locator('[data-testid="quality-issue-1"]');
  await expect(row1).toContainText('1'); // 行
  await expect(row1).toContainText('2'); // 列
  await expect(row1).toContainText('#0000FE'); // 原色
  await expect(row1).toContainText('#0000FF'); // 最终选色
  await expect(row1).toContainText('色板 3');
  await expect(row1.locator('.distance')).toHaveText('1');
  await expect(page.locator('[data-testid="quality-issue-2"]')).toHaveCount(0);

  // 网格：超限格左边描红边（2px 描边居中于格内 1px 处），未超限格边缘仍是本色
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual(STROKE_RGB);
  expect(await readCellPoint(page, 1, 1, 0.25, 0.5)).toEqual([255, 0, 0, 255]);

  // 阈值边界：上限改为 1，dist 恰好等于上限 → 不超限，零格、描边消失
  await startCheck(page, '1');
  await expect(page.locator(OVER_COUNT)).toHaveText('0');
  await expect(page.locator(MAX_DISTANCE)).toHaveText('0');
  await expect(page.locator(NO_ISSUES)).toBeVisible();
  await expect(page.locator('[data-testid="quality-issues"]')).toHaveCount(0);
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual([0, 0, 255, 255]);
});

test('核查开启时人工改色：明细、统计与网格标记即时联动，恢复自动后回落', async ({ page }) => {
  await setupMapped(page);
  // 上限 129540：自动结果下近蓝格 dist 1 不超限
  await startCheck(page, '129540');
  await expect(page.locator(OVER_COUNT)).toHaveText('0');

  // 点击第 1 行第 2 列，改选色板 1（红）：0000FE→FF0000 dist = 255²+254² = 129541
  const p = await cellCenter(page, 1, 2);
  await page.mouse.click(p.x, p.y);
  await page.click('[data-testid="color-option-1"]');

  await expect(page.locator(OVER_COUNT)).toHaveText('1');
  await expect(page.locator(MAX_DISTANCE)).toHaveText('129541');
  const row1 = page.locator('[data-testid="quality-issue-1"]');
  await expect(row1).toContainText('#0000FE');
  await expect(row1).toContainText('#FF0000');
  await expect(row1).toContainText('色板 1');
  await expect(row1.locator('.distance')).toHaveText('129541');
  // 描边同步出现在该格
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual(STROKE_RGB);

  // 恢复自动计算：dist 回到 1，低于上限，超限格清零、描边消失
  await page.mouse.click(p.x, p.y);
  await page.click('[data-testid="restore-auto"]');
  await expect(page.locator(OVER_COUNT)).toHaveText('0');
  await expect(page.locator(MAX_DISTANCE)).toHaveText('0');
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual([0, 0, 255, 255]);
});

test('结束核查恢复原显示', async ({ page }) => {
  await setupMapped(page);
  await startCheck(page, '0');
  await expect(page.locator(OVER_COUNT)).toBeVisible();
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual(STROKE_RGB);

  await page.click(END_BUTTON);
  await expect(page.locator('[data-testid="quality-summary"]')).toHaveCount(0);
  await expect(page.locator(END_BUTTON)).toHaveCount(0);
  await expect(page.locator(THRESHOLD_INPUT)).toHaveValue('');
  // 网格恢复原显示
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual([0, 0, 255, 255]);
});

test('非法阈值明确报错且无副作用：保留上一次有效结果', async ({ page }) => {
  await setupMapped(page);

  // 未开启时输入非法值：不开启核查
  for (const [value, message] of [
    ['', '请填写色差上限'],
    ['-1', '不能为负数'],
    ['1.5', '必须为整数'],
    ['195076', '0 至 195075'],
    ['abc', '不是有效的整数'],
  ] as const) {
    await page.fill(THRESHOLD_INPUT, value);
    await page.click(START_BUTTON);
    await expect(page.locator(QUALITY_ERROR)).toContainText(message);
    await expect(page.locator(END_BUTTON)).toHaveCount(0);
    await expect(page.locator('[data-testid="quality-summary"]')).toHaveCount(0);
  }

  // 合法阈值正常开启
  await startCheck(page, '0');
  await expect(page.locator(OVER_COUNT)).toHaveText('1');
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual(STROKE_RGB);

  // 已开启后输入各类非法值：报错但上一次结果（统计、明细、描边、开启状态）原样保留
  for (const value of ['  ', '-0.5', '.5', '200000', '1e3']) {
    await page.fill(THRESHOLD_INPUT, value);
    await page.click(START_BUTTON);
    await expect(page.locator(QUALITY_ERROR)).toBeVisible();
    await expect(page.locator(END_BUTTON)).toBeVisible();
    await expect(page.locator(OVER_COUNT)).toHaveText('1');
    await expect(page.locator(MAX_DISTANCE)).toHaveText('1');
    await expect(page.locator('[data-testid="quality-issue-1"]')).toBeVisible();
    expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual(STROKE_RGB);
  }
});

test('全透明版图显示零个超限格', async ({ page }) => {
  await page.goto('/');
  await page.setInputFiles(FILE_INPUT, {
    name: 'blank.png',
    mimeType: 'image/png',
    buffer: makePng(2, 2, [TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT]),
  });
  await page.fill(PALETTE_INPUT, PALETTE_RGB);
  await page.click(APPLY_BUTTON);

  await startCheck(page, '0');
  await expect(page.locator(OVER_COUNT)).toHaveText('0');
  await expect(page.locator(MAX_DISTANCE)).toHaveText('0');
  await expect(page.locator('[data-testid="quality-issues"]')).toHaveCount(0);
  await expect(page.locator(NO_ISSUES)).toBeVisible();
});

test('明细按行列排序，最大偏差取超限格中的最大值', async ({ page }) => {
  // 1×3：7F0000（→红 dist 16384）、000080（→蓝 dist 16129）、FFFF00（黄→红 dist 65025）
  const png = makePng(3, 1, [px('7F0000'), px('000080'), px('FFFF00')]);
  await page.goto('/');
  await page.setInputFiles(FILE_INPUT, { name: 'row.png', mimeType: 'image/png', buffer: png });
  await page.fill(PALETTE_INPUT, 'FF0000\n0000FF');
  await page.click(APPLY_BUTTON);

  await startCheck(page, '0');
  await expect(page.locator(OVER_COUNT)).toHaveText('3');
  await expect(page.locator(MAX_DISTANCE)).toHaveText('65025');
  const positions = await page
    .locator('[data-testid^="quality-issue-"]')
    .evaluateAll((rows) =>
      rows.map((row) => Array.from(row.querySelectorAll('td')).slice(0, 2).map((td) => td.textContent)),
    );
  // 每行前两格为行、列，按顺序应为 (1,1) (1,2) (1,3)
  expect(positions).toEqual([
    ['1', '1'],
    ['1', '2'],
    ['1', '3'],
  ]);
  await expect(page.locator('[data-testid="quality-issue-3"] .distance')).toHaveText('65025');
});

test('重新应用色板与上传图片都会结束核查', async ({ page }) => {
  await setupMapped(page);
  await startCheck(page, '0');
  await expect(page.locator(OVER_COUNT)).toBeVisible();

  // 重新应用同一合法色板：核查结束，描边清除
  await page.click(APPLY_BUTTON);
  await expect(page.locator('[data-testid="quality-summary"]')).toHaveCount(0);
  await expect(page.locator(END_BUTTON)).toHaveCount(0);
  expect(await readCellPoint(page, 1, 2, 0.0625, 0.5)).toEqual([0, 0, 255, 255]);

  // 再次开启后上传新图片：核查同样结束
  await startCheck(page, '0');
  await expect(page.locator(OVER_COUNT)).toBeVisible();
  await page.setInputFiles(FILE_INPUT, {
    name: 'other.png',
    mimeType: 'image/png',
    buffer: makePng(1, 1, [px('00FF00')]),
  });
  await expect(page.locator('[data-testid="quality-summary"]')).toHaveCount(0);
  await expect(page.locator(END_BUTTON)).toHaveCount(0);
});
