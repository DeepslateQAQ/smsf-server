/**
 * 列表容器：骨架屏 / 空态 / 错误提示（ApiError.detail 原样展示）/ 列表 / 加载更多。
 */

import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import { Alert, Box, Button, CircularProgress, Skeleton, Stack, Typography } from '@mui/material';

import { describeError } from '@/components/LoadingBoundary';
import EmptyState from '@/components/EmptyState';
import { isApiError } from '@/api/client';
import type { MessageOut } from '@/api/types';

import type { Density } from '../density';
import { useMessagesT } from '../locales';
import { ROW_MIN_HEIGHT } from '../styles';
import MessageRow from './MessageRow';

export interface MessageListProps {
  items: MessageOut[];
  density: Density;
  keyword?: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  hasNextPage: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onDelete: (message: MessageOut) => void;
  sharedDeviceIds: ReadonlySet<number>;
  deviceOwners: ReadonlyMap<number, string>;
  filtered: boolean;
  onClearFilters: () => void;
}

export default function MessageList({
  items,
  density,
  keyword,
  loading,
  error,
  onRetry,
  hasNextPage,
  loadingMore,
  onLoadMore,
  onDelete,
  sharedDeviceIds,
  deviceOwners,
  filtered,
  onClearFilters,
}: MessageListProps) {
  const t = useMessagesT();

  if (loading && items.length === 0) {
    return (
      <Stack spacing={0} sx={{ py: 1 }} data-testid="messages-skeleton">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton
            key={index}
            variant="rounded"
            height={ROW_MIN_HEIGHT[density]}
            sx={{ my: 0.5 }}
          />
        ))}
      </Stack>
    );
  }

  if (error) {
    // 直接把 ApiError.detail 展示出来（其余错误走统一描述）
    const text = isApiError(error) && error.detail ? error.detail : describeError(error, t);
    return (
      <Box sx={{ py: 3 }}>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          }
        >
          {text}
        </Alert>
      </Box>
    );
  }

  if (items.length === 0) {
    return filtered ? (
      <EmptyState
        icon={<SearchOffOutlinedIcon />}
        title={t('messages.emptyFiltered')}
        description={t('messages.emptyFilteredHint')}
        action={
          <Button variant="outlined" onClick={onClearFilters}>
            {t('common.reset')}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<InboxOutlinedIcon />}
        title={t('messages.empty')}
        description={t('messages.emptyHint')}
      />
    );
  }

  return (
    <Box>
      <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        {items.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            density={density}
            keyword={keyword}
            shared={sharedDeviceIds.has(message.device_id)}
            ownerName={deviceOwners.get(message.device_id)}
            onDelete={onDelete}
          />
        ))}
      </Box>

      <Stack alignItems="center" spacing={1} sx={{ py: 2 }}>
        {hasNextPage ? (
          <Button variant="outlined" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <CircularProgress size={16} color="inherit" sx={{ mr: 1 }} />
                {t('messages.loadingMore')}
              </>
            ) : (
              t('messages.loadMore')
            )}
          </Button>
        ) : (
          <Typography variant="bodySmall" color="text.disabled">
            {t('messages.noMore')}
          </Typography>
        )}
        <Typography variant="bodySmall" color="text.disabled">
          {t('messages.total', { count: items.length })}
        </Typography>
      </Stack>
    </Box>
  );
}
