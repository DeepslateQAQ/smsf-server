/** messages 功能内的共享样式 token。 */

import type { SxProps, Theme } from '@mui/material/styles';

import { md3Geometry } from '@/theme';

import type { Density } from './density';

/** 验证码等宽字体栈。 */
export const MONO_FONT =
  '"JetBrains Mono", "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

/** 命中关键词 / 验证码数字的 `<mark>` 样式。 */
export const MARK_SX: SxProps<Theme> = {
  bgcolor: 'var(--mui-palette-tertiaryContainer)',
  color: 'var(--mui-palette-onTertiaryContainer)',
  borderRadius: md3Geometry.shape.xxs,
  px: `${md3Geometry.space.x1}px`,
  py: 0,
};

/**
 * 列表骨架/行的最小高度（随密度）。
 * 有码与无码行共用同一档，列表垂直节奏不再被验证码撑跳。
 */
export const ROW_MIN_HEIGHT: Record<Density, number> = {
  // 紧凑：单行 meta+正文（40 触控目标 + 上下呼吸 4）
  compact: md3Geometry.height.touchTarget + md3Geometry.space.x1,
  // 舒适：meta + 正文两行，对齐双行列表项 72
  comfortable: md3Geometry.height.listItemTwoLine,
};
