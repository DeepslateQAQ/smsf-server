import { Alert, Box, Button, Skeleton, Stack } from '@mui/material';
import type { ReactNode } from 'react';

import { useT } from '@/i18n';
import { md3Geometry } from '@/theme';

import { isApiError } from '@/api/client';

/** 加载骨架的页面布局常量（md3Geometry 中没有对应语义，保持 120 不变）。 */
const SKELETON_MIN_HEIGHT = 120;

export interface LoadingBoundaryProps {
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** 自定义骨架；默认渲染 3 条列表骨架 */
  skeleton?: ReactNode;
  minHeight?: number;
  children: ReactNode;
}

/** 把 `error` 翻译成用户可读文案（ApiError.detail 优先）。 */
export function describeError(error: unknown, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!error) return '';
  if (isApiError(error)) {
    if (error.status === 401) return t('errors.session_expired');
    if (error.status === 403) return t('errors.forbidden');
    if (error.status === 404) return t('errors.not_found');
    if (error.status === 422 || error.status === 400) return error.detail || t('errors.validation');
    if (error.status === 0) return t('errors.network');
    if (error.status >= 500) return error.detail || t('errors.generic');
    return error.detail || t('errors.generic');
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function LoadingBoundary({
  loading = false,
  error,
  onRetry,
  skeleton,
  minHeight = SKELETON_MIN_HEIGHT,
  children,
}: LoadingBoundaryProps) {
  const t = useT();

  if (error) {
    return (
      <Box sx={{ py: 4 }}>
        <Alert
          severity="error"
          action={
            onRetry ? (
              <Button color="inherit" size="small" onClick={onRetry}>
                {t('common.retry')}
              </Button>
            ) : undefined
          }
        >
          {describeError(error, t)}
        </Alert>
      </Box>
    );
  }

  if (loading) {
    if (skeleton) return <>{skeleton}</>;
    return (
      <Stack spacing={1.5} sx={{ minHeight, py: 2 }}>
        <Skeleton variant="rounded" height={md3Geometry.height.listItemTwoLine} />
        <Skeleton variant="rounded" height={md3Geometry.height.listItemTwoLine} />
        <Skeleton variant="rounded" height={md3Geometry.height.listItemTwoLine} />
      </Stack>
    );
  }

  return <>{children}</>;
}
