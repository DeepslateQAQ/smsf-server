/**
 * MD3 色调（tonal）生成器：只用 HSL 近似 HCT，不引入额外依赖。
 *
 * 规则（参考 Material Design 3 tone 值）：
 * - 浅色：primary = tone 40（较暗），primaryContainer = tone 90（很亮）
 * - 深色：primary = tone 80（很亮），primaryContainer = tone 30（较暗）
 * 因此「浅色 scheme 的 primary 比容器暗、深色 scheme 的 primary 比容器亮」。
 */

export type ColorMode = 'light' | 'dark';

export interface Hsl {
  /** 0-360 */
  h: number;
  /** 0-100 */
  s: number;
  /** 0-100 */
  l: number;
}

export interface TonalScheme {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  error: string;
  onError: string;
  errorContainer: string;
  onErrorContainer: string;
  success: string;
  onSuccess: string;
  successContainer: string;
  onSuccessContainer: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  background: string;
  onBackground: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
  inversePrimary: string;
  scrim: string;
  shadow: string;
  surfaceTint: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** `#abc` / `0b57d0` / `#0B57D0` -> `#0B57D0`；非法返回 null。 */
export function normalizeHex(input: string): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    raw = raw
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex) ?? '#000000';
  const value = Number.parseInt(normalized.slice(1), 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (channel: number) =>
    clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/** 生成 tone 色：`tone(seed, 40)`；`satScale` 用于降低容器/表面的彩度。 */
export function tone(seedHsl: Hsl, lightness: number, saturationScale = 1): string {
  return hslToHex({
    h: seedHsl.h,
    s: clamp(seedHsl.s * saturationScale, 0, 100),
    l: clamp(lightness, 0, 100),
  });
}

export function lighten(hex: string, amount: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: clamp(hsl.l + amount, 0, 100) });
}

