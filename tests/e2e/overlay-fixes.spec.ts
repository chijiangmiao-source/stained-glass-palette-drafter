import { expect, test, type Page } from '@playwright/test';
import { makePng, px } from './helpers';
import { GRID_LABEL_H, GRID_LABEL_W, QUALITY_STROKE } from '../../src/core/layout';

const FILE_INPUT = '[data-testid="file-input"]';
const PALETTE_INPUT = '[data-testid="palette-input"]';
const APPLY_BUTTON = '[data-testid="apply-palette"]';
const GRID_CANVAS = '[data-testid="grid-canvas"]';
const TOOLTIP = '[data-testid="cell-tooltip"]';
const PICKER = '[data-testid="color-picker"]';
const THRESHOLD_INPUT = '[data-testid="quality-threshold-input"]';
const START_BUTTON = '[data-testid="quality-start"]';

const RED_RGB = [...Buffer.from(QUALITY_STROKE.slice(1), 'hex').values(), 255].map(Number);
const BLACK_RGB = [0, 0, 0, 255];
const BLUE_RGB = [47, 111, 235, 255]; // 选中框 #2f6feb
const FRAME_GRAY_RGB = [85, 85, 85, 255]; // 版图外框 #555555

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

/** 读取画布 CSS 坐标（相对画布左上角的小数像素）处的实际 RGBA；
 * 设备像素取 floor，采样点落在该设备像素中心，避免四舍五入跨描边线 */
async function readAt(page: Page, cssX: number, cssY: number): Promise<number[]> {
  return page.evaluate(([x, y]) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="grid-canvas"]')!;
    const dpr = canvas.width / canvas.getBoundingClientRect().width;
    const ctx = canvas.getContext('2d')!;
    return Array.from(ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data);
  }, [cssX, cssY]);
}

/** 某格内偏移 (dx, dy) CSS 像素处的颜色 */
function cellOffset(row: number, col: number, s: number, dx: number, dy: number) {
  return { x: GRID_LABEL_W + (col - 1) * s + dx, y: GRID_LABEL_H + (row - 1) * s + dy };
}

/** 红色风险描边判定：含纯红，也含 1px 线角点处与底色抗锯齿后的红主导色 */
function isReddish(rgba: number[]) {
  return rgba[0] >= 150 && rgba[1] <= 100 && rgba[2] <= 100;
}

