import { describe, expect, it } from 'vitest';

import { DEFAULT_SEED, THEME_PRESETS, createAppTheme, md3Geometry, themeVars } from './index';
import { generateTonalScheme, hexToHsl, normalizeHex, relativeLuminance } from './tonal';

const BLUE = '#0B57D0';
const RED = '#B3261E';

describe('tonal generator', () => {
  it('generates different primaries for different seeds', () => {
    const blue = generateTonalScheme(BLUE, 'light');
    const red = generateTonalScheme(RED, 'light');
    expect(blue.primary).not.toBe(red.primary);
    expect(blue.primaryContainer).not.toBe(red.primaryContainer);
    expect(normalizeHex(blue.primary)).toBe(blue.primary);
  });

  it('light mode: primary is darker than its tonal container', () => {
    const light = generateTonalScheme(BLUE, 'light');
    expect(hexToHsl(light.primary).l).toBeLessThan(hexToHsl(light.primaryContainer).l);
    expect(relativeLuminance(light.primary)).toBeLessThan(relativeLuminance(light.primaryContainer));
    expect(relativeLuminance(light.onPrimaryContainer)).toBeLessThan(relativeLuminance(light.primaryContainer));
  });

  it('dark mode: primary is lighter than its tonal container', () => {
    const dark = generateTonalScheme(BLUE, 'dark');
    expect(hexToHsl(dark.primary).l).toBeGreaterThan(hexToHsl(dark.primaryContainer).l);
    expect(relativeLuminance(dark.primary)).toBeGreaterThan(relativeLuminance(dark.primaryContainer));
  });

  it('dark surfaces are darker than light surfaces for the same seed', () => {
    const light = generateTonalScheme(BLUE, 'light');
    const dark = generateTonalScheme(BLUE, 'dark');
    expect(relativeLuminance(dark.surface)).toBeLessThan(relativeLuminance(light.surface));
    expect(relativeLuminance(dark.onSurface)).toBeGreaterThan(relativeLuminance(dark.surface));
    expect(relativeLuminance(light.onSurface)).toBeLessThan(relativeLuminance(light.surface));
  });

  it('dark primary is lighter than light primary for the same seed', () => {
    expect(relativeLuminance(generateTonalScheme(BLUE, 'dark').primary)).toBeGreaterThan(
      relativeLuminance(generateTonalScheme(BLUE, 'light').primary),
    );
  });

  it('keeps the hue of the seed colour', () => {
    const seedHue = hexToHsl(BLUE).h;
    expect(Math.abs(hexToHsl(generateTonalScheme(BLUE, 'light').primary).h - seedHue)).toBeLessThan(6);
    const redHue = hexToHsl(RED).h;
    expect(Math.abs(hexToHsl(generateTonalScheme(RED, 'dark').primary).h - redHue)).toBeLessThan(6);
  });

  it('normalises hex input and rejects garbage', () => {
    expect(normalizeHex('0b57d0')).toBe(BLUE);
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('not-a-colour')).toBeNull();
    expect(generateTonalScheme('not-a-colour', 'light').primary).toBe(
      generateTonalScheme(DEFAULT_SEED, 'light').primary,
    );
  });
});

describe('createAppTheme', () => {
  it('produces different primary colours for different seeds (both schemes)', () => {
    const blue = createAppTheme({ seed: BLUE });
    const red = createAppTheme({ seed: RED });
    expect(blue.colorSchemes.light.palette.primary.main).not.toBe(red.colorSchemes.light.palette.primary.main);
    expect(blue.colorSchemes.dark.palette.primary.main).not.toBe(red.colorSchemes.dark.palette.primary.main);
  });

  it('falls back to the default seed', () => {
    expect(createAppTheme().colorSchemes.light.palette.primary.main).toBe(
      generateTonalScheme(DEFAULT_SEED, 'light').primary,
    );
    expect(createAppTheme({ seed: '#zzz' }).colorSchemes.light.palette.primary.main).toBe(
      generateTonalScheme(DEFAULT_SEED, 'light').primary,
    );
  });

  it('keeps the MD3 lightness relations inside the created theme', () => {
    const theme = createAppTheme({ seed: BLUE });
    const light = theme.colorSchemes.light.palette;
    const dark = theme.colorSchemes.dark.palette;
    expect(hexToHsl(light.primary.main).l).toBeLessThan(hexToHsl(light.primaryContainer).l);
    expect(hexToHsl(dark.primary.main).l).toBeGreaterThan(hexToHsl(dark.primaryContainer).l);
    expect(relativeLuminance(dark.background.default)).toBeLessThan(relativeLuminance(light.background.default));
    expect(relativeLuminance(dark.background.default)).toBeLessThan(relativeLuminance(dark.text.primary));
  });

  it('exposes MD3 tokens, 8 presets and both colour schemes', () => {
    const theme = createAppTheme({ seed: BLUE });
    expect(Object.keys(theme.colorSchemes)).toEqual(['light', 'dark']);
    // MUI 的 shape.borderRadius 必须是数字：它同时是 sx 里数字圆角的乘数基准。
    // 因此圆角令牌的「数字形态」只保留在 md3Geometry.shape.number，不在这里重复一份。
    expect(theme.shape.borderRadius).toBe(md3Geometry.shape.number.md);
    expect(theme.md3.stateLayer.hover).toBe(8);
    expect(THEME_PRESETS).toHaveLength(8);
    expect(THEME_PRESETS.map((preset) => preset.color)).toContain(DEFAULT_SEED);
  });

  it('shape 令牌只能是 px 字符串，否则 sx 会把它乘成 12 倍', () => {
    for (const [key, value] of Object.entries(md3Geometry.shape)) {
      if (key === 'number') continue;
      expect(typeof value, `shape.${key} 必须是 px 字符串`).toBe('string');
      expect(value, `shape.${key} 必须是 px 单位`).toMatch(/^\d+px$/);
    }
  });

  it('turns MD3 tokens into scheme-aware CSS variables', () => {
    const theme = createAppTheme({ seed: BLUE });
    const vars = themeVars(theme);
    expect(vars.palette.primaryContainer).toContain('--mui-palette-primaryContainer');
    expect(vars.palette.primary.main).toContain('--mui-palette-primary-main');
    expect(theme.colorSchemes.light.palette.onPrimaryContainer).toBe(
      generateTonalScheme(BLUE, 'light').onPrimaryContainer,
    );
  });
});
