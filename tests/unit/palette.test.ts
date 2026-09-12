import { describe, expect, it } from 'vitest';
import { parsePalette } from '../../src/core/palette';

describe('parsePalette', () => {
  it('接受 2 个色值（下限）', () => {
    const r = parsePalette('FF0000\n00FF00');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.colors.map((c) => c.hex)).toEqual(['FF0000', '00FF00']);
      expect(r.colors[0].rgb).toEqual({ r: 255, g: 0, b: 0 });
      expect(r.colors[1].rgb).toEqual({ r: 0, g: 255, b: 0 });
    }
  });

  it('接受 16 个色值（上限）并保留顺序', () => {
    const unique = Array.from({ length: 16 }, (_, i) =>
      `${i.toString(16).toUpperCase().padStart(2, '0')}0000`,
    );
    const r = parsePalette(unique.join('\n'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.colors.map((c) => c.hex)).toEqual(unique);
  });

  it('接受空白混合分隔（空格、制表符、换行）', () => {
    const r = parsePalette('  FF0000\t00FF00\n\n0000FF  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.colors).toHaveLength(3);
  });

  it('拒绝空输入与单个色值', () => {
    expect(parsePalette('').ok).toBe(false);
    expect(parsePalette('   \n ').ok).toBe(false);
    expect(parsePalette('FF0000').ok).toBe(false);
  });

  it('拒绝 17 个色值（超出上限）', () => {
    const many = Array.from({ length: 17 }, (_, i) =>
      `${i.toString(16).toUpperCase().padStart(2, '0')}0000`,
    );
    const r = parsePalette(many.join('\n'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('2 至 16');
  });

  it('拒绝小写十六进制', () => {
    const r = parsePalette('ff0000\n00FF00');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('六位大写十六进制');
  });

  it('拒绝带 # 前缀、长度不符与非法字符', () => {
    expect(parsePalette('#FF0000\n00FF00').ok).toBe(false);
    expect(parsePalette('FF000\n00FF00').ok).toBe(false);
    expect(parsePalette('FFF0000\n00FF00').ok).toBe(false);
    expect(parsePalette('GG0000\n00FF00').ok).toBe(false);
  });

  it('拒绝重复色值', () => {
    const r = parsePalette('FF0000\n00FF00\nFF0000');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('重复');
  });
});
