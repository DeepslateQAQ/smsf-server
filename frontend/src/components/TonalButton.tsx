import { Button, type ButtonProps } from '@mui/material';
import { styled } from '@mui/material/styles';

import { md3Geometry, md3Tokens, stateLayer, themeVars } from '@/theme';

/**
 * MD3 tonal button：secondary container 底色 + on-container 文字。
 * 用法与 MUI `Button` 一致（`variant` 固定为 tonal 语义）。
 * 几何（40 高 / full 圆角 / labelLarge）由主题 `MuiButton` 覆盖提供，这里只补配色。
 */
const TonalButton = styled(Button)<ButtonProps>(({ theme }) => {
  const { palette } = themeVars(theme);
  const container = palette.secondaryContainer;
  const onContainer = palette.onSecondaryContainer;
  return {
    backgroundColor: container,
    color: onContainer,
    boxShadow: 'none',
    borderRadius: md3Geometry.shape.full,
    '&:hover': { backgroundColor: stateLayer(onContainer, md3Tokens.stateLayer.hover, container) },
    '&:disabled': { backgroundColor: theme.palette.action.disabledBackground },
  };
});

export default TonalButton;
