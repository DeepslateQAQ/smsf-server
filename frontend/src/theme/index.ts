/**
 * MD3 主题：`createTheme` + `colorSchemes`（浅/深）+ CSS 变量。
 *
 * 由 `theme_seed` 生成的色调表放进每个 colorScheme 的 palette，因此
 * `--mui-palette-primaryContainer` 这类 MD3 token 都是 scheme 感知的 CSS 变量。
 */

import { createTheme, type Theme, type ThemeOptions } from '@mui/material/styles';
import type { CSSProperties } from 'react';

import type { ThemeMode } from '@/api/types';

import './mui-augment';
import { md3Geometry } from './md3Geometry';
import { generateTonalScheme, lighten, darken, normalizeHex, readableOn, withAlpha, type TonalScheme } from './tonal';

export const DEFAULT_SEED = '#0B57D0';

/** 8 个预设种子色（含默认色）。 */
export const THEME_PRESETS: ReadonlyArray<{ id: string; color: string; labelKey: string }> = [
  { id: 'blue', color: '#0B57D0', labelKey: 'settings.presetBlue' },
  { id: 'teal', color: '#00696D', labelKey: 'settings.presetTeal' },
  { id: 'green', color: '#146C2E', labelKey: 'settings.presetGreen' },
  { id: 'amber', color: '#7A5900', labelKey: 'settings.presetAmber' },
  { id: 'orange', color: '#8F4C00', labelKey: 'settings.presetOrange' },
  { id: 'red', color: '#B3261E', labelKey: 'settings.presetRed' },
  { id: 'purple', color: '#6750A4', labelKey: 'settings.presetPurple' },
  { id: 'pink', color: '#B90063', labelKey: 'settings.presetPink' },
];

/**
 * MD3 几何度量：唯一事实源在 `./md3Geometry`。
 * 这里只做转出，保证既有 `import { md3Geometry } from '@/theme'` 仍然可用。
 */
export { md3Geometry };

/** MD3 state layer 强度。圆角一律用 `md3Geometry.shape`，不在这里重复一份。 */
export const md3Tokens = {
  /* 现行 MD3 规范：hover 8 / focus 10 / pressed 10（旧值 12 已被 10 取代，MUI 内置默认仍是 12）。 */
  stateLayer: { hover: 8, focus: 10, pressed: 10, selected: 16, disabled: 38, disabledContainer: 12 },
  elevation: {
    level0: 'none',
    level1: '0 1px 2px 0 rgba(0,0,0,.30), 0 1px 3px 1px rgba(0,0,0,.15)',
    level2: '0 1px 2px 0 rgba(0,0,0,.30), 0 2px 6px 2px rgba(0,0,0,.15)',
    level3: '0 1px 3px 0 rgba(0,0,0,.30), 0 4px 8px 3px rgba(0,0,0,.15)',
    level4: '0 2px 3px 0 rgba(0,0,0,.30), 0 6px 10px 4px rgba(0,0,0,.15)',
    level5: '0 4px 4px 0 rgba(0,0,0,.30), 0 8px 12px 6px rgba(0,0,0,.15)',
  },
} as const;

/** state layer 叠加：`color-mix` 优先，保证浅/深色都正确。 */
export function stateLayer(color: string, percent: number = md3Tokens.stateLayer.hover, rest = 'transparent'): string {
  return `color-mix(in srgb, ${color} ${percent}%, ${rest})`;
}

/** 取 scheme 感知的 CSS 变量树（`theme.vars`）；没有 vars 时退回字面量 palette。 */
export interface MuiVars {
  /* `theme.vars.palette.primary.main` 之类的 CSS 变量引用（字符串） */
  palette: Record<string, any>;
  shape: Record<string, any>;
}

export function themeVars(theme: Theme): MuiVars {
  const withVars = theme as unknown as { vars?: MuiVars };
  return withVars.vars ?? (theme as unknown as MuiVars);
}

export interface AppColorScheme {
  /* MUI 生成的 scheme 调色板：既含标准 key（primary.main…）也含 MD3 扩展 token */
  palette: Record<string, any>;
}

export type AppTheme = Theme & {
  colorSchemes: Record<'light' | 'dark', AppColorScheme>;
  md3: typeof md3Tokens;
};

export interface CreateAppThemeOptions {
  /** 主题种子色，非法值回退到默认色 */
  seed?: string;
}

const FONT_STACK = [
  '"Roboto"',
  '"Microsoft YaHei"',
  'system-ui',
  '-apple-system',
  '"Segoe UI"',
  'sans-serif',
].join(', ');

/**
 * MD3 type scale：数值全部来自 `md3Geometry.type`（单一事实源）。
 * MUI 内置 body1/body2 在 createAppTheme 里映射到 bodyLarge/bodyMedium。
 */
const MD3_TYPOGRAPHY = md3Geometry.type satisfies Record<string, CSSProperties>;

function paletteColor(main: string) {
  return {
    main,
    light: lighten(main, 12),
    dark: darken(main, 12),
    contrastText: readableOn(main),
  };
}