test.describe('核查标记与交互框并存', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  // 2×2：近蓝 0000FE（自动命中蓝，dist 1，阈值 0 时超限）在 (1,1)；精确红在其余不透明格
  const PNG = makePng(2, 2, [px('0000FE'), px('FF0000'), px('FF0000'), px('0000FE')]);

  async function setupOverLimit(page: Page) {
    await page.goto('/');
    await page.setInputFiles(FILE_INPUT, { name: 'case.png', mimeType: 'image/png', buffer: PNG });
    await page.fill(PALETTE_INPUT, 'FF0000\n00FF00\n0000FF');
    await page.click(APPLY_BUTTON);
    await page.fill(THRESHOLD_INPUT, '0');
    await page.click(START_BUTTON);
  }

  test('核查中悬停超限格：黑框与红框各占独立像素带，提示可见时红框完整保留', async ({ page }) => {
    await setupOverLimit(page);
    const s = 16;
    const p = await cellCenter(page, 1, 1, s);
    await page.mouse.move(p.x, p.y);
    await expect(page.locator(TOOLTIP)).toBeVisible();

    // 16px 格：红框 2px 占格内 [0,2) 带；黑框内移，2px 占 [2,4) 带，两带邻接不重叠
    expect(await readAt(page, cellOffset(1, 1, s, 1, 8).x, cellOffset(1, 1, s, 1, 8).y)).toEqual(RED_RGB);
    expect(await readAt(page, cellOffset(1, 1, s, 2, 8).x, cellOffset(1, 1, s, 2, 8).y)).toEqual(BLACK_RGB);
    // 另一侧同样两框并存
    expect(await readAt(page, cellOffset(1, 1, s, 14, 8).x, cellOffset(1, 1, s, 14, 8).y)).toEqual(RED_RGB);
    expect(await readAt(page, cellOffset(1, 1, s, 12, 8).x, cellOffset(1, 1, s, 12, 8).y)).toEqual(BLACK_RGB);
    // 上边框：红、黑上下相邻
    const topRed = cellOffset(1, 1, s, 8, 1);
    const topBlack = cellOffset(1, 1, s, 8, 2);
    expect(await readAt(page, topRed.x, topRed.y)).toEqual(RED_RGB);
    expect(await readAt(page, topBlack.x, topBlack.y)).toEqual(BLACK_RGB);
    // 格心仍是目标色（蓝 #0000FF），未被任何框覆盖
    const center = cellOffset(1, 1, s, 8, 8);
    expect(await readAt(page, center.x, center.y)).toEqual([0, 0, 255, 255]);
  });

  test('核查中点击超限格打开选色：蓝框与红框同时可辨', async ({ page }) => {
    await setupOverLimit(page);
    const s = 16;
    const p = await cellCenter(page, 1, 1, s);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator(PICKER)).toBeVisible();

    // 红框在外 [0,2) 带，蓝色选中框内移占 [2,4) 带
    expect(await readAt(page, cellOffset(1, 1, s, 1, 8).x, cellOffset(1, 1, s, 1, 8).y)).toEqual(RED_RGB);
    expect(await readAt(page, cellOffset(1, 1, s, 2, 8).x, cellOffset(1, 1, s, 2, 8).y)).toEqual(BLUE_RGB);
    expect(await readAt(page, cellOffset(1, 1, s, 14, 8).x, cellOffset(1, 1, s, 14, 8).y)).toEqual(RED_RGB);
    expect(await readAt(page, cellOffset(1, 1, s, 12, 8).x, cellOffset(1, 1, s, 12, 8).y)).toEqual(BLUE_RGB);
    const topRed = cellOffset(1, 1, s, 8, 1);
    const topBlue = cellOffset(1, 1, s, 8, 2);
    expect(await readAt(page, topRed.x, topRed.y)).toEqual(RED_RGB);
    expect(await readAt(page, topBlue.x, topBlue.y)).toEqual(BLUE_RGB);
    // 格心目标色不变
    const center = cellOffset(1, 1, s, 8, 8);
    expect(await readAt(page, center.x, center.y)).toEqual([0, 0, 255, 255]);
  });

  test('4px/格时版图边缘的超限格：红框压过灰色外框，四边与角点完整', async ({ page }) => {
    await setupOverLimit(page);
    for (let i = 0; i < 6; i++) await page.click('[data-testid="zoom-out"]');
    await expect(page.locator('.zoom-label')).toHaveText('4 px/格');

    const s = 4;
    // (1,1) 为左上角边缘超限格：红框 1px 中线贴格边（36.5），须完整盖住灰外框
    expect(await readAt(page, GRID_LABEL_W, GRID_LABEL_H + 1.5)).toEqual(RED_RGB); // 左边
    expect(await readAt(page, GRID_LABEL_W + 1.5, GRID_LABEL_H)).toEqual(RED_RGB); // 上边
    expect(isReddish(await readAt(page, GRID_LABEL_W, GRID_LABEL_H))).toBeTruthy(); // 左上角点
    // (2,2) 为右下角边缘超限格
    expect(await readAt(page, GRID_LABEL_W + s * 2 - 1, GRID_LABEL_H + s + 1.5)).toEqual(RED_RGB); // 右边
    expect(await readAt(page, GRID_LABEL_W + s + 1.5, GRID_LABEL_H + s * 2 - 1)).toEqual(RED_RGB); // 下边
    expect(isReddish(await readAt(page, GRID_LABEL_W + s * 2 - 1, GRID_LABEL_H + s * 2 - 1))).toBeTruthy(); // 右下角点

    // 非超限格所在的外框段仍是灰色：外框未被整体替换
    expect(await readAt(page, GRID_LABEL_W + s + 2, GRID_LABEL_H)).toEqual(FRAME_GRAY_RGB); // 顶边 (1,2)
    expect(await readAt(page, GRID_LABEL_W, GRID_LABEL_H + s + 2)).toEqual(FRAME_GRAY_RGB); // 左边 (2,1)
  });
});

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
