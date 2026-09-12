<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { CellInfo, GridResult, PaletteColor, Rgb } from '../core/types';
import {
  BLANK_DARK,
  BLANK_LIGHT,
  DEFAULT_CELL_SIZE,
  GRID_LABEL_H,
  GRID_LABEL_W,
  MAX_CELL_SIZE,
  MIN_CELL_SIZE,
} from '../core/layout';

const props = defineProps<{ result: GridResult; palette: PaletteColor[] }>();

const cellSize = ref(DEFAULT_CELL_SIZE);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const hover = ref<{ row: number; col: number } | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });

/** 编号间隔：格子太小时跳格标注，避免文字重叠 */
const labelStep = computed(() => Math.max(1, Math.ceil(16 / cellSize.value)));

const hoverCell = computed<CellInfo | null>(() => {
  if (!hover.value) return null;
  const { row, col } = hover.value;
  return props.result.cells[(row - 1) * props.result.width + (col - 1)] ?? null;
});

const hoverSrcHex = computed(() => {
  const c = hoverCell.value;
  return c && c.src ? rgbToHex(c.src) : '';
});

const hoverTarget = computed(() => {
  const c = hoverCell.value;
  if (!c || c.blank) return null;
  return { hex: props.palette[c.paletteIndex].hex, index: c.paletteIndex + 1 };
});

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`;
}

function zoomIn() {
  cellSize.value = Math.min(MAX_CELL_SIZE, cellSize.value + 2);
}

function zoomOut() {
  cellSize.value = Math.max(MIN_CELL_SIZE, cellSize.value - 2);
}

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const { width, height, cells } = props.result;
  const s = cellSize.value;
  const cssW = GRID_LABEL_W + width * s + 1;
  const cssH = GRID_LABEL_H + height * s + 1;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  // 单元格：不透明格填目标色，空格画棋盘格
  for (const cell of cells) {
    const x = GRID_LABEL_W + (cell.col - 1) * s;
    const y = GRID_LABEL_H + (cell.row - 1) * s;
    if (cell.blank) {
      ctx.fillStyle = BLANK_LIGHT;
      ctx.fillRect(x, y, s, s);
      ctx.fillStyle = BLANK_DARK;
      const half = s / 2;
      ctx.fillRect(x, y, half, half);
      ctx.fillRect(x + half, y + half, s - half, s - half);
    } else {
      ctx.fillStyle = `#${props.palette[cell.paletteIndex].hex}`;
      ctx.fillRect(x, y, s, s);
    }
  }

  // 网格线（格子过小时省略，保持画面干净）
  if (s >= 6) {
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= width; c++) {
      const x = GRID_LABEL_W + c * s + 0.5;
      ctx.moveTo(x, GRID_LABEL_H + 0.5);
      ctx.lineTo(x, GRID_LABEL_H + height * s + 0.5);
    }
    for (let r = 0; r <= height; r++) {
      const y = GRID_LABEL_H + r * s + 0.5;
      ctx.moveTo(GRID_LABEL_W + 0.5, y);
      ctx.lineTo(GRID_LABEL_W + width * s + 0.5, y);
    }
    ctx.stroke();
  }

  // 行列编号（从 1 开始）
  ctx.fillStyle = '#333333';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = labelStep.value;
  for (let c = 1; c <= width; c++) {
    if ((c - 1) % step !== 0 && c !== width) continue;
    ctx.fillText(String(c), GRID_LABEL_W + (c - 0.5) * s, GRID_LABEL_H / 2);
  }
  for (let r = 1; r <= height; r++) {
    if ((r - 1) % step !== 0 && r !== height) continue;
    ctx.fillText(String(r), GRID_LABEL_W / 2, GRID_LABEL_H + (r - 0.5) * s);
  }

  // 外框
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 1;
  ctx.strokeRect(GRID_LABEL_W + 0.5, GRID_LABEL_H + 0.5, width * s, height * s);

  // 悬停高亮
  if (hover.value) {
    const x = GRID_LABEL_W + (hover.value.col - 1) * s;
    const y = GRID_LABEL_H + (hover.value.row - 1) * s;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
  }
}

function onMouseMove(e: MouseEvent) {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const s = cellSize.value;
  const col = Math.floor((e.clientX - rect.left - GRID_LABEL_W) / s) + 1;
  const row = Math.floor((e.clientY - rect.top - GRID_LABEL_H) / s) + 1;
  if (row >= 1 && row <= props.result.height && col >= 1 && col <= props.result.width) {
    if (!hover.value || hover.value.row !== row || hover.value.col !== col) {
      hover.value = { row, col };
    }
    tooltipPos.value = { x: e.clientX, y: e.clientY };
  } else {
    hover.value = null;
  }
}

function onMouseLeave() {
  hover.value = null;
}

onMounted(draw);
watch([() => props.result, () => props.palette, cellSize, hover], draw, { deep: true });
</script>

<template>
  <div class="grid-view">
    <div class="zoom-controls">
      <button type="button" data-testid="zoom-out" :disabled="cellSize <= MIN_CELL_SIZE" @click="zoomOut">−</button>
      <input
        type="range"
        data-testid="zoom-slider"
        :min="MIN_CELL_SIZE"
        :max="MAX_CELL_SIZE"
        step="1"
        v-model.number="cellSize"
      />
      <button type="button" data-testid="zoom-in" :disabled="cellSize >= MAX_CELL_SIZE" @click="zoomIn">＋</button>
      <span class="zoom-label">{{ cellSize }} px/格</span>
    </div>
    <div class="canvas-wrap">
      <canvas
        ref="canvasRef"
        data-testid="grid-canvas"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
      ></canvas>
    </div>
    <div
      v-if="hoverCell"
      class="cell-tooltip"
      data-testid="cell-tooltip"
      :style="{ left: `${tooltipPos.x + 12}px`, top: `${tooltipPos.y + 12}px` }"
    >
      <div>行 {{ hoverCell.row }}，列 {{ hoverCell.col }}</div>
      <template v-if="hoverCell.blank">
        <div>原色：透明（空格）</div>
        <div>目标：—</div>
      </template>
      <template v-else>
        <div>
          原色：#{{ hoverSrcHex }}
          <span class="swatch" :style="{ background: `#${hoverSrcHex}` }"></span>
        </div>
        <div v-if="hoverTarget">
          目标：#{{ hoverTarget.hex }}（色板 {{ hoverTarget.index }}）
          <span class="swatch" :style="{ background: `#${hoverTarget.hex}` }"></span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.grid-view {
  position: relative;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.zoom-controls button {
  width: 28px;
  height: 28px;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.zoom-label {
  font-size: 13px;
  color: #555;
}

.canvas-wrap {
  overflow: auto;
  max-width: 100%;
  max-height: 70vh;
  border: 1px solid #ddd;
  background: #fafafa;
}

canvas {
  display: block;
}

.cell-tooltip {
  position: fixed;
  z-index: 10;
  pointer-events: none;
  background: rgba(20, 20, 20, 0.92);
  color: #fff;
  font-size: 12px;
  line-height: 1.7;
  padding: 6px 10px;
  border-radius: 4px;
  white-space: nowrap;
}

.swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  vertical-align: -2px;
  margin-left: 4px;
}
</style>
