<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { PaletteColor } from '../core/types';
import {
  buildInventoryCheck,
  stockErrorText,
  validateStockInputs,
  type InventoryCheckSheet,
  type StockInputError,
} from '../core/inventory';

const props = defineProps<{
  /** 当前色板；未应用或色板非法时为 null */
  palette: PaletteColor[] | null;
  /** 当前最终色片数（含人工校色）；无映射结果时为 null */
  counts: number[] | null;
}>();

/** 库存录入草稿：与色板一一对应，按色板下标保留 */
const stockInputs = ref<string[]>([]);
/** 已生成的核验单（含生成时的需求与库存快照）；清空前不随映射变化 */
const sheet = ref<InventoryCheckSheet | null>(null);
/**
 * 生成时传入的色板与计数引用，用于判断核验单是否已过期。
 * 用 shallowRef 原样保存引用：深响应式包装会让读出的数组变成代理，
 * 与 props 中的原始引用比较时永远不相等，导致误判过期
 */
const sheetSource = shallowRef<{ palette: PaletteColor[] | null; counts: number[] | null }>({
  palette: null,
  counts: null,
});
/** 最近一次生成被阻止时的录入错误（各自定位到对应色号） */
const errors = ref<StockInputError[]>([]);

/** 有映射结果（色板 + 最终计数）时才可生成核验单 */
const canGenerate = computed(() => props.palette !== null && props.counts !== null);

/** 生成后再人工校色、换图或重应用色板时，快照引用变化，旧核验单标记为已过期 */
const stale = computed(() => {
  if (!sheet.value) return false;
  return props.palette !== sheetSource.value.palette || props.counts !== sheetSource.value.counts;
});

/** 出错的色板下标集合，用于高亮对应库存输入框 */
const invalidSet = computed(() => new Set(errors.value.map((e) => e.paletteIndex)));

const hasDrafts = computed(() => stockInputs.value.some((s) => s.trim() !== ''));

/** 库存不足时的缺口合计，用于汇总展示 */
const totalShortfall = computed(() =>
  sheet.value ? sheet.value.rows.reduce((sum, row) => sum + row.shortfall, 0) : 0,
);

// 色板变化时按色板下标保留已有草稿：超出的丢弃、新增的补空串；
// 旧的录入错误定位随之失效，一并清除
watch(
  () => props.palette,
  (p) => {
    if (p) {
      stockInputs.value = Array.from({ length: p.length }, (_, i) => stockInputs.value[i] ?? '');
    }
    errors.value = [];
  },
);

/** 生成核验单：先校验全部库存录入，任一非法即定位到对应色号并阻止生成 */
function generate() {
  errors.value = [];
  const palette = props.palette;
  const counts = props.counts;
  if (!palette || !counts) return; // 按钮已禁用，防御性处理
  const validation = validateStockInputs(stockInputs.value);
  if (!validation.ok) {
    errors.value = validation.errors;
    return;
  }
  sheet.value = buildInventoryCheck(palette, counts, validation.stocks);
  sheetSource.value = { palette, counts };
}

/** 清空：只移除核验单与库存草稿（及录入错误），不影响网格、统计与导出 */
function clear() {
  sheet.value = null;
  sheetSource.value = { palette: null, counts: null };
  stockInputs.value = Array.from({ length: props.palette?.length ?? 0 }, () => '');
  errors.value = [];
}
</script>

