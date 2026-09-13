<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { GridResult, PaletteColor, Rgb } from '../core/types';
import {
  buildQualityReport,
  parseThreshold,
  QUALITY_THRESHOLD_MAX,
  thresholdErrorText,
  type QualityReport,
} from '../core/quality';

const props = defineProps<{
  /** 当前最终映射结果（含人工校色）；无结果时面板不挂载 */
  result: GridResult;
  palette: PaletteColor[];
  /** 是否正在核查：由 App 控制，上传图片或重应用色板时会被结束 */
  active: boolean;
}>();

const emit = defineEmits<{
  /** v-model:active：开始/结束核查 */
  (e: 'update:active', value: boolean): void;
  /** 超限格描边集合（行优先下标）；结束或无超限时为 null */
  (e: 'highlight', indices: ReadonlySet<number> | null): void;
}>();

/** 色差上限录入草稿（字符串，便于原样保留并定位错误） */
const thresholdInput = ref('');
/** 阈值录入错误信息；空串表示无错误 */
const thresholdError = ref('');
/** 最近一次生效的阈值；未开始核查时为 null */
const activeThreshold = ref<number | null>(null);

/** 核查报告：开启时直接读取当前最终映射结果，人工改色后随 result 自动重算 */
const report = computed<QualityReport | null>(() => {
  if (!props.active || activeThreshold.value === null) return null;
  return buildQualityReport(props.result, props.palette, activeThreshold.value);
});

/** 描边集合与报告同源：明细、网格标记始终对应同一批格子 */
const highlighted = computed<ReadonlySet<number> | null>(() => {
  const r = report.value;
  if (!r) return null;
  return new Set(r.issues.map((issue) => issue.index));
});

watch(highlighted, (set) => emit('highlight', set), { immediate: true });

// 外部结束核查（上传图片、重应用色板或其报错）与点击「结束核查」等效：清空录入与报告
watch(
  () => props.active,
  (active) => {
    if (!active) {
      thresholdError.value = '';
      thresholdInput.value = '';
      activeThreshold.value = null;
    }
  },
);

/** 开始/重新核查：校验阈值，非法时明确报错并保留上一次有效结果 */
function start() {
  const parsed = parseThreshold(thresholdInput.value);
  if (!parsed.ok) {
    // 不改变 active 与 activeThreshold：未开启则不开启，已开启则保留旧结果
    thresholdError.value = thresholdErrorText(parsed.reason);
    return;
  }
  thresholdError.value = '';
  activeThreshold.value = parsed.value;
  if (!props.active) emit('update:active', true);
}

/** 结束核查：清除报告与描边，网格恢复原显示（录入草稿一并清空） */
function end() {
  thresholdError.value = '';
  thresholdInput.value = '';
  activeThreshold.value = null;
  if (props.active) emit('update:active', false);
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`;
}
</script>

<template>
  <section class="panel quality-check" data-testid="quality-panel">
    <h2>5. 映射质量核查</h2>
    <p class="hint">
      以原像素与最终选色（含人工校色）的三通道差值平方和作为色差，逐格与上限比较：严格大于上限的格子计入超限明细并在网格中描边；距离等于上限不算超限，全透明空格不参与核查。人工改色后结果即时重算。
    </p>
    <div class="threshold-row">
      <label for="quality-threshold">色差上限（0–{{ QUALITY_THRESHOLD_MAX }} 的整数）</label>
      <input
        id="quality-threshold"
        v-model="thresholdInput"
        type="text"
        inputmode="numeric"
        class="threshold-input"
        :class="{ invalid: thresholdError !== '' }"
        data-testid="quality-threshold-input"
        placeholder="如 5000"
        @keyup.enter="start"
      />
      <button type="button" data-testid="quality-start" @click="start">开始核查</button>
      <button
        v-if="active"
        type="button"
        class="secondary"
        data-testid="quality-end"
        @click="end"
      >
        结束核查
      </button>
    </div>
    <p v-if="thresholdError" class="error-inline" data-testid="quality-error" role="alert">
      {{ thresholdError }}
    </p>

    <template v-if="active && report">
      <p class="quality-summary" data-testid="quality-summary">
        阈值 {{ report.threshold }}：超限格
        <strong data-testid="quality-over-count">{{ report.overCount }}</strong>
        个；最大偏差
        <strong data-testid="quality-max-distance">{{ report.maxDistance }}</strong>
        <span v-if="report.overCount === 0" class="zero-note">（无超限格）</span>
      </p>

      <div v-if="report.issues.length" class="issues-wrap">
        <table class="issues-table" data-testid="quality-issues">
          <thead>
            <tr>
              <th>行</th>
              <th>列</th>
              <th>原色</th>
              <th>最终选色</th>
              <th>色差（平方和）</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(issue, i) in report.issues"
              :key="issue.index"
              :data-testid="`quality-issue-${i + 1}`"
            >
              <td class="num">{{ issue.row }}</td>
              <td class="num">{{ issue.col }}</td>
              <td class="hex">
                <span class="swatch" :style="{ background: `#${rgbToHex(issue.src)}` }"></span>
                #{{ rgbToHex(issue.src) }}
              </td>
              <td class="hex">
                <span
                  class="swatch"
                  :style="{ background: `#${palette[issue.paletteIndex].hex}` }"
                ></span>
                #{{ palette[issue.paletteIndex].hex }}（色板 {{ issue.paletteIndex + 1 }}）
              </td>
              <td class="num distance">{{ issue.distance }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="hint" data-testid="quality-no-issues">未发现超限格。</p>
    </template>
  </section>
</template>

<style scoped>
.threshold-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.threshold-row label {
  font-size: 14px;
}

.threshold-input {
  width: 140px;
  padding: 7px 8px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.threshold-input.invalid {
  border-color: #b3261e;
  background: #fdecea;
}

button.secondary {
  background: #fff;
  color: #2f6feb;
  border: 1px solid #2f6feb;
}

button.secondary:hover {
  background: #eef3fe;
}

.error-inline {
  margin: 8px 0 0;
  color: #b3261e;
  font-size: 13px;
}

.quality-summary {
  margin: 12px 0 8px;
  font-size: 14px;
}

.quality-summary strong {
  font-size: 16px;
  color: #b3261e;
}

.zero-note {
  color: #1a7f37;
}

.issues-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.issues-table {
  border-collapse: collapse;
  font-size: 13px;
  width: 100%;
}

.issues-table th,
.issues-table td {
  border: 1px solid #e3e5e8;
  padding: 5px 12px;
  text-align: center;
  white-space: nowrap;
}

.issues-table th {
  background: #f0f0f0;
  position: sticky;
  top: 0;
}

.issues-table .num {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.issues-table .distance {
  font-weight: 600;
}

.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 1px solid #999;
  vertical-align: -2px;
  margin-right: 4px;
}
</style>
