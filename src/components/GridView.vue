<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import type { CellInfo, GridResult, PaletteColor, Rgb } from '../core/types';
import { effectiveIndex, isManual } from '../core/mapping';
import {
  BLANK_DARK,
  BLANK_LIGHT,
  DEFAULT_CELL_SIZE,
  GRID_LABEL_H,
  GRID_LABEL_W,
  MAX_CELL_SIZE,
  MIN_CELL_SIZE,
  QUALITY_STROKE,
} from '../core/layout';

const props = withDefaults(
  defineProps<{
    result: GridResult;
    palette: PaletteColor[];
    /** 质量核查开启时需要描边高亮的格下标集合（行优先）；未开启或为空时不描边 */
    highlighted?: ReadonlySet<number> | null;
  }>(),
  { highlighted: null },
);
const emit = defineEmits<{
  /** 校色操作：paletteIndex 为 null 表示恢复该格的自动计算结果 */
  (e: 'override', payload: { row: number; col: number; paletteIndex: number | null }): void;
}>();

const cellSize = ref(DEFAULT_CELL_SIZE);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const hover = ref<{ row: number; col: number } | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });
const tooltipRef = ref<HTMLElement | null>(null);
/** 悬停提示的实际尺寸，用于把提示钳制在视口内 */
const tooltipSize = ref({ w: 0, h: 0 });

/** 当前打开校色弹层的格子；点击透明格时也记录，用于给出拒绝提示 */
const selected = ref<{ row: number; col: number; x: number; y: number } | null>(null);

/** 编号间隔：格子太小时跳格标注，避免文字重叠 */
const labelStep = computed(() => Math.max(1, Math.ceil(16 / cellSize.value)));

function cellAt(row: number, col: number): CellInfo | null {
  return props.result.cells[(row - 1) * props.result.width + (col - 1)] ?? null;
}

const hoverCell = computed<CellInfo | null>(() =>
  hover.value ? cellAt(hover.value.row, hover.value.col) : null,
);

const selectedCell = computed<CellInfo | null>(() =>
  selected.value ? cellAt(selected.value.row, selected.value.col) : null,
);

const hoverSrcHex = computed(() => {
  const c = hoverCell.value;
  return c && c.src ? rgbToHex(c.src) : '';
});

function colorAt(i: number) {
  return props.palette[i];
}

const hoverTarget = computed(() => {
  const c = hoverCell.value;
  if (!c || c.blank) return null;
  const idx = effectiveIndex(c);
  return { hex: colorAt(idx).hex, index: idx + 1, manual: isManual(c) };
});

const hoverAuto = computed(() => {
  const c = hoverCell.value;
  if (!c || c.blank || !isManual(c)) return null;
  return { hex: colorAt(c.paletteIndex).hex, index: c.paletteIndex + 1 };
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

  // 单元格：不透明格填最终目标色，空格画棋盘格
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
      ctx.fillStyle = `#${colorAt(effectiveIndex(cell)).hex}`;
      ctx.fillRect(x, y, s, s);
    }
  }

  // 人工校色标记：格角小圆点；小格时收缩并钳位，确保整体落在本格内
  for (const cell of cells) {
    if (!isManual(cell)) continue;
    const x = GRID_LABEL_W + (cell.col - 1) * s;
    const y = GRID_LABEL_H + (cell.row - 1) * s;
    const want = Math.max(1.5, Math.min(3, s / 6)); // 常规半径，保持原有观感
    const r = Math.max(0.5, Math.min(want, (s - 2) / 2)); // 小格时收缩到格内容得下
    const stroked = r >= 1.5; // 太小的圆点省略白色描边，避免描边吞掉黑芯
    const outer = stroked ? r + 0.5 : r;
    const cx = Math.min(Math.max(x + s - r - 1.5, x + outer), x + s - outer);
    const cy = Math.min(Math.max(y + r + 1.5, y + outer), y + s - outer);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#000000';
    ctx.fill();
    if (stroked) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
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

  // 外框（先于超限描边绘制：边缘超限格的红框须完整压在外框之上）
  ctx.strokeStyle = '#555555';
  ctx.lineWidth = 1;
  ctx.strokeRect(GRID_LABEL_W + 0.5, GRID_LABEL_H + 0.5, width * s, height * s);

  // 质量核查超限格描边：在底色、网格线与外框之上醒目标记，小格时略收描边宽度
  if (props.highlighted && props.highlighted.size > 0) {
    ctx.strokeStyle = QUALITY_STROKE;
    ctx.lineWidth = s >= 8 ? 2 : 1;
    ctx.beginPath();
    for (const cell of cells) {
      if (cell.blank) continue;
      const idx = (cell.row - 1) * width + (cell.col - 1);
      if (!props.highlighted.has(idx)) continue;
      const x = GRID_LABEL_W + (cell.col - 1) * s;
      const y = GRID_LABEL_H + (cell.row - 1) * s;
      const inset = ctx.lineWidth / 2;
      ctx.rect(x + inset, y + inset, s - ctx.lineWidth, s - ctx.lineWidth);
    }
    ctx.stroke();
  }

  // 交互状态框（悬停黑框 / 选中蓝框）：该格同时为超限格时，状态框内收到红框
  // 内侧并与红框邻接，两条框各占独立像素带、互不覆盖，选中/悬停与超限状态同时可辨
  const isOverCell = (row: number, col: number) =>
    !!props.highlighted && props.highlighted.has((row - 1) * width + (col - 1));

  const drawStateFrame = (loc: { row: number; col: number }, color: string) => {
    const x = GRID_LABEL_W + (loc.col - 1) * s;
    const y = GRID_LABEL_H + (loc.row - 1) * s;
    if (!isOverCell(loc.row, loc.col)) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
      return;
    }
    const redW = s >= 8 ? 2 : 1; // 与超限描边宽度保持一致
    // 首选 2px 状态框，中线距红框内缘 1px（两框恰好邻接）
    let lineWidth = 2;
    let pad = redW + 1;
    if (s - 2 * pad < 1) {
      // 小格放不下 2px 内框：改用 1px 状态框，中线距红框内缘 0.5px
      lineWidth = 1;
      pad = redW + 0.5;
    }
    if (s - 2 * pad < 1) return; // 2–3px 极小格几何上无法并置双框：保留红框，状态由提示/弹层表达
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(x + pad, y + pad, s - pad * 2, s - pad * 2);
  };

  // 悬停高亮
  if (hover.value) {
    drawStateFrame(hover.value, '#000000');
  }

  // 校色弹层锚点格高亮
  if (selected.value) {
    drawStateFrame(selected.value, '#2f6feb');
  }
}

