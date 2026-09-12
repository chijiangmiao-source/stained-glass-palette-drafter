import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { makePng, px, TRANSPARENT } from './helpers';
import {
  BLANK_DARK,
  DEFAULT_CELL_SIZE,
  GRID_LABEL_H,
  GRID_LABEL_W,
} from '../../src/core/layout';

const FILE_INPUT = '[data-testid="file-input"]';
const PALETTE_INPUT = '[data-testid="palette-input"]';
const APPLY_BUTTON = '[data-testid="apply-palette"]';
const GRID_CANVAS = '[data-testid="grid-canvas"]';
const STATS_TABLE = '[data-testid="stats-table"]';
const EXPORT_PREVIEW = '[data-testid="export-preview"]';
const ERROR_MESSAGE = '[data-testid="error-message"]';
const TOOLTIP = '[data-testid="cell-tooltip"]';
const DOWNLOAD_BUTTON = '[data-testid="download-button"]';

const PALETTE_RGB = ['FF0000', '00FF00', '0000FF'].join('\n');

async function upload(page: Page, buffer: Buffer, name = 'case.png') {
  await page.setInputFiles(FILE_INPUT, { name, mimeType: 'image/png', buffer });
}

async function applyPalette(page: Page, text: string) {
  await page.fill(PALETTE_INPUT, text);
  await page.click(APPLY_BUTTON);
}

/** 网格中某格中心在页面中的坐标 */
async function cellCenter(page: Page, row: number, col: number) {
  const box = await page.locator(GRID_CANVAS).boundingBox();
  if (!box) throw new Error('网格画布不存在');
  const s = DEFAULT_CELL_SIZE;
  return {
    x: box.x + GRID_LABEL_W + (col - 0.5) * s,
    y: box.y + GRID_LABEL_H + (row - 0.5) * s,
  };
}

