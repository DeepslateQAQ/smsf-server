import { Box, Button, Stack, Typography } from '@mui/material';
import { useRouteError } from 'react-router';

import { useT } from '@/i18n';

/**
 * 路由级错误兜底：懒加载 chunk 失败、子路由渲染异常等。
 * 挂在 Layout 路由的 errorElement 上，出错时替换内容区并提供重试。
 */
export default function RouteError() {
  const t = useT();
  const error = useRouteError();
  let detail = '';
  if (error instanceof Error && error.message) {
    detail = error.message;
  } else if (typeof error === 'string') {
    detail = error;
  }

  return (
    <Box role="alert" sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', px: 2 }}>
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', maxWidth: 480 }}>
        <Typography variant="headlineSmall" component="h1">
          {t('common.error')}
        </Typography>
        {detail ? (
          <Typography variant="bodySmall" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
            {detail}
          </Typography>
        ) : null}
        <Button variant="contained" onClick={() => window.location.reload()}>
          {t('common.retry')}
        </Button>
      </Stack>
    </Box>
  );
}