function locate(e: MouseEvent): { row: number; col: number } | null {
  const canvas = canvasRef.value;
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const s = cellSize.value;
  const col = Math.floor((e.clientX - rect.left - GRID_LABEL_W) / s) + 1;
  const row = Math.floor((e.clientY - rect.top - GRID_LABEL_H) / s) + 1;
  if (row >= 1 && row <= props.result.height && col >= 1 && col <= props.result.width) {
    return { row, col };
  }
  return null;
}

function onMouseMove(e: MouseEvent) {
  const loc = locate(e);
  if (loc) {
    if (!hover.value || hover.value.row !== loc.row || hover.value.col !== loc.col) {
      hover.value = loc;
    }
    tooltipPos.value = { x: e.clientX, y: e.clientY };
  } else {
    hover.value = null;
  }
}

function onMouseLeave() {
  hover.value = null;
}

function onClick(e: MouseEvent) {
  const loc = locate(e);
  if (loc) {
    // 点击任意格：非透明格打开选色弹层；透明格仅给出拒绝提示，均不改变结果
    selected.value = { row: loc.row, col: loc.col, x: e.clientX, y: e.clientY };
    return;
  }
  closePicker();
}

/** 点击弹层与画布之外的区域时关闭弹层 */
function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('.color-picker') || target?.closest('[data-testid="grid-canvas"]')) return;
  closePicker();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closePicker();
}

function closePicker() {
  selected.value = null;
}

/** 选择色板中的替代色（再次选择当前色等同于保持，但仍标记为人工指定） */
function chooseColor(paletteIndex: number) {
  if (!selected.value) return;
  emit('override', { row: selected.value.row, col: selected.value.col, paletteIndex });
  closePicker();
}

/** 恢复该格的自动计算结果 */
function restoreAuto() {
  if (!selected.value) return;
  emit('override', { row: selected.value.row, col: selected.value.col, paletteIndex: null });
  closePicker();
}

/** 悬停提示定位：跟随光标，但完整提示始终留在视口内 */
const tooltipStyle = computed(() => {
  const margin = 8;
  const { w, h } = tooltipSize.value;
  const x = Math.min(tooltipPos.value.x + 12, window.innerWidth - w - margin);
  const y = Math.min(tooltipPos.value.y + 12, window.innerHeight - h - margin);
  return { left: `${Math.max(margin, x)}px`, top: `${Math.max(margin, y)}px` };
});

/** 弹层定位：避免超出视口右边/下边 */
const pickerStyle = computed(() => {
  if (!selected.value) return {};
  const width = 216;
  const height = 120 + props.palette.length * 30;
  const x = Math.min(selected.value.x + 10, window.innerWidth - width - 8);
  const y = Math.min(selected.value.y + 10, window.innerHeight - height - 8);
  return { left: `${Math.max(8, x)}px`, top: `${Math.max(8, y)}px`, width: `${width}px` };
});

onMounted(() => {
  draw();
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onKeydown);
});

