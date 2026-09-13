<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  capacityErrorText,
  nextUnpackedBox,
  packedBoxCount,
  parseCapacity,
  PACKING_CAPACITY_MAX,
  PACKING_CAPACITY_MIN,
  type PackingBox,
  type PackingPlan,
} from '../core/packing';

const props = defineProps<{
  /** 当前保存的批次单状态（含逐箱已装标记）；未创建或已清除时为 null */
  plan: PackingPlan | null;
  /** 当前版图的非透明格总数；无映射结果时为 null */
  pieceCount: number | null;
}>();

const emit = defineEmits<{
  /** 创建批次单：容量已通过校验，为 1–999 的整数 */
  (e: 'create', capacity: number): void;
  /** 把指定箱号标记为已装 */
  (e: 'pack', boxNumber: number): void;
}>();

/** 每箱容量录入草稿（字符串，便于原样保留并定位错误） */
const capacityInput = ref('');
/** 容量录入错误信息；空串表示无错误 */
const capacityError = ref('');

/** 有映射结果且版图含非透明格时才可创建批次单 */
const canCreate = computed(() => props.pieceCount !== null && props.pieceCount > 0);

const packedCount = computed(() => (props.plan ? packedBoxCount(props.plan) : 0));

/** 完成比例：已装箱数占总箱数的百分比（四舍五入到整数） */
const progressPercent = computed(() => {
  const plan = props.plan;
  if (!plan) return 0;
  return Math.round((packedCount.value / plan.totalBoxes) * 100);
});

/** 下一箱提示：按箱号顺序第一箱未装的；全部装完时为 null */
const nextBox = computed(() => (props.plan ? nextUnpackedBox(props.plan) : null));

/** 全部装完：批次单存在且没有未装箱 */
const allPacked = computed(() => props.plan !== null && nextBox.value === null);

/** 创建批次单：先校验容量，非法时定位报错并保留已有批次单（不发出创建事件） */
function create() {
  const parsed = parseCapacity(capacityInput.value);
  if (!parsed.ok) {
    capacityError.value = capacityErrorText(parsed.reason);
    return;
  }
  capacityError.value = '';
  if (!canCreate.value) return; // 没有可装箱玻璃：不创建记录
  emit('create', parsed.value);
}

function pack(boxNumber: number) {
  emit('pack', boxNumber);
}

/** 坐标范围展示：单片箱只列一个坐标，多片箱列首片 → 末片 */
function rangeText(box: PackingBox): string {
  const first = box.pieces[0];
  const last = box.pieces[box.pieces.length - 1];
  const fmt = (p: { row: number; col: number }) => `第 ${p.row} 行第 ${p.col} 列`;
  return box.count === 1 ? fmt(first) : `${fmt(first)} → ${fmt(last)}`;
}
</script>

