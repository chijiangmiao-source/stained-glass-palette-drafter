/** 8 位 sRGB 整数颜色 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 色板中的一个颜色 */
export interface PaletteColor {
  /** 六位大写十六进制，不含 '#'，如 "FF0000" */
  hex: string;
  rgb: Rgb;
}

/** 网格中一个像素格的映射结果 */
export interface CellInfo {
  /** 行号，从 1 开始 */
  row: number;
  /** 列号，从 1 开始 */
  col: number;
  /** 完全透明像素视为空格 */
  blank: boolean;
  /** 原图颜色；空格为 null */
  src: Rgb | null;
  /** 命中的色板下标（0 起始）；空格为 -1 */
  paletteIndex: number;
}

/** 整幅图的映射结果：网格、统计与导出共用同一份数据 */
export interface GridResult {
  width: number;
  height: number;
  /** 行优先排列，长度 = width * height */
  cells: CellInfo[];
  /** 每个色板颜色命中的片数，长度 = 色板颜色数 */
  counts: number[];
}