watch([() => props.result, () => props.palette, () => props.highlighted, cellSize, hover, selected], draw, {
  deep: true,
});

// 提示内容变化后重新测量尺寸，保证钳位用的大小是最新的
watch(
  hoverCell,
  () => {
    const el = tooltipRef.value;
    tooltipSize.value = el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 };
  },
  { flush: 'post' },
);
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
      <span class="manual-legend" data-testid="manual-legend">
        <span class="manual-dot"></span> 人工校色格
      </span>
    </div>
    <div class="canvas-wrap">
      <canvas
        ref="canvasRef"
        data-testid="grid-canvas"
        @mousemove="onMouseMove"
        @mouseleave="onMouseLeave"
        @click="onClick"
      ></canvas>
    </div>
    <!-- 校色弹层打开时隐藏悬停提示，避免盖住选色面板 -->
    <div
      v-if="hoverCell && !selected"
      ref="tooltipRef"
      class="cell-tooltip"
      data-testid="cell-tooltip"
      :style="tooltipStyle"
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
        <div v-if="hoverAuto">
          自动命中：#{{ hoverAuto.hex }}（色板 {{ hoverAuto.index }}）
          <span class="swatch" :style="{ background: `#${hoverAuto.hex}` }"></span>
        </div>
        <div v-if="hoverTarget">
          目标：#{{ hoverTarget.hex }}（色板 {{ hoverTarget.index }}<template v-if="hoverTarget.manual">，人工指定</template>）
          <span class="swatch" :style="{ background: `#${hoverTarget.hex}` }"></span>
        </div>
      </template>
    </div>

    <!-- 校色弹层：点击非透明格选择替代色；透明格仅给出拒绝提示 -->
    <div
      v-if="selected"
      class="color-picker"
      data-testid="color-picker"
      :style="pickerStyle"
      @click.stop
    >
        <template v-if="selectedCell && !selectedCell.blank">
          <div class="picker-title">
            第 {{ selected.row }} 行第 {{ selected.col }} 列 · 选择替代色
          </div>
          <button
            v-if="isManual(selectedCell)"
            type="button"
            class="restore-btn"
            data-testid="restore-auto"
            @click="restoreAuto"
          >
            恢复自动计算（#{{ palette[selectedCell.paletteIndex].hex }}，色板 {{ selectedCell.paletteIndex + 1 }}）
          </button>
          <ul class="color-options">
            <li v-for="(color, i) in palette" :key="color.hex">
              <button
                type="button"
                class="color-option"
                :data-testid="`color-option-${i + 1}`"
                :class="{ current: effectiveIndex(selectedCell) === i }"
                @click="chooseColor(i)"
              >
                <span class="picker-swatch" :style="{ background: `#${color.hex}` }"></span>
                <span class="picker-hex">#{{ color.hex }}</span>
                <span class="picker-index">色板 {{ i + 1 }}</span>
                <span v-if="effectiveIndex(selectedCell) === i" class="check">✓</span>
              </button>
            </li>
          </ul>
        </template>
        <template v-else>
          <div class="picker-title">第 {{ selected.row }} 行第 {{ selected.col }} 列</div>
          <p class="blank-reject" data-testid="blank-reject">
            该格为透明空格，不能进行人工校色。
          </p>
          <div class="picker-actions">
            <button type="button" data-testid="blank-reject-close" @click="closePicker">知道了</button>
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

.manual-legend {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  font-size: 12px;
  color: #555;
}

.manual-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #000;
  border: 1px solid #fff;
  outline: 1px solid #888;
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
  cursor: pointer;
}

.cell-tooltip {
  position: fixed;
  z-index: 30;
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

.color-picker {
  position: fixed;
  z-index: 40;
  background: #fff;
  border: 1px solid #c9ced6;
  border-radius: 8px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  padding: 12px;
}

.picker-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
}

.restore-btn {
  width: 100%;
  background: #fff;
  color: #2f6feb;
  border: 1px solid #2f6feb;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
  margin-bottom: 8px;
  cursor: pointer;
}

.restore-btn:hover {
  background: #eef3fe;
}

.color-options {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}

.color-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  background: #fff;
  color: #222;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.color-option:hover {
  background: #f2f5fb;
}

.color-option.current {
  border-color: #2f6feb;
  background: #eef3fe;
}

.picker-swatch {
  display: inline-block;
  width: 16px;
  height: 16px;
  border: 1px solid #999;
  flex: none;
}

.picker-hex {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.picker-index {
  color: #777;
  font-size: 12px;
  margin-left: auto;
}

.check {
  color: #2f6feb;
  font-weight: 700;
}

.blank-reject {
  margin: 0 0 10px;
  color: #b3261e;
  font-size: 13px;
}

.picker-actions {
  text-align: right;
}
</style>
