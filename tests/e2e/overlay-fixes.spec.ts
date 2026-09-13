import { expect, test, type Page } from '@playwright/test';
import { makePng, px } from './helpers';
import { GRID_LABEL_H, GRID_LABEL_W } from '../../src/core/layout';

const FILE_INPUT = '[data-testid="file-input"]';
const PALETTE_INPUT = '[data-testid="palette-input"]';
const APPLY_BUTTON = '[data-testid="apply-palette"]';
const GRID_CANVAS = '[data-testid="grid-canvas"]';
const TOOLTIP = '[data-testid="cell-tooltip"]';
const PICKER = '[data-testid="color-picker"]';

async function setup(page: Page) {
  const png = makePng(4, 4, Array.from({ length: 16 }, () => px('FF0000')));
  await page.goto('/');
  await page.setInputFiles(FILE_INPUT, { name: 'case.png', mimeType: 'image/png', buffer: png });
  await page.fill(PALETTE_INPUT, 'FF0000\n00FF00\n0000FF');
  await page.click(APPLY_BUTTON);
}

async function cellCenter(page: Page, row: number, col: number, s: number) {
  const box = await page.locator(GRID_CANVAS).boundingBox();
  if (!box) throw new Error('网格画布不存在');
  return { x: box.x + GRID_LABEL_W + (col - 0.5) * s, y: box.y + GRID_LABEL_H + (row - 0.5) * s };
}

test('校色弹层打开时悬停提示不再叠放', async ({ page }) => {
  await setup(page);
  const p = await cellCenter(page, 2, 2, 16);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator(TOOLTIP)).toBeVisible();
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(PICKER)).toBeVisible();
  await expect(page.locator(TOOLTIP)).toHaveCount(0);
});

test('靠近视口右下角的格子：提示完整留在窗口内', async ({ page }) => {
  // 128×128 大图让画布超出视口，滚动到右下角后悬停最右下的格子
  const png = makePng(128, 128, Array.from({ length: 128 * 128 }, () => px('FF0000')));
  await page.goto('/');
  await page.setInputFiles(FILE_INPUT, { name: 'big.png', mimeType: 'image/png', buffer: png });
  await page.fill(PALETTE_INPUT, 'FF0000\n00FF00\n0000FF');
  await page.click(APPLY_BUTTON);

  const wrap = page.locator('.canvas-wrap');
  await wrap.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });
  const wrapBox = (await wrap.boundingBox())!;
  const viewport = page.viewportSize()!;
  const x = Math.min(wrapBox.x + wrapBox.width - 4, viewport.width - 4);
  const y = Math.min(wrapBox.y + wrapBox.height - 4, viewport.height - 4);
  await page.mouse.move(x, y);

  const tip = page.locator(TOOLTIP);
  await expect(tip).toBeVisible();
  const tipBox = (await tip.boundingBox())!;
  expect(tipBox.x).toBeGreaterThanOrEqual(0);
  expect(tipBox.y).toBeGreaterThanOrEqual(0);
  expect(tipBox.x + tipBox.width).toBeLessThanOrEqual(viewport.width);
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(viewport.height);
});

test('4px/格时人工标记不跨越格线', async ({ page }) => {
  await setup(page);
  // 缩到 4px/格
  for (let i = 0; i < 6; i++) await page.click('[data-testid="zoom-out"]');
  await expect(page.locator('.zoom-label')).toHaveText('4 px/格');
  // 把 (2,2) 人工改为色板 2
  const p = await cellCenter(page, 2, 2, 4);
  await page.mouse.click(p.x, p.y);
  await page.click('[data-testid="color-option-2"]');
  // 读取 (2,2) 及相邻四格的全部像素：黑色只能出现在 (2,2) 内
  const blacks = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="grid-canvas"]')!;
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const ctx = canvas.getContext('2d')!;
    const lw = 36, lh = 36, s = 4;
    const hits: string[] = [];
    for (let row = 1; row <= 3; row++) {
      for (let col = 1; col <= 3; col++) {
        for (let py = 0; py < s; py++) {
          for (let pxx = 0; pxx < s; pxx++) {
            const x = Math.round((lw + (col - 1) * s + pxx) * dpr);
            const y = Math.round((lh + (row - 1) * s + py) * dpr);
            const d = ctx.getImageData(x, y, 1, 1).data;
            // 近黑（排除 #555 外框等深色非黑元素）
            if (Math.max(d[0], d[1], d[2]) < 60) hits.push(`${row},${col}`);
          }
        }
      }
    }
    return [...new Set(hits)];
  });
  expect(blacks).toEqual(['2,2']);
});
