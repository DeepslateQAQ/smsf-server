import { Box, Stack, Typography, type SxProps, type Theme } from '@mui/material';
import type { ReactNode } from 'react';

import { md3Geometry, md3Tokens, stateLayer } from '@/theme';

/** EmptyState 局部布局常量：md3Geometry 没有与 64/32 对应的语义条目，按原视觉保留。 */
const ICON_BOX_SIZE = 64;
const ICON_FONT_SIZE = 32;

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  sx?: SxProps<Theme>;
}

export default function EmptyState({ title, description, icon, action, sx }: EmptyStateProps) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1.5}
      sx={{
        py: 8,
        px: 3,
        textAlign: 'center',
        color: 'text.secondary',
        ...sx,
      }}
    >
      {icon ? (
        <Box
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: ICON_BOX_SIZE,
            height: ICON_BOX_SIZE,
            borderRadius: md3Geometry.shape.xl,
            bgcolor: stateLayer('currentColor', md3Tokens.stateLayer.hover),
            '& svg': { fontSize: ICON_FONT_SIZE },
          }}
        >
          {icon}
        </Box>
      ) : null}
      <Typography variant="titleMedium" component="h3" sx={{ color: 'text.primary' }}>
        {title}
      </Typography>
      {description ? (
        <Typography variant="bodyMedium" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ pt: 1 }}>{action}</Box> : null}
    </Stack>
  );
}
