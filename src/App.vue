<script setup lang="ts">
import { computed, ref } from 'vue';
import { decodePngFile, type DecodedImage } from './core/png';
import { parsePalette } from './core/palette';
import { quantizePixels } from './core/quantize';
import { buildExportText } from './core/export';
import type { GridResult, PaletteColor } from './core/types';
import GridView from './components/GridView.vue';
import StatsTable from './components/StatsTable.vue';

const paletteInput = ref('');
const palette = ref<PaletteColor[] | null>(null);
const image = ref<DecodedImage | null>(null);
const imageName = ref('');
const result = ref<GridResult | null>(null);
const error = ref('');

/** 导出内容与网格、统计同源，保证逐格一致 */
const exportText = computed(() => (result.value ? buildExportText(result.value) : ''));

function recompute() {
  if (!image.value || !palette.value) {
    result.value = null;
    return;
  }
  const q = quantizePixels(image.value.data, image.value.width, image.value.height, palette.value);
  if (q.ok) {
    result.value = q.result;
  } else {
    // 解码阶段已校验透明度，理论上不会走到这里；防御性处理
    error.value = q.error;
    result.value = null;
    image.value = null;
  }
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  // 允许再次选择同一文件时仍能触发 change
  input.value = '';
  if (!file) return;

  error.value = '';
  const decoded = await decodePngFile(file);
  if (!decoded.ok) {
    // 非 PNG、解码失败、尺寸越界、透明度非法：清除旧版图并明确报错
    error.value = decoded.error;
    image.value = null;
    imageName.value = '';
    result.value = null;
    return;
  }
  image.value = decoded.image;
  imageName.value = file.name;

  if (!palette.value && paletteInput.value.trim()) {
    // 已填写但未应用的色板，随图片一起校验
    applyPalette();
  } else {
    recompute();
  }
}

function applyPalette() {
  error.value = '';
  const parsed = parsePalette(paletteInput.value);
  if (!parsed.ok) {
    // 色板非法：清除旧版图并明确报错
    error.value = parsed.error;
    palette.value = null;
    result.value = null;
    return;
  }
  palette.value = parsed.colors;
  recompute();
}

function download() {
  const blob = new Blob([exportText.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pixel-mapping.txt';
  a.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <main class="app">
    <h1>彩窗玻璃色号映射工具</h1>
    <p class="intro">
      上传低分辨率 PNG 复原稿，把每个像素归入唯一色号，统计各色玻璃用量并导出采购清单。所有处理均在浏览器内完成，文件不会上传。
    </p>

    <section class="panel">
      <h2>1. 上传 PNG 复原稿</h2>
      <input type="file" accept="image/png,.png" data-testid="file-input" @change="onFileChange" />
      <p class="hint">宽、高各 1–128 像素；完全透明像素视为空格；任一像素透明度不是 0 或 255 时拒绝整图。</p>
      <p v-if="image" class="ok" data-testid="image-info">
        已加载：{{ imageName }}（{{ image.width }}×{{ image.height }}）
      </p>
    </section>

    <section class="panel">
      <h2>2. 输入色板</h2>
      <textarea
        v-model="paletteInput"
        rows="6"
        class="palette-input"
        data-testid="palette-input"
        placeholder="每行一个六位大写十六进制色值，2–16 个且互不重复，例如：&#10;FF0000&#10;00FF00&#10;0000FF"
      ></textarea>
      <div>
        <button type="button" data-testid="apply-palette" @click="applyPalette">应用色板</button>
      </div>
    </section>

    <p v-if="error" class="error" data-testid="error-message" role="alert">{{ error }}</p>

    <template v-if="result && palette">
      <section class="panel">
        <h2>3. 编号网格</h2>
        <GridView :result="result" :palette="palette" />
      </section>

      <section class="panel">
        <h2>4. 用量统计</h2>
        <StatsTable :result="result" :palette="palette" />
      </section>

      <section class="panel">
        <h2>5. 导出</h2>
        <p class="hint">行号、列号、色板序号均从 1 开始，以单个制表符分隔，记录以 LF 分隔，文件末尾不换行。</p>
        <button type="button" data-testid="download-button" @click="download">下载映射文件</button>
        <textarea
          class="export-preview"
          data-testid="export-preview"
          readonly
          rows="8"
          :value="exportText"
          placeholder="没有不透明像素时导出空文件"
        ></textarea>
      </section>
    </template>
    <p v-else-if="!error" class="hint" data-testid="idle-hint">
      上传合法图片并应用合法色板后，此处将显示编号网格、用量统计与导出内容。
    </p>
  </main>
</template>