/** 把一套色调表转成 MUI palette（含 MD3 扩展 token）。 */
function schemePalette(scheme: TonalScheme): Record<string, unknown> {
  return {
    primary: paletteColor(scheme.primary),
    secondary: paletteColor(scheme.secondary),
    error: paletteColor(scheme.error),
    warning: paletteColor(scheme.tertiary),
    info: paletteColor(scheme.tertiary),
    success: paletteColor(scheme.success),
    background: { default: scheme.surface, paper: scheme.surfaceContainerLow },
    text: {
      primary: scheme.onSurface,
      secondary: scheme.onSurfaceVariant,
      disabled: withAlpha(scheme.onSurface, md3Tokens.stateLayer.disabled / 100),
    },
    divider: scheme.outlineVariant,
    action: {
      hover: withAlpha(scheme.onSurface, md3Tokens.stateLayer.hover / 100),
      hoverOpacity: md3Tokens.stateLayer.hover / 100,
      selected: withAlpha(scheme.onSurface, md3Tokens.stateLayer.selected / 100),
      selectedOpacity: md3Tokens.stateLayer.selected / 100,
      focus: withAlpha(scheme.onSurface, md3Tokens.stateLayer.focus / 100),
      focusOpacity: md3Tokens.stateLayer.focus / 100,
      disabled: withAlpha(scheme.onSurface, md3Tokens.stateLayer.disabled / 100),
      disabledBackground: withAlpha(scheme.onSurface, md3Tokens.stateLayer.disabledContainer / 100),
    },
    // ---------------------------------------------------------- MD3 tokens
    // MD3 on-* 角色：Switch 选中 thumb 等控件需要（数值来自既有 TonalScheme，未改配色逻辑）
    onPrimary: scheme.onPrimary,
    onSecondary: scheme.onSecondary,
    onError: scheme.onError,
    primaryContainer: scheme.primaryContainer,
    onPrimaryContainer: scheme.onPrimaryContainer,
    secondaryContainer: scheme.secondaryContainer,
    onSecondaryContainer: scheme.onSecondaryContainer,
    tertiary: scheme.tertiary,
    onTertiary: scheme.onTertiary,
    tertiaryContainer: scheme.tertiaryContainer,
    onTertiaryContainer: scheme.onTertiaryContainer,
    errorContainer: scheme.errorContainer,
    onErrorContainer: scheme.onErrorContainer,
    successContainer: scheme.successContainer,
    onSuccessContainer: scheme.onSuccessContainer,
    surface: scheme.surface,
    onSurface: scheme.onSurface,
    surfaceVariant: scheme.surfaceVariant,
    onSurfaceVariant: scheme.onSurfaceVariant,
    surfaceContainerLowest: scheme.surfaceContainerLowest,
    surfaceContainerLow: scheme.surfaceContainerLow,
    surfaceContainer: scheme.surfaceContainer,
    surfaceContainerHigh: scheme.surfaceContainerHigh,
    surfaceContainerHighest: scheme.surfaceContainerHighest,
    outline: scheme.outline,
    outlineVariant: scheme.outlineVariant,
    inverseSurface: scheme.inverseSurface,
    inverseOnSurface: scheme.inverseOnSurface,
    inversePrimary: scheme.inversePrimary,
    scrim: scheme.scrim,
    shadow: scheme.shadow,
    surfaceTint: scheme.surfaceTint,
  };
}

