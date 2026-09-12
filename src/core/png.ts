export const MIN_DIM = 1;
export const MAX_DIM = 128;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type DecodeResult =
  | { ok: true; image: DecodedImage }
  | { ok: false; error: string };

/**
 * 仅在浏览器内用标准能力解码 PNG 文件，不做任何网络传输。
 * 依次校验：PNG 魔数 → 可解码 → 宽高 1–128 → 透明度仅为 0 或 255。
 */
export async function decodePngFile(file: File): Promise<DecodeResult> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, error: '无法读取文件' };
  }

  if (bytes.length < PNG_MAGIC.length || !PNG_MAGIC.every((b, i) => bytes[i] === b)) {
    return { ok: false, error: '文件不是 PNG 格式' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  } catch {
    return { ok: false, error: 'PNG 解码失败，文件可能已损坏' };
  }

  try {
    const { width, height } = bitmap;
    if (width < MIN_DIM || width > MAX_DIM || height < MIN_DIM || height > MAX_DIM) {
      return {
        ok: false,
        error: `图片尺寸为 ${width}×${height}，超出限制：宽、高均须在 ${MIN_DIM} 至 ${MAX_DIM} 像素之间`,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { ok: false, error: '无法创建画布上下文' };
    }
    ctx.drawImage(bitmap, 0, 0);

    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
      return { ok: false, error: '无法读取像素数据' };
    }

    // 在读取阶段就拒绝非法透明度，保证进入映射的数据必然合法
    for (let p = 0, i = 3; p < width * height; p++, i += 4) {
      const a = data[i];
      if (a !== 0 && a !== 255) {
        const row = Math.floor(p / width) + 1;
        const col = (p % width) + 1;
        return {
          ok: false,
          error: `第 ${row} 行第 ${col} 列像素的透明度为 ${a}，仅允许 0 或 255，已拒绝整图`,
        };
      }
    }

    return { ok: true, image: { data, width, height } };
  } finally {
    bitmap.close();
  }
}
