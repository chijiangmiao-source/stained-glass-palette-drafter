import zlib from 'node:zlib';

/** 测试用最小 PNG 编码器：8 位 RGBA、无滤波、无隔行 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

export interface RgbaPixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const TRANSPARENT: RgbaPixel = { r: 0, g: 0, b: 0, a: 0 };

/** 由六位十六进制字符串构造不透明像素 */
export function px(hex: string, a = 255): RgbaPixel {
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a,
  };
}

/** 生成合法 PNG 文件内容；pixels 按行优先，长度须等于 width*height */
export function makePng(width: number, height: number, pixels: RgbaPixel[]): Buffer {
  if (pixels.length !== width * height) {
    throw new Error(`像素数 ${pixels.length} 与尺寸 ${width}×${height} 不符`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深 8
  ihdr[9] = 6; // 颜色类型 RGBA
  // 压缩方式、滤波方式、隔行方式均为 0

  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0; // 每行滤波类型：无
    for (let x = 0; x < width; x++) {
      const p = pixels[y * width + x];
      const o = rowStart + 1 + x * 4;
      raw[o] = p.r;
      raw[o + 1] = p.g;
      raw[o + 2] = p.b;
      raw[o + 3] = p.a;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