/** 生成一套主题（默认 seed = #0B57D0）。 */
export function createAppTheme(options: CreateAppThemeOptions = {}): AppTheme {
  const seed = normalizeHex(options.seed ?? DEFAULT_SEED) ?? DEFAULT_SEED;
  const light = generateTonalScheme(seed, 'light');
  const dark = generateTonalScheme(seed, 'dark');

  const themeOptions: ThemeOptions = {
    cssVariables: {
      colorSchemeSelector: 'data-mui-color-scheme',
      cssVarPrefix: 'mui',
    },
    colorSchemes: {
      light: { palette: schemePalette(light) as ThemeOptions['palette'] },
      dark: { palette: schemePalette(dark) as ThemeOptions['palette'] },
    },
    shape: { borderRadius: md3Geometry.shape.number.md },
    spacing: 8,
    typography: {
      fontFamily: FONT_STACK,
      /**
       * labelLarge：14/500/20px/0.1px。
       * 这里曾是 `fontWeight: 600 / letterSpacing: 0.01em`，会让 Tab、分段按钮等
       * 依赖 `typography.button` 的控件落到 600，必须与 md3Geometry.type.labelLarge 一致。
       */
      button: { ...md3Geometry.type.labelLarge, textTransform: 'none' },
      // MUI 内置 body1/body2（MenuItem、InputBase、SnackbarContent 等在用）对齐 MD3。
      body1: md3Geometry.type.bodyLarge,
      body2: md3Geometry.type.bodyMedium,
      ...MD3_TYPOGRAPHY,
      /**
       * MUI 遗留变体映射到 MD3 type scale（MD3 没有 hN/subtitle/caption/overline）：
       * 不映射会落入 MUI 默认样式（h1 甚至是 6rem light），与 MD3 观感割裂。
       */
      h1: md3Geometry.type.displaySmall,
      h2: md3Geometry.type.headlineLarge,
      h3: md3Geometry.type.headlineMedium,
      h4: md3Geometry.type.headlineSmall,
      h5: md3Geometry.type.titleLarge,
      h6: md3Geometry.type.titleMedium,
      subtitle1: md3Geometry.type.titleMedium,
      subtitle2: md3Geometry.type.titleSmall,
      caption: md3Geometry.type.bodySmall,
      overline: { ...md3Geometry.type.labelSmall, textTransform: 'none' },
    },
    components: {
      /**
       * MUI Typography 只对内置变体有语义标签映射，未知变体静默渲染成 <span>（inline）。
       * 相邻的自定义变体（titleMedium + bodySmall 等）会横排粘在一起、margin 也塌掉。
       * 这里把 MD3 变体统一锚定到块级标签（语义可由 component 覆盖补齐）。
       */
      MuiTypography: {
        defaultProps: {
          variantMapping: {
            /* 内置变体保持 MUI 默认语义标签（variantMapping 是整表覆盖，不是合并） */
            h1: 'h1',
            h2: 'h2',
            h3: 'h3',
            h4: 'h4',
            h5: 'h5',
            h6: 'h6',
            subtitle1: 'h6',
            subtitle2: 'h6',
            body1: 'p',
            body2: 'p',
            inherit: 'p',
            button: 'span',
            caption: 'p',
            overline: 'span',
            /* MD3 变体：锚定到块级标签（语义可由 component 覆盖补齐） */
            displayLarge: 'h1',
            displayMedium: 'h1',
            displaySmall: 'h1',
            headlineLarge: 'h2',
            headlineMedium: 'h2',
            headlineSmall: 'h2',
            titleLarge: 'div',
            titleMedium: 'div',
            titleSmall: 'div',
            bodyLarge: 'p',
            bodyMedium: 'p',
            bodySmall: 'p',
            labelLarge: 'span',
            labelMedium: 'span',
            labelSmall: 'span',
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: (theme) => {
          const { palette } = themeVars(theme);
          return {
            'html, body, #root': { height: '100%' },
            html: { colorScheme: 'light dark' },
            body: {
              backgroundColor: palette.background.default,
              color: palette.text.primary,
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
            },
            '::selection': {
              backgroundColor: palette.primaryContainer,
              color: palette.onPrimaryContainer,
            },
            '*::-webkit-scrollbar': {
              width: md3Geometry.size.scrollbarThickness,
              height: md3Geometry.size.scrollbarThickness,
            },
            '*::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
            '*::-webkit-scrollbar-thumb': {
              backgroundColor: palette.outlineVariant,
              borderRadius: md3Geometry.shape.full,
              border: `${md3Geometry.border.standard}px solid ${palette.background.default}`,
            },
          };
        },
      },

      /* ---------------------------------------------------------------- Button */
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          /* 外显几何：40 高 / full 圆角 / 水平内边距 24 / labelLarge / text-transform: none */
          root: ({ theme }) => ({
            height: md3Geometry.height.button,
            minHeight: md3Geometry.height.button,
            borderRadius: md3Geometry.shape.full,
            paddingInline: md3Geometry.space.x6,
            paddingBlock: 0,
            fontSize: md3Geometry.type.labelLarge.fontSize,
            fontWeight: md3Geometry.type.labelLarge.fontWeight,
            lineHeight: md3Geometry.type.labelLarge.lineHeight,
            letterSpacing: md3Geometry.type.labelLarge.letterSpacing,
            textTransform: 'none',
            whiteSpace: 'nowrap',
            '& .MuiButton-startIcon, & .MuiButton-endIcon': {
              margin: 0,
              '& > *:nth-of-type(1)': { fontSize: md3Geometry.icon.sm },
            },
            '& .MuiButton-startIcon': { marginRight: md3Geometry.space.x2 },
            '& .MuiButton-endIcon': { marginLeft: md3Geometry.space.x2 },
            transition: theme.transitions.create(['background-color', 'box-shadow', 'color'], {
              duration: theme.transitions.duration.shortest,
            }),
          }),
          containedPrimary: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              /* Filled button hover uses the MD3 onPrimary 8% state layer. */
              '&:hover': {
                backgroundColor: stateLayer(palette.onPrimary, md3Tokens.stateLayer.hover, palette.primary.main),
              },
            };
          },
          outlined: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderColor: palette.outline,
              '&:hover': {
                backgroundColor: stateLayer(palette.primary.main, md3Tokens.stateLayer.hover),
                borderColor: palette.outline,
              },
            };
          },
          text: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              '&:hover': { backgroundColor: stateLayer(palette.primary.main, md3Tokens.stateLayer.hover) },
            };
          },
        },
      },

      /* ------------------------------- ToggleButton / ToggleButtonGroup（分段按钮） */
      MuiToggleButton: {
        styleOverrides: {
          /* 40 高 / full 圆角（相邻处由 Group 置 0）/ 选中 secondaryContainer / labelLarge */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const container = palette.secondaryContainer;
            const onContainer = palette.onSecondaryContainer;
            return {
              height: md3Geometry.height.segmentedButton,
              minHeight: md3Geometry.height.segmentedButton,
              paddingInline: md3Geometry.space.x4,
              paddingBlock: 0,
              borderRadius: md3Geometry.shape.full,
              borderColor: palette.outline,
              color: palette.text.primary,
              fontSize: md3Geometry.type.labelLarge.fontSize,
              fontWeight: md3Geometry.type.labelLarge.fontWeight,
              lineHeight: md3Geometry.type.labelLarge.lineHeight,
              letterSpacing: md3Geometry.type.labelLarge.letterSpacing,
              textTransform: 'none',
              transition: theme.transitions.create(['background-color', 'color', 'border-color'], {
                duration: theme.transitions.duration.shortest,
              }),
              '&:hover': { backgroundColor: stateLayer(palette.text.primary, md3Tokens.stateLayer.hover) },
              '&.Mui-selected': {
                backgroundColor: container,
                color: onContainer,
              },
              '&.Mui-selected:hover': {
                backgroundColor: stateLayer(onContainer, md3Tokens.stateLayer.hover, container),
              },
            };
          },
        },
      },
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: { borderRadius: md3Geometry.shape.full },
        },
      },

      /* ------------------------------------------------------------- IconButton */
      MuiIconButton: {
        styleOverrides: {
          /* 外显几何：40×40 / full 圆角 / 图标 24 */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              width: md3Geometry.height.iconButton,
              height: md3Geometry.height.iconButton,
              padding: (md3Geometry.height.iconButton - md3Geometry.icon.lg) / 2,
              borderRadius: md3Geometry.shape.full,
              '& svg': { fontSize: md3Geometry.icon.lg },
              '&:hover': { backgroundColor: stateLayer(palette.onSurfaceVariant, md3Tokens.stateLayer.hover) },
            };
          },
        },
      },

      /* -------------------------------------------------------------------- Fab */
      MuiFab: {
        defaultProps: { color: 'primary' },
        styleOverrides: {
          /* 外显几何：56 高 / 16 圆角 / 扩展态水平内边距 20 / 图标-文字间隔 12 */
          root: ({ theme }) => ({
            width: md3Geometry.height.fab,
            height: md3Geometry.height.fab,
            minHeight: md3Geometry.height.fab,
            borderRadius: md3Geometry.shape.lg,
            paddingInline: md3Geometry.space.x5,
            columnGap: md3Geometry.space.x3,
            fontSize: md3Geometry.type.labelLarge.fontSize,
            fontWeight: md3Geometry.type.labelLarge.fontWeight,
            lineHeight: md3Geometry.type.labelLarge.lineHeight,
            letterSpacing: md3Geometry.type.labelLarge.letterSpacing,
            textTransform: 'none',
            boxShadow: md3Tokens.elevation.level3,
            '& .MuiFab-startIcon, & .MuiFab-endIcon': { margin: 0 },
            transition: theme.transitions.create(['background-color', 'box-shadow'], {
              duration: theme.transitions.duration.shortest,
            }),
          }),
          extended: {
            width: 'auto',
            minWidth: md3Geometry.height.fab,
            height: md3Geometry.height.fab,
            minHeight: md3Geometry.height.fab,
            paddingInline: md3Geometry.space.x5,
            borderRadius: md3Geometry.shape.lg,
          },
          primary: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              backgroundColor: palette.primaryContainer,
              color: palette.onPrimaryContainer,
              '&:hover': {
                backgroundColor: stateLayer(palette.onPrimaryContainer, md3Tokens.stateLayer.hover, palette.primaryContainer),
              },
            };
          },
        },
      },

      /* ------------------------------------------------------------------- Chip */
      MuiChip: {
        styleOverrides: {
          /* 外显几何：32 高 / 8 圆角 / 无图标左右 12；带图标 8/12 / 1px outline / labelLarge */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const label = md3Geometry.type.labelLarge;
            return {
              height: md3Geometry.height.chip,
              borderRadius: md3Geometry.shape.sm,
              fontSize: label.fontSize,
              fontWeight: label.fontWeight,
              lineHeight: label.lineHeight,
              letterSpacing: label.letterSpacing,
              '& .MuiChip-label': {
                paddingLeft: md3Geometry.space.x3,
                paddingRight: md3Geometry.space.x3,
                fontSize: label.fontSize,
                fontWeight: label.fontWeight,
                lineHeight: label.lineHeight,
                letterSpacing: label.letterSpacing,
              },
              '& .MuiChip-icon': {
                fontSize: md3Geometry.icon.sm,
                marginLeft: md3Geometry.space.x2,
                marginRight: md3Geometry.space.x2 - md3Geometry.space.x3,
              },
              '& .MuiChip-deleteIcon': {
                fontSize: md3Geometry.icon.sm,
                margin: `${md3Geometry.space.x0}px ${md3Geometry.space.x2}px ${md3Geometry.space.x0}px ${md3Geometry.space.x2 - md3Geometry.space.x3}px`,
              },
              '&.MuiChip-outlined': {
                borderColor: palette.outline,
                // 1px 描边占掉 1px：左右/图标仍应落在 8/12px 处
                '& .MuiChip-label': {
                  paddingLeft: md3Geometry.space.x3 - md3Geometry.border.hairline,
                  paddingRight: md3Geometry.space.x3 - md3Geometry.border.hairline,
                },
                '& .MuiChip-icon': {
                  marginLeft: md3Geometry.space.x2 - md3Geometry.border.hairline,
                  // 与 label 的 11px padding 相加仍为 8px 间隔
                  marginRight: -(md3Geometry.space.x3 - md3Geometry.border.hairline - md3Geometry.space.x2),
                },
              },
            };
          },
          filledPrimary: ({ theme }) => {
            const { palette } = themeVars(theme);
            return { backgroundColor: palette.secondaryContainer, color: palette.onSecondaryContainer };
          },
        },
      },

      /* ------------------------------------------------- TextField / 输入框系列 */
      MuiTextField: { defaultProps: { variant: 'filled' } },
      MuiInputLabel: {
        styleOverrides: {
          /* 输入 16/400；上浮后 12/500（显式 12px + scale(1)，不再靠 0.75 缩放“看起来像 12”） */
          root: {
            fontSize: md3Geometry.type.bodyLarge.fontSize,
            fontWeight: md3Geometry.type.bodyLarge.fontWeight,
            lineHeight: md3Geometry.type.bodyLarge.lineHeight,
            letterSpacing: md3Geometry.type.bodyLarge.letterSpacing,
          },
          shrink: {
            fontSize: md3Geometry.type.labelMedium.fontSize,
            fontWeight: md3Geometry.type.labelMedium.fontWeight,
            lineHeight: md3Geometry.type.labelMedium.lineHeight,
            letterSpacing: md3Geometry.type.labelMedium.letterSpacing,
          },
          outlined: {
            transform: `translate(${md3Geometry.field.outlined.labelRestX}px, ${md3Geometry.field.outlined.labelRestY}px) scale(1)`,
            '&.MuiInputLabel-shrink': {
              transform: `translate(${md3Geometry.field.outlined.labelRestX}px, ${md3Geometry.field.outlined.labelShrinkY}px) scale(1)`,
            },
            /* size=small：label 静态/上浮位置随 40px 盒高收紧 */
            '&.MuiInputLabel-sizeSmall': {
              transform: `translate(${md3Geometry.field.small.outlined.labelRestX}px, ${md3Geometry.field.small.outlined.labelRestY}px) scale(1)`,
              '&.MuiInputLabel-shrink': {
                transform: `translate(${md3Geometry.field.small.outlined.labelRestX}px, ${md3Geometry.field.small.outlined.labelShrinkY}px) scale(1)`,
              },
            },
          },
          filled: {
            transform: `translate(${md3Geometry.field.filled.labelRestX}px, ${md3Geometry.field.filled.labelRestY}px) scale(1)`,
            '&.MuiInputLabel-shrink': {
              transform: `translate(${md3Geometry.field.filled.labelRestX}px, ${md3Geometry.field.filled.labelShrinkY}px) scale(1)`,
            },
            '&.MuiInputLabel-sizeSmall': {
              transform: `translate(${md3Geometry.field.small.filled.labelRestX}px, ${md3Geometry.field.small.filled.labelRestY}px) scale(1)`,
              '&.MuiInputLabel-shrink': {
                transform: `translate(${md3Geometry.field.small.filled.labelRestX}px, ${md3Geometry.field.small.filled.labelShrinkY}px) scale(1)`,
              },
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          /* 外显几何：56 高 / 4 圆角 / 轮廓 1px outline、聚焦 2px primary / 输入 16、400 */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const small = md3Geometry.field.small;
            return {
              borderRadius: md3Geometry.shape.xs,
              height: md3Geometry.height.textField,
              minHeight: md3Geometry.height.textField,
              '&.MuiOutlinedInput-multiline': { height: 'auto' },
              /* size=small：40 高（MUI small 输入 8.5/14），与分段按钮同节奏 */
              '&.MuiInputBase-sizeSmall': {
                height: small.height,
                minHeight: small.height,
                '& .MuiOutlinedInput-input': {
                  padding: `${small.outlined.paddingBlock}px ${small.outlined.paddingInline}px`,
                },
              },
              '& .MuiOutlinedInput-input': {
                fontSize: md3Geometry.type.bodyLarge.fontSize,
                fontWeight: md3Geometry.type.bodyLarge.fontWeight,
                lineHeight: md3Geometry.type.bodyLarge.lineHeight,
                letterSpacing: md3Geometry.type.bodyLarge.letterSpacing,
                // 16.5*2 + 1.4375em(23) = 56
                padding: `${md3Geometry.field.outlined.paddingBlock}px ${md3Geometry.field.outlined.paddingInline}px`,
              },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: palette.outline,
                borderWidth: md3Geometry.border.hairline,
              },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: palette.onSurface },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: palette.primary.main,
                borderWidth: md3Geometry.border.standard,
              },
            };
          },
        },
      },
      MuiFilledInput: {
        styleOverrides: {
          /* 外显几何：56 高 / 4 圆角（上）/ surfaceContainerHighest / 下划线 1px outline、聚焦 2px primary */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const small = md3Geometry.field.small;
            return {
              borderTopLeftRadius: md3Geometry.shape.xs,
              borderTopRightRadius: md3Geometry.shape.xs,
              height: md3Geometry.height.textField,
              minHeight: md3Geometry.height.textField,
              /* Autocomplete 多选 chips 换行时要允许按内容撑高，固定高度会吃掉第二行 chip */
              '&.MuiAutocomplete-inputRoot': {
                height: 'auto',
                '&.MuiInputBase-sizeSmall': {
                  height: 'auto',
                  minHeight: md3Geometry.field.small.heightWithLabel,
                  /* hidden / with-label 的最小档都是 44（选中值少时整行聚拢，2+ chips 才撑高） */
                  '&.MuiInputBase-hiddenLabel': { height: 'auto', minHeight: md3Geometry.field.small.height },
                },
              },
              '&.MuiFilledInput-multiline': { height: 'auto' },
              /* 无 label（hiddenLabel）的正常尺寸：对称内边距，文字垂直居中在 56px 盒里 */
              '&.MuiInputBase-hiddenLabel:not(.MuiInputBase-sizeSmall) .MuiFilledInput-input': {
                paddingBlock: md3Geometry.field.outlined.paddingBlock,
              },
              /* size=small：带 label 48（label 上浮要空间）；hiddenLabel 40，与密集工具行同节奏 */
              '&.MuiInputBase-sizeSmall': {
                height: small.heightWithLabel,
                minHeight: small.heightWithLabel,
                '&.MuiInputBase-hiddenLabel': {
                  height: small.height,
                  minHeight: small.height,
                  '& .MuiFilledInput-input': {
                    padding: `${small.filled.hidden.paddingTop}px ${small.filled.hidden.paddingInline}px ${small.filled.hidden.paddingBottom}px`,
                  },
                },
                '&:not(.MuiInputBase-hiddenLabel) .MuiFilledInput-input': {
                  padding: `${small.filled.withLabel.paddingTop}px ${small.filled.withLabel.paddingInline}px ${small.filled.withLabel.paddingBottom}px`,
                },
              },
              backgroundColor: palette.surfaceContainerHighest,
              '& .MuiFilledInput-input': {
                fontSize: md3Geometry.type.bodyLarge.fontSize,
                fontWeight: md3Geometry.type.bodyLarge.fontWeight,
                lineHeight: md3Geometry.type.bodyLarge.lineHeight,
                letterSpacing: md3Geometry.type.bodyLarge.letterSpacing,
                // 25 + 8 + 1.4375em(23) = 56
                padding: `${md3Geometry.field.filled.paddingTop}px ${md3Geometry.field.filled.paddingInline}px ${md3Geometry.field.filled.paddingBottom}px`,
              },
              '&:hover': { backgroundColor: stateLayer(palette.onSurface, md3Tokens.stateLayer.hover, palette.surfaceContainerHighest) },
              '&.Mui-focused': { backgroundColor: palette.surfaceContainerHighest },
              /* MD3 filled text field：静止 1px onSurfaceVariant / 悬停 onSurface / 聚焦 2px primary */
              '&::before': { borderBottomColor: palette.onSurfaceVariant },
              '&:hover:not(.Mui-focused)::before': { borderBottomColor: palette.onSurface },
              '&::after': { borderBottomColor: palette.primary.main },
            };
          },
        },
      },

      /* ------------------------------------------------------------------- Card */
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: {
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderRadius: md3Geometry.shape.md,
              borderColor: palette.outlineVariant,
              backgroundImage: 'none',
              backgroundColor: palette.surfaceContainerLow,
              transition: theme.transitions.create(['box-shadow', 'background-color'], {
                duration: theme.transitions.duration.shortest,
              }),
              '&:hover': { boxShadow: md3Tokens.elevation.level1 },
            };
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: md3Geometry.space.x4,
            '&:last-child': { paddingBottom: md3Geometry.space.x4 },
          },
        },
      },

      /* ----------------------------------------------------------------- Dialog */
      MuiDialog: {
        styleOverrides: {
          /* 外显几何：28 圆角 / 内边距 24 / min-width 280 / max-width 560 */
          paper: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderRadius: md3Geometry.shape.xl,
              minWidth: md3Geometry.width.dialogMin,
              maxWidth: md3Geometry.width.dialogMax,
              backgroundColor: palette.surfaceContainerHigh,
              backgroundImage: 'none',
            };
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            padding: md3Geometry.space.x6,
            fontSize: md3Geometry.type.headlineSmall.fontSize,
            fontWeight: md3Geometry.type.headlineSmall.fontWeight,
            lineHeight: md3Geometry.type.headlineSmall.lineHeight,
            letterSpacing: md3Geometry.type.headlineSmall.letterSpacing,
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              paddingLeft: md3Geometry.space.x6,
              paddingRight: md3Geometry.space.x6,
              paddingBottom: md3Geometry.space.x6,
              '&.MuiDialogContent-dividers': {
                padding: `${md3Geometry.space.x4}px ${md3Geometry.space.x6}px`,
                borderColor: palette.outlineVariant,
              },
            };
          },
        },
      },
      MuiDialogActions: {
        styleOverrides: {
          root: {
            padding: md3Geometry.space.x6,
            gap: md3Geometry.space.x2,
          },
        },
      },

      /* ------------------------------------------------------------- Menu / Item */
      MuiMenu: {
        styleOverrides: {
          /* 外显几何：菜单上下 padding 8/0；paper 4 圆角；容器 MD3 spec = surfaceContainer */
          paper: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderRadius: md3Geometry.shape.sm,
              backgroundColor: palette.surfaceContainer,
              backgroundImage: 'none',
              boxShadow: md3Tokens.elevation.level2,
            };
          },
          list: {
            padding: `${md3Geometry.space.x2}px ${md3Geometry.space.x0}px`,
            /**
             * 全局 MuiListItemIcon 的 56minWidth（为导航行设计）不能渗进菜单：
             * MD3 菜单前置图标 20 + 12 间距。选择器更长，可压过全局覆盖。
             */
            '& .MuiListItemIcon-root': {
              minWidth: md3Geometry.icon.md + md3Geometry.space.x3,
              justifyContent: 'flex-start',
            },
            '& .MuiListItemIcon-root svg': { fontSize: md3Geometry.icon.md },
          },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          /* 项高 48 / 8 圆角（与 paper 8 一致）/ 16、400 */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const body = md3Geometry.type.bodyLarge;
            return {
              minHeight: md3Geometry.height.menuItem,
              // MUI 在 ≥sm 会把非 dense 菜单项改成 `min-height: auto`，这里压回 48
              [theme.breakpoints.up('sm')]: { minHeight: md3Geometry.height.menuItem },
              paddingBlock: 0,
              paddingInline: md3Geometry.space.x3,
              borderRadius: md3Geometry.shape.sm,
              fontSize: body.fontSize,
              fontWeight: body.fontWeight,
              lineHeight: body.lineHeight,
              letterSpacing: body.letterSpacing,
              '& .MuiListItemText-root': { marginBlock: 0 },
              '&:hover': { backgroundColor: stateLayer(palette.text.primary, md3Tokens.stateLayer.hover) },
              '&.Mui-selected': {
                backgroundColor: palette.secondaryContainer,
                color: palette.onSecondaryContainer,
              },
              '&.Mui-selected:hover': {
                backgroundColor: stateLayer(palette.onSecondaryContainer, md3Tokens.stateLayer.hover, palette.secondaryContainer),
              },
            };
          },
        },
      },

      /* ------------------------------------------------------------ List items */
      MuiListItemButton: {
        styleOverrides: {
          /**
           * 外显几何：单行 56 / 双行 72 / 行本身不圆（0）/ 水平内边距 16。
           * 选中态是内嵌 56×32 胶囊（secondaryContainer + full 圆角），
           * 用 `::before` 实现，不改 DOM；`& > *` 抬到胶囊之上。
           */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              minHeight: md3Geometry.height.listItem,
              height: md3Geometry.height.listItem,
              borderRadius: md3Geometry.shape.none,
              paddingInline: md3Geometry.space.x4,
              paddingBlock: 0,
              transition: theme.transitions.create(['background-color', 'color'], {
                duration: theme.transitions.duration.shortest,
              }),
              '&.MuiListItemButton-alignItemsFlexStart': {
                height: 'auto',
                minHeight: md3Geometry.height.listItemTwoLine,
              },
              '&:hover': { backgroundColor: stateLayer(palette.text.primary, md3Tokens.stateLayer.hover) },
              '&.Mui-focusVisible': { backgroundColor: stateLayer(palette.text.primary, md3Tokens.stateLayer.focus) },
              '&.Mui-selected': {
                backgroundColor: 'transparent',
                color: palette.onSecondaryContainer,
                '&:hover': { backgroundColor: 'transparent' },
                /**
                 * 选中指示器：整行 56px 高 stadium 胶囊（secondaryContainer），左右内缩 12 —
                 * 这是 MD3 展开态 navigation drawer 的 destination 形态。
                 * 收起态 navigation rail 居中 56×32 小胶囊由 Layout 按上下文覆盖（那里才知道 rail 是收起还是展开）。
                 */
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  insetBlock: 0,
                  insetInlineStart: md3Geometry.space.x3,
                  insetInlineEnd: md3Geometry.space.x3,
                  borderRadius: md3Geometry.shape.full,
                  backgroundColor: palette.secondaryContainer,
                },
                '&:hover::before': {
                  backgroundColor: stateLayer(palette.onSecondaryContainer, md3Tokens.stateLayer.hover, palette.secondaryContainer),
                },
                '& > *': { position: 'relative' },
              },
            };
          },
        },
      },
      MuiListItemIcon: {
        styleOverrides: {
          root: {
            minWidth: md3Geometry.width.navIndicator,
            justifyContent: 'center',
          },
        },
      },
      MuiListItemText: {
        styleOverrides: {
          primary: {
            fontSize: md3Geometry.type.bodyLarge.fontSize,
            fontWeight: md3Geometry.type.bodyLarge.fontWeight,
            lineHeight: md3Geometry.type.bodyLarge.lineHeight,
            letterSpacing: md3Geometry.type.bodyLarge.letterSpacing,
          },
          secondary: {
            marginTop: 0,
            fontSize: md3Geometry.type.bodyMedium.fontSize,
            fontWeight: md3Geometry.type.bodyMedium.fontWeight,
            lineHeight: md3Geometry.type.bodyMedium.lineHeight,
            letterSpacing: md3Geometry.type.bodyMedium.letterSpacing,
          },
        },
      },

      /* --------------------------------------------------------- AppBar/Drawer */
      MuiAppBar: {
        defaultProps: { elevation: 0, color: 'default' },
        styleOverrides: {
          /* 外显几何：64 高 / 0 圆角 / 底色 surface / 静止无阴影 */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              minHeight: md3Geometry.height.appBar,
              height: md3Geometry.height.appBar,
              borderRadius: md3Geometry.shape.none,
              backgroundColor: palette.surface,
              backgroundImage: 'none',
              color: palette.text.primary,
              boxShadow: 'none',
              borderBottom: `${md3Geometry.border.hairline}px solid ${palette.outlineVariant}`,
              /**
               * MUI 默认的 AppBar 在 dark scheme 下会改走 `--mui-palette-AppBar-darkBg`
               * （可能接近纯黑）。这里显式压回 surface，保证浅/深色都是 surface 角色。
               */
              '[data-mui-color-scheme="dark"] &': {
                backgroundColor: palette.surface,
                color: palette.text.primary,
                backgroundImage: 'none',
              },
            };
          },
        },
      },
      MuiToolbar: {
        styleOverrides: {
          root: { minHeight: md3Geometry.height.appBar },
          regular: { minHeight: md3Geometry.height.appBar },
          gutters: ({ theme }) => ({
            paddingInline: md3Geometry.space.x4,
            [theme.breakpoints.up('sm')]: { paddingInline: md3Geometry.space.x4 },
          }),
        },
      },
      MuiDrawer: {
        styleOverrides: {
          /* MD3 modal navigation drawer 容器 = surfaceContainerLow（spec）；
             Layout 的常驻 rail 仍以 surface 为底（nav rail spec），那里自带内联覆盖。 */
          paper: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              border: 'none',
              backgroundImage: 'none',
              backgroundColor: palette.surfaceContainerLow,
            };
          },
        },
      },

      /* ----------------------------------------------------------------- Switch */
      MuiSwitch: {
        styleOverrides: {
          /* 外显几何：52 宽 × 32 高 / track full 圆角；未选中 thumb 16 实心 outline，选中 thumb 24 onPrimary */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              width: md3Geometry.width.switchTrack,
              height: md3Geometry.height.switchTrack,
              padding: 0,
              '& .MuiSwitch-track': {
                borderRadius: md3Geometry.shape.full,
                opacity: 1,
                backgroundColor: palette.surfaceContainerHighest,
                border: `${md3Geometry.border.standard}px solid ${palette.outline}`,
                boxSizing: 'border-box',
                zIndex: 0,
              },
              '& .MuiSwitch-switchBase': {
                width: md3Geometry.height.switchTrack,
                height: md3Geometry.height.switchTrack,
                padding: (md3Geometry.height.switchTrack - md3Geometry.height.switchThumbOn) / 2,
                '& .MuiSwitch-thumb': {
                  width: md3Geometry.height.switchThumbOff,
                  height: md3Geometry.height.switchThumbOff,
                  /* MD3 unchecked thumb uses solid outline. */
                  backgroundColor: palette.outline,
                  boxShadow: 'none',
                  transition: theme.transitions.create(['width', 'height', 'background-color'], {
                    duration: theme.transitions.duration.shortest,
                  }),
                },
                '&.Mui-checked': {
                  transform: `translateX(${md3Geometry.width.switchTrack - md3Geometry.height.switchTrack}px)`,
                  '& .MuiSwitch-thumb': {
                    width: md3Geometry.height.switchThumbOn,
                    height: md3Geometry.height.switchThumbOn,
                    backgroundColor: palette.onPrimary,
                  },
                  '& + .MuiSwitch-track': {
                    backgroundColor: palette.primary.main,
                    borderColor: 'transparent',
                    opacity: 1,
                  },
                },
              },
            };
          },
        },
      },

      /* ------------------------------------------------------------------- Tabs */
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: md3Geometry.height.tab },
          indicator: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              height: md3Geometry.height.tabIndicator,
              backgroundColor: palette.primary.main,
              borderTopLeftRadius: md3Geometry.shape.full,
              borderTopRightRadius: md3Geometry.shape.full,
            };
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          /* 外显几何：48 高；label titleSmall 14/500 */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const label = md3Geometry.type.titleSmall;
            return {
              minHeight: md3Geometry.height.tab,
              textTransform: 'none',
              fontSize: label.fontSize,
              fontWeight: label.fontWeight,
              lineHeight: label.lineHeight,
              letterSpacing: label.letterSpacing,
              borderRadius: md3Geometry.shape.full,
              '&:hover': { backgroundColor: stateLayer(palette.primary.main, md3Tokens.stateLayer.hover) },
            };
          },
        },
      },

      /* ---------------------------------------------------------------- Tooltip */
      MuiTooltip: {
        styleOverrides: {
          tooltip: ({ theme }) => {
            const { palette } = themeVars(theme);
            const label = md3Geometry.type.labelSmall;
            return {
              borderRadius: md3Geometry.shape.xs,
              padding: `${md3Geometry.space.x1}px ${md3Geometry.space.x2}px`,
              backgroundColor: palette.inverseSurface,
              color: palette.inverseOnSurface,
              fontSize: label.fontSize,
              fontWeight: label.fontWeight,
              lineHeight: label.lineHeight,
              letterSpacing: label.letterSpacing,
              maxWidth: md3Geometry.size.tooltipMaxWidth,
            };
          },
          arrow: ({ theme }) => ({ color: themeVars(theme).palette.inverseSurface }),
        },
      },

      /* ------------------------------------------------------ Snackbar / Divider */
      MuiSnackbarContent: {
        styleOverrides: {
          /* 外显几何：min 48 高 / 4 圆角 / 内边距 0/16 / bodyMedium */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            const body = md3Geometry.type.bodyMedium;
            return {
              minHeight: md3Geometry.height.snackbar,
              borderRadius: md3Geometry.shape.xs,
              padding: `${md3Geometry.space.x0}px ${md3Geometry.space.x4}px`,
              backgroundColor: palette.inverseSurface,
              color: palette.inverseOnSurface,
              fontSize: body.fontSize,
              fontWeight: body.fontWeight,
              lineHeight: body.lineHeight,
              letterSpacing: body.letterSpacing,
            };
          },
        },
      },
      MuiDivider: {
        styleOverrides: {
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderColor: palette.outlineVariant,
              borderBottomWidth: md3Geometry.height.divider,
            };
          },
          vertical: {
            borderBottomWidth: 0,
            borderRightWidth: md3Geometry.height.divider,
          },
        },
      },

      /* ------------------------------------------------------- FormControlLabel */
      MuiFormControlLabel: {
        styleOverrides: {
          /* MUI 默认 marginLeft -11px 是为 Checkbox 的触控对齐设计的；带 Switch 时会
             把轨道前半段叠压到前一个控件上。只对 Switch 标签行归零。 */
          root: {
            '&:has(.MuiSwitch-root)': { marginLeft: 0 },
          },
        },
      },

      /* --------------------------------------------- Checkbox / Radio / Slider */
      MuiCheckbox: {
        styleOverrides: {
          /**
           * 外显几何：18×18 框 / 2px 描边 onSurfaceVariant / 2 圆角 / 触控区 40。
           * MUI 原生图标在 fontSize=24 时绘制的方框正是 18×18、描边 2px、圆角 2
           * （CheckBoxOutlineBlank 路径 3→21），因此这里把图标锁在 24 并删掉
           * size 变体带来的 20px；触控区 = 24 + padding 8×2 = 40。
           */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              padding: (md3Geometry.height.touchTarget - md3Geometry.icon.lg) / 2,
              color: palette.onSurfaceVariant,
              '& .MuiSvgIcon-root': { fontSize: md3Geometry.icon.lg },
              '&.Mui-checked, &.MuiCheckbox-indeterminate': { color: palette.primary.main },
            };
          },
        },
      },
      MuiRadio: {
        styleOverrides: {
          /**
           * 外显几何：外圈 20 / 内点 10 / full 圆角。
           * 同样利用原生图标几何：fontSize=24 时 RadioButtonChecked 外圈直径 20、内点 10。
           */
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              padding: (md3Geometry.height.touchTarget - md3Geometry.icon.lg) / 2,
              color: palette.onSurfaceVariant,
              '& .MuiSvgIcon-root': { fontSize: md3Geometry.icon.lg },
              '&.Mui-checked': { color: palette.primary.main },
            };
          },
        },
      },
      MuiSlider: {
        styleOverrides: {
          /* 外显几何：轨道 4 / 手柄 20 */
          rail: ({ theme }) => ({
            height: md3Geometry.height.sliderTrack,
            backgroundColor: themeVars(theme).palette.surfaceContainerHighest,
            opacity: 1,
          }),
          track: ({ theme }) => ({
            height: md3Geometry.height.sliderTrack,
            border: 'none',
            backgroundColor: themeVars(theme).palette.primary.main,
          }),
          thumb: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              width: md3Geometry.width.sliderThumb,
              height: md3Geometry.width.sliderThumb,
              '&::before': { boxShadow: 'none' },
              '&:hover, &.Mui-focusVisible': { boxShadow: `0 0 0 ${md3Geometry.space.x1}px ${stateLayer(palette.primary.main, md3Tokens.stateLayer.hover)}` },
            };
          },
        },
      },

      /* -------------------------------------------------------- LinearProgress */
      MuiLinearProgress: {
        styleOverrides: {
          /* 外显几何：轨道 4 / full 圆角 */
          root: {
            height: md3Geometry.height.linearProgress,
            borderRadius: md3Geometry.shape.full,
          },
          bar1: { borderRadius: 'inherit' },
          bar2: { borderRadius: 'inherit' },
        },
      },

      /* ----------------------------------------- 规范表外、但保留的既有覆盖项 */
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: md3Geometry.shape.md },
          elevation1: { boxShadow: md3Tokens.elevation.level1 },
          elevation2: { boxShadow: md3Tokens.elevation.level2 },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderRadius: md3Geometry.shape.md,
              border: `${md3Geometry.border.hairline}px solid ${palette.outlineVariant}`,
            };
          },
        },
      },
      MuiSkeleton: {
        styleOverrides: { rounded: { borderRadius: md3Geometry.shape.sm } },
      },
      MuiTableCell: {
        styleOverrides: { root: { borderBottomColor: 'var(--mui-palette-outlineVariant)' } },
      },
      MuiAvatar: {
        styleOverrides: {
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return { backgroundColor: palette.primaryContainer, color: palette.onPrimaryContainer };
          },
        },
      },
      MuiAccordion: {
        styleOverrides: {
          root: ({ theme }) => {
            const { palette } = themeVars(theme);
            return {
              borderRadius: `${md3Geometry.shape.md}px !important`,
              border: `${md3Geometry.border.hairline}px solid ${palette.outlineVariant}`,
              backgroundImage: 'none',
              '&:before': { display: 'none' },
            };
          },
        },
      },
    },
  };

  const theme = createTheme(themeOptions) as AppTheme;
  return Object.assign(theme, { md3: md3Tokens });
}

/** 主题模式判定工具（供 Provider / 表单复用）。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

export { normalizeHex };
export type { TonalScheme };
export * from './tonal';
