<script setup lang="ts">
import type { GridResult, PaletteColor } from '../core/types';

defineProps<{ result: GridResult; palette: PaletteColor[] }>();
</script>

<template>
  <table class="stats-table" data-testid="stats-table">
    <thead>
      <tr>
        <th>序号</th>
        <th>色样</th>
        <th>色值</th>
        <th>片数</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="(color, i) in palette" :key="color.hex" :data-testid="`stats-row-${i + 1}`">
        <td>{{ i + 1 }}</td>
        <td><span class="swatch" :style="{ background: `#${color.hex}` }"></span></td>
        <td class="hex">#{{ color.hex }}</td>
        <td class="count">{{ result.counts[i] }}</td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.stats-table {
  border-collapse: collapse;
  font-size: 14px;
}

.stats-table th,
.stats-table td {
  border: 1px solid #ddd;
  padding: 6px 14px;
  text-align: center;
}

.stats-table th {
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

.count {
  font-weight: 600;
}
</style>
