import { Avatar, Box, Card, Stack, Typography } from '@mui/material';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import type { ReactNode } from 'react';

import { useT } from '@/i18n';
import { md3Geometry, md3Tokens } from '@/theme';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
}

/** 登录/初始化/注册共用的居中卡片外壳（MD3 大圆角 + tonal 渐变背景）。 */
export default function AuthShell({ title, subtitle, children, footer, maxWidth = 460 }: AuthShellProps) {
  const t = useT();

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        px: 2,
        py: { xs: 4, md: 6 },
        background: (theme) => {
          const vars = (theme as unknown as { vars?: { palette: Record<string, string> } }).vars;
          const container = vars?.palette.primaryContainer ?? 'transparent';
          const surface = vars?.palette.surface ?? 'transparent';
          const tertiary = vars?.palette.tertiaryContainer ?? 'transparent';
          return `radial-gradient(1200px 600px at 15% -10%, ${container} 0%, ${surface} 55%), radial-gradient(900px 500px at 110% 110%, ${tertiary} 0%, ${surface} 60%), ${surface}`;
        },
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth,
          borderRadius: md3Geometry.shape.xl,
          p: { xs: 3, sm: 4 },
          backgroundColor: 'var(--mui-palette-surfaceContainerLow)',
          boxShadow: md3Tokens.elevation.level1,
        }}
      >
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center', mb: 3 }}>
          <Avatar
            sx={{
              width: md3Geometry.height.fab,
              height: md3Geometry.height.fab,
              borderRadius: md3Geometry.shape.lg,
              bgcolor: 'var(--mui-palette-primaryContainer)',
              color: 'var(--mui-palette-onPrimaryContainer)',
            }}
          >
            <SmsRoundedIcon />
          </Avatar>
          <Typography variant="titleLarge" component="h1">
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="bodyMedium" color="text.secondary">
              {subtitle}
            </Typography>
          ) : null}
          <Typography variant="labelSmall" color="text.secondary">
            {t('app.fullName')}
          </Typography>
        </Stack>
        {children}
        {footer ? <Box sx={{ mt: 3 }}>{footer}</Box> : null}
      </Card>
    </Box>
  );
}
