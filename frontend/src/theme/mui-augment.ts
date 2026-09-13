/**
 * MUI 类型扩展：MD3 typography 变体、MD3 palette token、`theme.md3`。
 * 由 `src/theme/index.ts` 引入，保证全项目（含功能页面）可见。
 */

import type { Theme } from '@mui/material/styles';
import type { CSSProperties } from 'react';

import type { md3Tokens } from './index';

type Md3Tokens = typeof md3Tokens;

declare module '@mui/material/styles' {
  interface TypographyVariants {
    displayLarge: CSSProperties;
    displayMedium: CSSProperties;
    displaySmall: CSSProperties;
    headlineLarge: CSSProperties;
    headlineMedium: CSSProperties;
    headlineSmall: CSSProperties;
    titleLarge: CSSProperties;
    titleMedium: CSSProperties;
    titleSmall: CSSProperties;
    bodyLarge: CSSProperties;
    bodyMedium: CSSProperties;
    bodySmall: CSSProperties;
    labelLarge: CSSProperties;
    labelMedium: CSSProperties;
    labelSmall: CSSProperties;
  }

  interface TypographyVariantsOptions {
    displayLarge?: CSSProperties;
    displayMedium?: CSSProperties;
    displaySmall?: CSSProperties;
    headlineLarge?: CSSProperties;
    headlineMedium?: CSSProperties;
    headlineSmall?: CSSProperties;
    titleLarge?: CSSProperties;
    titleMedium?: CSSProperties;
    titleSmall?: CSSProperties;
    bodyLarge?: CSSProperties;
    bodyMedium?: CSSProperties;
    bodySmall?: CSSProperties;
    labelLarge?: CSSProperties;
    labelMedium?: CSSProperties;
    labelSmall?: CSSProperties;
  }

  interface Palette {
    onPrimary: string;
    onSecondary: string;
    onError: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    secondaryContainer: string;
    onSecondaryContainer: string;
    tertiary: string;
    onTertiary: string;
    tertiaryContainer: string;
    onTertiaryContainer: string;
    errorContainer: string;
    onErrorContainer: string;
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
    outline: string;
    outlineVariant: string;
    inverseSurface: string;
    inverseOnSurface: string;
    inversePrimary: string;
    scrim: string;
    shadow: string;
    surfaceTint: string;
  }

  interface PaletteOptions {
    onPrimary?: string;
    onSecondary?: string;
    onError?: string;
    primaryContainer?: string;
    onPrimaryContainer?: string;
    secondaryContainer?: string;
    onSecondaryContainer?: string;
    tertiary?: string;
    onTertiary?: string;
    tertiaryContainer?: string;
    onTertiaryContainer?: string;
    errorContainer?: string;
    onErrorContainer?: string;
    successContainer?: string;
    onSuccessContainer?: string;
    surface?: string;
    onSurface?: string;
    surfaceVariant?: string;
    onSurfaceVariant?: string;
    surfaceContainerLowest?: string;
    surfaceContainerLow?: string;
    surfaceContainer?: string;
    surfaceContainerHigh?: string;
    surfaceContainerHighest?: string;
    outline?: string;
    outlineVariant?: string;
    inverseSurface?: string;
    inverseOnSurface?: string;
    inversePrimary?: string;
    scrim?: string;
    shadow?: string;
    surfaceTint?: string;
  }

  interface Theme {
    /** MD3 圆角 / state layer / elevation token */
    md3: Md3Tokens;
  }

  interface ThemeOptions {
    md3?: Md3Tokens;
  }

  interface BaseTheme {
    md3: Md3Tokens;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    displayLarge: true;
    displayMedium: true;
    displaySmall: true;
    headlineLarge: true;
    headlineMedium: true;
    headlineSmall: true;
    titleLarge: true;
    titleMedium: true;
    titleSmall: true;
    bodyLarge: true;
    bodyMedium: true;
    bodySmall: true;
    labelLarge: true;
    labelMedium: true;
    labelSmall: true;
  }
}

export type { Md3Tokens };
export type { Theme };