/** 读取画布上某格内部 (fx, fy) 比例处的实际像素颜色 */
async function readCellPoint(
  page: Page,
  row: number,
  col: number,
  fx = 0.5,
  fy = 0.5,
): Promise<number[]> {
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

function statsCount(page: Page, index: number) {
  return page.locator(`[data-testid="stats-row-${index}"] .count`);
}

test.describe('彩窗色号映射工具', () => {
  test('映射、网格、统计、悬停与导出逐格一致', async ({ page }) => {
    // 3×2：精确红、近红、透明 / 精确绿、近蓝、三通道等距白（并列取最前）
    const png = makePng(3, 2, [
      px('FF0000'), px('7F0000'), TRANSPARENT,
      px('00FF00'), px('0000FE'), px('FFFFFF'),
    ]);
    await page.goto('/');
    await upload(page, png);
    await applyPalette(page, PALETTE_RGB);

    // 统计：红 3 片（含并列白）、绿 1 片、蓝 1 片
    await expect(statsCount(page, 1)).toHaveText('3');
    await expect(statsCount(page, 2)).toHaveText('1');
    await expect(statsCount(page, 3)).toHaveText('1');

    // 导出预览：行优先、制表符分隔、无末尾换行
    const expected = ['1\t1\t1', '1\t2\t1', '2\t1\t2', '2\t2\t3', '2\t3\t1'].join('\n');
    await expect(page.locator(EXPORT_PREVIEW)).toHaveValue(expected);

    // 画布实际渲染颜色 = 目标色
    expect(await readCellPoint(page, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(await readCellPoint(page, 1, 2)).toEqual([255, 0, 0, 255]);
    expect(await readCellPoint(page, 2, 2)).toEqual([0, 0, 255, 255]);
    expect(await readCellPoint(page, 2, 3)).toEqual([255, 0, 0, 255]);
    // 空格画成棋盘格：左上角块为 BLANK_DARK
    const blank = await readCellPoint(page, 1, 3, 0.25, 0.25);
    expect(blank).toEqual([...Buffer.from(BLANK_DARK.slice(1), 'hex').values(), 255].map(Number));

    // 悬停展示行列、原色与目标色
    const p1 = await cellCenter(page, 2, 3);
    await page.mouse.move(p1.x, p1.y);
    const tip = page.locator(TOOLTIP);
    await expect(tip).toContainText('行 2，列 3');
    await expect(tip).toContainText('原色：#FFFFFF');
    await expect(tip).toContainText('目标：#FF0000（色板 1）');

    // 悬停空格
    const p2 = await cellCenter(page, 1, 3);
    await page.mouse.move(p2.x, p2.y);
    await expect(tip).toContainText('行 1，列 3');
    await expect(tip).toContainText('空格');

    // 缩放：默认 16px/格，放大一档为 18px/格
    const canvas = page.locator(GRID_CANVAS);
    await expect(canvas).toHaveJSProperty('width', GRID_LABEL_W + 3 * 16 + 1);
    await page.click('[data-testid="zoom-in"]');
    await expect(canvas).toHaveJSProperty('width', GRID_LABEL_W + 3 * 18 + 1);
    await page.click('[data-testid="zoom-out"]');
    await expect(canvas).toHaveJSProperty('width', GRID_LABEL_W + 3 * 16 + 1);

    // 下载文件内容与预览逐字节一致
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click(DOWNLOAD_BUTTON),
    ]);
    expect(download.suggestedFilename()).toBe('pixel-mapping.txt');
    const content = await readFile(await download.path(), 'utf-8');
    expect(content).toBe(expected);
    expect(content.endsWith('\n')).toBe(false);
  });

  test('非 PNG 文件被拒绝并清除旧版图', async ({ page }) => {
    await page.goto('/');
    await upload(page, makePng(1, 1, [px('FF0000')]));
    await applyPalette(page, 'FF0000\n00FF00');
    await expect(page.locator(GRID_CANVAS)).toBeVisible();

    await upload(page, Buffer.from('this is not a png file'), 'fake.png');
    await expect(page.locator(ERROR_MESSAGE)).toContainText('PNG');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);
    await expect(page.locator(STATS_TABLE)).toHaveCount(0);
    await expect(page.locator(EXPORT_PREVIEW)).toHaveCount(0);
  });

  test('PNG 解码失败被拒绝并清除旧版图', async ({ page }) => {
    await page.goto('/');
    await upload(page, makePng(1, 1, [px('FF0000')]));
    await applyPalette(page, 'FF0000\n00FF00');
    await expect(page.locator(GRID_CANVAS)).toBeVisible();

    // 魔数正确但内容损坏
    const corrupt = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('broken-png-content'),
    ]);
    await upload(page, corrupt);
    await expect(page.locator(ERROR_MESSAGE)).toContainText('解码失败');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);
  });

  test('尺寸越界被拒绝并清除旧版图', async ({ page }) => {
    await page.goto('/');
    await upload(page, makePng(2, 2, [px('FF0000'), px('00FF00'), px('0000FF'), px('FF0000')]));
    await applyPalette(page, PALETTE_RGB);
    await expect(page.locator(GRID_CANVAS)).toBeVisible();

    const wide = makePng(129, 1, Array.from({ length: 129 }, () => px('FF0000')));
    await upload(page, wide);
    await expect(page.locator(ERROR_MESSAGE)).toContainText('129×1');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);

    const tall = makePng(1, 129, Array.from({ length: 129 }, () => px('00FF00')));
    await upload(page, tall);
    await expect(page.locator(ERROR_MESSAGE)).toContainText('1×129');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);
  });

  test('透明度不是 0 或 255 时拒绝整图并清除旧版图', async ({ page }) => {
    await page.goto('/');
    await upload(page, makePng(1, 1, [px('FF0000')]));
    await applyPalette(page, 'FF0000\n00FF00');
    await expect(page.locator(GRID_CANVAS)).toBeVisible();

    await upload(page, makePng(2, 1, [px('FF0000'), px('00FF00', 128)]));
    await expect(page.locator(ERROR_MESSAGE)).toContainText('透明度为 128');
    await expect(page.locator(ERROR_MESSAGE)).toContainText('第 1 行第 2 列');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);
    await expect(page.locator(EXPORT_PREVIEW)).toHaveCount(0);
  });

  test('非法色板报错并清除旧版图，改正后恢复', async ({ page }) => {
    await page.goto('/');
    await upload(page, makePng(2, 1, [px('FF0000'), px('00FF00')]));
    await applyPalette(page, 'FF0000\n00FF00');
    await expect(page.locator(GRID_CANVAS)).toBeVisible();

    // 重复色值
    await applyPalette(page, 'FF0000\nFF0000');
    await expect(page.locator(ERROR_MESSAGE)).toContainText('重复');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);

    // 小写色值
    await applyPalette(page, 'ff0000\n00FF00');
    await expect(page.locator(ERROR_MESSAGE)).toContainText('六位大写十六进制');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);

    // 数量不足
    await applyPalette(page, 'FF0000');
    await expect(page.locator(ERROR_MESSAGE)).toContainText('2 至 16');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);

    // 数量超出（17 个）
    const seventeen = Array.from(
      { length: 17 },
      (_, i) => `${i.toString(16).toUpperCase().padStart(2, '0')}0000`,
    ).join('\n');
    await applyPalette(page, seventeen);
    await expect(page.locator(ERROR_MESSAGE)).toContainText('2 至 16');
    await expect(page.locator(GRID_CANVAS)).toHaveCount(0);

    // 改正后恢复，且图片无需重新上传
    await applyPalette(page, 'FF0000\n00FF00');
    await expect(page.locator(GRID_CANVAS)).toBeVisible();
    await expect(page.locator(ERROR_MESSAGE)).toHaveCount(0);
    await expect(page.locator(EXPORT_PREVIEW)).toHaveValue('1\t1\t1\n1\t2\t2');
  });

  test('全部透明像素导出空文件', async ({ page }) => {
    await page.goto('/');
    await upload(page, makePng(2, 2, [TRANSPARENT, TRANSPARENT, TRANSPARENT, TRANSPARENT]));
    await applyPalette(page, 'FF0000\n00FF00');

    await expect(page.locator(GRID_CANVAS)).toBeVisible();
    await expect(statsCount(page, 1)).toHaveText('0');
    await expect(statsCount(page, 2)).toHaveText('0');
    await expect(page.locator(EXPORT_PREVIEW)).toHaveValue('');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click(DOWNLOAD_BUTTON),
    ]);
    const content = await readFile(await download.path(), 'utf-8');
    expect(content).toBe('');
  });

  test('128×128 上限尺寸：统计与导出完整一致', async ({ page }) => {
    // 棋盘图案：(x+y) 偶数为红、奇数为绿，各 8192 片
    const pixels = [];
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        pixels.push((x + y) % 2 === 0 ? px('FF0000') : px('00FF00'));
      }
    }
    await page.goto('/');
    await upload(page, makePng(128, 128, pixels));
    await applyPalette(page, 'FF0000\n00FF00');

    await expect(statsCount(page, 1)).toHaveText('8192');
    await expect(statsCount(page, 2)).toHaveText('8192');

    const lines: string[] = [];
    for (let y = 1; y <= 128; y++) {
      for (let x = 1; x <= 128; x++) {
        lines.push(`${y}\t${x}\t${(x + y) % 2 === 0 ? 1 : 2}`);
      }
    }
    await expect(page.locator(EXPORT_PREVIEW)).toHaveValue(lines.join('\n'));
  });
});