export function darken(hex: string, amount: number): string {
  return lighten(hex, -amount);
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

/** WCAG 相对亮度（0-1）。 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function isLight(hex: string): boolean {
  return relativeLuminance(hex) > 0.5;
}

/** 在给定底色上可读的文字色（黑/白）。 */
export function readableOn(background: string): '#000000' | '#FFFFFF' {
  const luminance = relativeLuminance(background);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? '#FFFFFF' : '#000000';
}

/** 依据 seed 生成某个模式的完整 MD3 色调表。 */
export function generateTonalScheme(seed: string, mode: ColorMode): TonalScheme {
  const normalized = normalizeHex(seed) ?? '#0B57D0';
  const base = hexToHsl(normalized);
  // 底色彩度：过于鲜艳的种子色用于表面时降饱和
  const surfaceChroma = clamp(base.s * 0.08, 0, 6);
  const neutralTone = (lightness: number) => hslToHex({ h: base.h, s: surfaceChroma, l: lightness });
  const containerTone = (lightness: number, scale: number) =>
    hslToHex({ h: base.h, s: clamp(base.s * scale, 0, 100), l: lightness });

  if (mode === 'light') {
    const primary = containerTone(40, 1);
    const secondary = containerTone(40, 0.34);
    const tertiary = hslToHex({ h: base.h + 60, s: clamp(base.s * 0.5, 0, 100), l: 40 });
    const error = hslToHex({ h: 4, s: 72, l: 40 });
    const success = hslToHex({ h: 152, s: 45, l: 30 });
    const surface = neutralTone(99);
    return {
      primary,
      // MD3 浅色方案 onPrimary 固定 tone 100（白）。原表达式两种分支实际都返回白色，
      // 纯属冗余（readableOn 被调用两次）。primary 的对比文字走 palette.contrastText（readableOn）。
      onPrimary: '#FFFFFF',
      primaryContainer: containerTone(90, 0.9),
      onPrimaryContainer: containerTone(10, 1),
      secondary,
      onSecondary: readableOn(secondary),
      secondaryContainer: containerTone(90, 0.4),
      onSecondaryContainer: containerTone(20, 0.5),
      tertiary,
      onTertiary: readableOn(tertiary),
      tertiaryContainer: hslToHex({ h: base.h + 60, s: clamp(base.s * 0.45, 0, 100), l: 90 }),
      onTertiaryContainer: hslToHex({ h: base.h + 60, s: clamp(base.s * 0.5, 0, 100), l: 15 }),
      error,
      onError: readableOn(error),
      errorContainer: hslToHex({ h: 4, s: 85, l: 92 }),
      onErrorContainer: hslToHex({ h: 4, s: 80, l: 15 }),
      success,
      onSuccess: readableOn(success),
      successContainer: hslToHex({ h: 152, s: 60, l: 90 }),
      onSuccessContainer: hslToHex({ h: 152, s: 60, l: 15 }),
      surface,
      onSurface: neutralTone(10),
      surfaceVariant: containerTone(90, 0.42),
      onSurfaceVariant: containerTone(30, 0.36),
      surfaceContainerLowest: neutralTone(100),
      surfaceContainerLow: neutralTone(96),
      surfaceContainer: neutralTone(94),
      surfaceContainerHigh: neutralTone(92),
      surfaceContainerHighest: neutralTone(90),
      background: surface,
      onBackground: neutralTone(10),
      outline: containerTone(50, 0.28),
      outlineVariant: containerTone(80, 0.3),
      inverseSurface: neutralTone(20),
      inverseOnSurface: neutralTone(95),
      inversePrimary: hslToHex({ h: base.h, s: clamp(base.s, 0, 100), l: 80 }),
      scrim: '#000000',
      shadow: '#000000',
      surfaceTint: primary,
    };
  }

  const primary = containerTone(80, 0.9);
  const secondary = containerTone(80, 0.3);
  const tertiary = hslToHex({ h: base.h + 60, s: clamp(base.s * 0.45, 0, 100), l: 80 });
  const error = hslToHex({ h: 6, s: 70, l: 80 });
  const success = hslToHex({ h: 152, s: 40, l: 75 });
  const surface = neutralTone(7);
  return {
    primary,
    onPrimary: containerTone(20, 0.9),
    primaryContainer: containerTone(30, 0.85),
    onPrimaryContainer: containerTone(90, 0.85),
    secondary,
    onSecondary: containerTone(20, 0.5),
    secondaryContainer: containerTone(30, 0.35),
    onSecondaryContainer: containerTone(90, 0.4),
    tertiary,
    onTertiary: hslToHex({ h: base.h + 60, s: clamp(base.s * 0.5, 0, 100), l: 20 }),
    tertiaryContainer: hslToHex({ h: base.h + 60, s: clamp(base.s * 0.4, 0, 100), l: 30 }),
    onTertiaryContainer: hslToHex({ h: base.h + 60, s: clamp(base.s * 0.5, 0, 100), l: 90 }),
    error,
    onError: hslToHex({ h: 6, s: 70, l: 20 }),
    errorContainer: hslToHex({ h: 6, s: 60, l: 30 }),
    onErrorContainer: hslToHex({ h: 6, s: 85, l: 90 }),
    success,
    onSuccess: hslToHex({ h: 152, s: 45, l: 20 }),
    successContainer: hslToHex({ h: 152, s: 45, l: 28 }),
    onSuccessContainer: hslToHex({ h: 152, s: 60, l: 88 }),
    surface,
    onSurface: neutralTone(90),
    surfaceVariant: containerTone(30, 0.4),
    onSurfaceVariant: containerTone(80, 0.35),
    surfaceContainerLowest: neutralTone(4),
    surfaceContainerLow: neutralTone(9),
    surfaceContainer: neutralTone(12),
    surfaceContainerHigh: neutralTone(16),
    surfaceContainerHighest: neutralTone(20),
    background: surface,
    onBackground: neutralTone(90),
    outline: containerTone(60, 0.3),
    outlineVariant: containerTone(30, 0.32),
    inverseSurface: neutralTone(90),
    inverseOnSurface: neutralTone(20),
    inversePrimary: containerTone(40, 0.95),
    scrim: '#000000',
    shadow: '#000000',
    surfaceTint: primary,
  };
}

export interface TonalPalette {
  light: TonalScheme;
  dark: TonalScheme;
}

/** 一次生成两套（浅色/深色）色调表。 */
export function generateTonalPalette(seed: string): TonalPalette {
  return {
    light: generateTonalScheme(seed, 'light'),
    dark: generateTonalScheme(seed, 'dark'),
  };
}