<template>
  <section class="panel packing-plan" data-testid="packing-panel">
    <h2>8. 装箱批次</h2>
    <p class="hint">
      按最终映射（含人工校色）把每个非透明格编入唯一批次：按色号分组、同色相按行列顺序排列，数量超过容量时连续拆箱。逐箱标记已装，跟踪现场装箱进度。
    </p>

    <div class="capacity-row">
      <label for="packing-capacity">每箱容量（{{ PACKING_CAPACITY_MIN }}–{{ PACKING_CAPACITY_MAX }} 片的整数）</label>
      <input
        id="packing-capacity"
        v-model="capacityInput"
        type="text"
        inputmode="numeric"
        class="capacity-input"
        :class="{ invalid: capacityError !== '' }"
        data-testid="capacity-input"
        placeholder="如 24"
        @keyup.enter="create"
      />
      <button type="button" data-testid="create-plan" :disabled="!canCreate" @click="create">
        创建批次单
      </button>
    </div>
    <p v-if="capacityError" class="error-inline" data-testid="capacity-error" role="alert">
      {{ capacityError }}
    </p>

    <p v-if="pieceCount === null" class="hint" data-testid="packing-no-mapping">
      完成图片映射后即可创建批次单。
    </p>
    <p v-else-if="pieceCount === 0" class="hint" data-testid="packing-no-pieces">
      当前版图没有可装箱玻璃（全部透明），不创建批次单。
    </p>

    <div v-if="plan" class="plan" data-testid="packing-plan">
      <p class="plan-summary" data-testid="packing-summary">
        每箱 {{ plan.capacity }} 片，共 {{ plan.totalPieces }} 片 / {{ plan.totalBoxes }} 箱
      </p>
      <p class="plan-progress" data-testid="packing-progress">
        已装 <strong>{{ packedCount }}</strong> / {{ plan.totalBoxes }} 箱（{{ progressPercent }}%）
      </p>
      <p v-if="allPacked" class="plan-complete" data-testid="packing-complete">
        全部装箱完成：{{ plan.totalBoxes }} 箱共 {{ plan.totalPieces }} 片。
      </p>
      <p v-else-if="nextBox" class="plan-next" data-testid="packing-next">
        下一箱：第 {{ nextBox.boxNumber }} 箱（色号 {{ nextBox.colorIndex }}，{{ nextBox.count }} 片）
      </p>

      <div class="boxes-wrap">
        <table class="boxes-table" data-testid="packing-boxes">
          <thead>
            <tr>
              <th>箱号</th>
              <th>色号</th>
              <th>色样</th>
              <th>坐标范围</th>
              <th>片数</th>
              <th>装箱</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="box in plan.boxes"
              :key="box.boxNumber"
              :class="{ packed: box.packed }"
              :data-testid="`pack-box-${box.boxNumber}`"
            >
              <td class="num box-number">{{ box.boxNumber }}</td>
              <td class="num color-index">{{ box.colorIndex }}</td>
              <td>
                <span class="swatch" :style="{ background: `#${box.hex}` }"></span>
                <span class="hex">#{{ box.hex }}</span>
              </td>
              <td class="range">{{ rangeText(box) }}</td>
              <td class="num count">{{ box.count }}</td>
              <td>
                <span v-if="box.packed" class="packed-label">已装</span>
                <button
                  v-else
                  type="button"
                  class="pack-button"
                  :data-testid="`pack-button-${box.boxNumber}`"
                  @click="pack(box.boxNumber)"
                >
                  标记已装
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.packing-plan .hint {
  margin-bottom: 12px;
}

.capacity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.capacity-row label {
  font-size: 14px;
}

.capacity-input {
  width: 120px;
  padding: 7px 8px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  text-align: right;
}

.capacity-input.invalid {
  border-color: #b3261e;
  background: #fdecea;
}

.error-inline {
  margin: 8px 0 0;
  color: #b3261e;
  font-size: 13px;
}

.plan-summary,
.plan-progress {
  margin: 12px 0 4px;
  font-size: 14px;
}

.plan-progress strong {
  font-size: 16px;
  color: #2f6feb;
}

.plan-next {
  margin: 4px 0 0;
  font-size: 14px;
  color: #8a6d00;
}

.plan-complete {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: #1a7f37;
}

.boxes-wrap {
  margin-top: 12px;
  max-height: 320px;
  overflow: auto;
  border: 1px solid #ddd;
  border-radius: 4px;
}

.boxes-table {
  border-collapse: collapse;
  font-size: 13px;
  width: 100%;
}

.boxes-table th,
.boxes-table td {
  border: 1px solid #e3e5e8;
  padding: 5px 12px;
  text-align: center;
  white-space: nowrap;
}

.boxes-table th {
  background: #f0f0f0;
  position: sticky;
  top: 0;
}

.boxes-table tr.packed td {
  background: #f2fbf4;
  color: #666;
}

.boxes-table .num {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.boxes-table .count {
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

.hex {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.packed-label {
  color: #1a7f37;
  font-weight: 600;
}

.pack-button {
  padding: 3px 10px;
  font-size: 13px;
}
</style>