<template>
  <section class="panel inventory-check">
    <h2>6. 备料核验</h2>
    <p class="hint">
      以当前最终色片数为需求快照，逐色录入库房可用库存（非负整数），生成核验单判断能否直接备料；核验不改变网格与采购文本。
    </p>

    <table v-if="palette" class="stock-table" data-testid="stock-table">
      <thead>
        <tr>
          <th>色号</th>
          <th>色样</th>
          <th>色值</th>
          <th>当前需求</th>
          <th>可用库存</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(color, i) in palette" :key="i" :data-testid="`stock-row-${i + 1}`">
          <td>{{ i + 1 }}</td>
          <td><span class="swatch" :style="{ background: `#${color.hex}` }"></span></td>
          <td class="hex">#{{ color.hex }}</td>
          <td class="demand" :data-testid="`stock-demand-${i + 1}`">
            {{ counts ? counts[i] : '—' }}
          </td>
          <td>
            <input
              v-model="stockInputs[i]"
              type="text"
              inputmode="numeric"
              class="stock-input"
              :class="{ invalid: invalidSet.has(i) }"
              :data-testid="`stock-input-${i + 1}`"
              placeholder="非负整数"
              @input="errors = []"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint" data-testid="inventory-no-palette">请先应用合法色板，再录入各色号库存。</p>

    <div class="actions">
      <button type="button" data-testid="generate-check" :disabled="!canGenerate" @click="generate">
        生成核验单
      </button>
      <button
        v-if="sheet || hasDrafts"
        type="button"
        class="secondary"
        data-testid="clear-check"
        @click="clear"
      >
        清空
      </button>
    </div>
    <p v-if="!counts" class="hint" data-testid="inventory-no-counts">
      完成图片映射后即可生成核验单。
    </p>

    <ul v-if="errors.length" class="error-list" data-testid="stock-errors" role="alert">
      <li v-for="e in errors" :key="e.paletteIndex" :data-testid="`stock-error-${e.paletteIndex + 1}`">
        色号 {{ e.paletteIndex + 1 }}<template v-if="palette">（#{{ palette[e.paletteIndex]?.hex }}）</template>：{{ stockErrorText(e.reason) }}
      </li>
    </ul>

    <p v-if="sheet && stale" class="stale-notice" data-testid="stale-notice" role="alert">
      核验单已过期：颜色映射已更新，以下需求快照不再是最新结果，请重新生成核验单。
    </p>

    <div v-if="sheet" class="check-sheet" :class="{ stale }" data-testid="check-sheet">
      <table class="check-table" data-testid="check-table">
        <thead>
          <tr>
            <th>色号</th>
            <th>色值</th>
            <th>需求</th>
            <th>库存</th>
            <th>领用量</th>
            <th>剩余量</th>
            <th>缺口</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in sheet.rows" :key="row.index" :data-testid="`check-row-${row.index}`">
            <td>{{ row.index }}</td>
            <td class="hex">#{{ row.hex }}</td>
            <td class="demand">{{ row.demand }}</td>
            <td class="stock">{{ row.stock }}</td>
            <td class="allocated">{{ row.allocated }}</td>
            <td class="remaining">{{ row.remaining }}</td>
            <td class="shortfall">{{ row.shortfall }}</td>
          </tr>
        </tbody>
      </table>
      <p
        class="check-summary"
        :class="sheet.sufficient ? 'sufficient' : 'insufficient'"
        data-testid="check-summary"
      >
        <template v-if="sheet.sufficient">可直接备料</template>
        <template v-else>库存不足（共缺 {{ totalShortfall }} 片）</template>
      </p>
    </div>
  </section>
</template>

<style scoped>
.inventory-check .hint {
  margin-bottom: 12px;
}

.stock-table,
.check-table {
  border-collapse: collapse;
  font-size: 14px;
  margin-bottom: 12px;
}

.stock-table th,
.stock-table td,
.check-table th,
.check-table td {
  border: 1px solid #ddd;
  padding: 6px 14px;
  text-align: center;
}

.stock-table th,
.check-table th {
  background: #f0f0f0;
}

.swatch {
  display: inline-block;
  width: 18px;
  height: 18px;
  border: 1px solid #999;
  vertical-align: middle;
}

.hex {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.stock-input {
  width: 110px;
  padding: 6px 8px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-align: right;
}

.stock-input.invalid {
  border-color: #b3261e;
  background: #fdecea;
}

.actions {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
}

button.secondary {
  background: #fff;
  color: #2f6feb;
  border: 1px solid #2f6feb;
}

button.secondary:hover {
  background: #eef3fe;
}

.error-list {
  margin: 8px 0;
  padding: 10px 14px 10px 32px;
  background: #fdecea;
  border: 1px solid #f5b7b1;
  color: #b3261e;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.8;
}

.stale-notice {
  margin: 8px 0;
  padding: 10px 14px;
  background: #fff8e1;
  border: 1px solid #f0d98c;
  color: #8a6d00;
  border-radius: 6px;
  font-size: 13px;
}

.check-sheet.stale .check-table {
  opacity: 0.6;
}

.check-summary {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.check-summary.sufficient {
  color: #1a7f37;
}

.check-summary.insufficient {
  color: #b3261e;
}
</style>
