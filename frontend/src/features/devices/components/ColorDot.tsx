import { Box, type SxProps, type Theme } from '@mui/material';

export interface ColorDotProps {
  color: string;
  size?: number;
  sx?: SxProps<Theme>;
}

/** 设备标识色圆点；颜色为空时退回中性灰。 */
export default function ColorDot({ color, size = 12, sx }: ColorDotProps) {
  const resolved = color && color.trim() ? color : 'grey.400';
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        display: 'inline-block',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: resolved,
        boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
        ...sx,
      }}
    />
  );
}
