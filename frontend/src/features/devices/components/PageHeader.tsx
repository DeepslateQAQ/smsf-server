import { Box, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** 页面级标题栏：标题 + 副标题 + 右侧操作区。 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      alignItems={{ xs: 'flex-start', sm: 'flex-start' }}
      justifyContent="space-between"
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="headlineSmall" component="h1">
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="bodyMedium" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {actions ? <Box sx={{ flexShrink: 0 }}>{actions}</Box> : null}
    </Stack>
  );
}
