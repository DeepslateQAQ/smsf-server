/**
 * 消息列表页（默认导出）。
 *
 * - 列表：桌面单行紧凑（时间 | 设备 chip | 发件人 | 正文摘要 | 右侧大字验证码），
 *   窄屏卡片堆叠；密度（紧凑/舒适）存 localStorage；摘要里高亮关键词与验证码数字。
 * - 筛选：全部状态同步进 URL query（见 `filters.ts` 顶部的参数名清单），刷新/分享可复现。
 * - 分页：`useInfiniteQuery` 游标 + 「加载更多」，用「开始/结束日期」限定区间。
 * - 操作：单条删除（共享设备额外警告）、一键清理、CSV/JSON 导出。
 * - 实时：`useEventStream` 收到事件即失效消息与 facets；断线退避重连；
 *   另有 60s 兜底轮询（页面不可见时暂停）。
 */

import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DensityLargeOutlinedIcon from '@mui/icons-material/DensityLargeOutlined';
import DensitySmallOutlinedIcon from '@mui/icons-material/DensitySmallOutlined';
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  Snackbar,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { isApiError } from '@/api/client';
import type { DeviceOut, MessageOut } from '@/api/types';
import { describeError } from '@/components/LoadingBoundary';
import ConfirmDialog from '@/components/ConfirmDialog';

import {
  activeFilterCount,
  buildSearchParams,
  parseFilters,
  toApiQuery,
  type MessagesUrlState,
} from './filters';
import { invalidateMessageQueries, useDeleteMessage, useFacets, useMessageDevices, useMessagesInfinite } from './api';
import { useEventStream, useVisibilityInterval } from './useEventStream';
import { useDensity } from './density';
import { useMessagesT } from './locales';
import DatePickersProvider from './components/DatePickersProvider';
import ExportMenu from './components/ExportMenu';
import FiltersBar from './components/FiltersBar';
import MessageList from './components/MessageList';
import PurgeDialog from './components/PurgeDialog';

const FALLBACK_POLL_MS = 60_000;

export default function MessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const t = useMessagesT();
  const [density, setDensity] = useDensity();
  const queryClient = useQueryClient();

  const commit = useCallback(
    (patch: Partial<MessagesUrlState>, options?: { replace?: boolean }) => {
      setSearchParams((prev) => buildSearchParams({ ...parseFilters(prev), ...patch }), {
        replace: options?.replace ?? false,
      });
    },
    [setSearchParams],
  );

  const commitKeyword = useCallback(
    (value: string) => {
      setSearchParams((prev) => buildSearchParams({ ...parseFilters(prev), q: value || undefined }), {
        replace: true,
      });
    },
    [setSearchParams],
  );

  const clearAll = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: false });
    setFilterResetToken((token) => token + 1);
  }, [setSearchParams]);

  const listQuery = useMemo(() => toApiQuery(filters), [filters]);
  const exportQuery = useMemo(() => toApiQuery(filters, { limit: null }), [filters]);
  /* 交叉维面（cross-faceted）：设备选项在「去掉自身筛选」的上下文里计算，
     否则选中某台设备后其他设备会从下拉里消失（发件人同理）。 */
  const deviceFacetQuery = useMemo(() => toApiQuery({ ...filters, deviceIds: [] }, { limit: null }), [filters]);
  const senderFacetQuery = useMemo(() => toApiQuery({ ...filters, senders: [] }, { limit: null }), [filters]);

  const messagesResult = useMessagesInfinite(listQuery);
  const deviceFacetsResult = useFacets(deviceFacetQuery);
  const senderFacetsResult = useFacets(senderFacetQuery);
  const devicesResult = useMessageDevices();
  const deleteMessage = useDeleteMessage();

  // ---- 实时：SSE + 60s 兜底轮询（不可见时暂停）
  const invalidate = useCallback(() => {
    invalidateMessageQueries(queryClient);
  }, [queryClient]);
  const stream = useEventStream({ onEvent: invalidate });
  useVisibilityInterval(invalidate, FALLBACK_POLL_MS);

  const items = useMemo(
    () => (messagesResult.data?.pages ?? []).flatMap((page) => page.items),
    [messagesResult.data],
  );

  // useMessageDevices 的 queryFn 已返回规范化后的 DeviceOut[]，无需再做守卫。
  const devices = useMemo<DeviceOut[]>(() => devicesResult.data ?? [], [devicesResult.data]);
  const sharedDeviceIds = useMemo(
    () => new Set(devices.filter((device) => !device.is_owner).map((device) => device.id)),
    [devices],
  );
  const deviceOwners = useMemo(
    () => new Map(devices.map((device) => [device.id, device.owner_name])),
    [devices],
  );
  const ownedDeviceIds = useMemo(
    () => devices.filter((device) => device.is_owner).map((device) => device.id),
    [devices],
  );

  // ---- 单条删除
  const [pendingDelete, setPendingDelete] = useState<MessageOut | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [filterResetToken, setFilterResetToken] = useState(0);

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await deleteMessage.mutateAsync(pendingDelete.id);
      setPendingDelete(null);
      setSnack(t('messages.deleted'));
    } catch (error) {
      setDeleteError(isApiError(error) && error.detail ? error.detail : describeError(error, t));
    }
  }, [deleteMessage, pendingDelete, t]);

  const pendingShared = pendingDelete ? sharedDeviceIds.has(pendingDelete.device_id) : false;
  const pendingOwner = pendingDelete ? deviceOwners.get(pendingDelete.device_id) : undefined;

  const filtered = activeFilterCount(filters) > 0;

  return (
    <DatePickersProvider>
      <Stack
        spacing={2}
        sx={{
          p: { xs: 1.5, md: 3 },
          mx: 'auto',
          width: '100%',
          /* 移动端右下有悬浮 FAB（新建设备）：底部留出带 FAB 高度 + 偏移的呼吸位，避免盖住列表尾部 */
          pb: { xs: 11, md: 3 },
        }}
      >
        {/* 页头第一行：实时状态与操作。页面标题由顶栏 AppBar 承担，这里不再重复一份「消息」。 */}
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Tooltip title={stream.connected ? t('messages.liveConnected') : t('messages.liveOffline')}>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: 'text.secondary' }}>
              <Stack
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: stream.connected ? 'success.main' : 'text.disabled',
                }}
              />
              <Typography variant="labelSmall">
                {stream.connected ? t('messages.liveConnected') : t('messages.liveOffline')}
              </Typography>
            </Stack>
          </Tooltip>
          {!stream.connected && stream.retryCount > 0 ? (
            <Chip
              size="small"
              variant="outlined"
              label={t('messages.liveRetrying', { seconds: stream.nextRetrySeconds ?? 1 })}
            />
          ) : null}

          <Stack sx={{ flex: 1 }} />

          {/* 「跳到某年某月」属于时间筛选，移入筛选卡时间行；工具行只保留同档（40）的工具按钮 */}
          {/* 工具按钮捆成一组整行换行（窄屏落到独立一行右对齐），不再散落成锯齿 */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'nowrap', ml: { xs: 'auto' } }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={density}
              onChange={(_event, next: 'compact' | 'comfortable' | null) => {
                if (next) setDensity(next);
              }}
              aria-label={t('messages.density')}
            >
              <ToggleButton value="compact" aria-label={t('messages.densityCompact')}>
                <DensitySmallOutlinedIcon fontSize="small" />
              </ToggleButton>
              <ToggleButton value="comfortable" aria-label={t('messages.densityComfortable')}>
                <DensityLargeOutlinedIcon fontSize="small" />
              </ToggleButton>
            </ToggleButtonGroup>

            <ExportMenu query={exportQuery} />

            <Button
              size="small"
              variant="contained"
              color="error"
              startIcon={<DeleteSweepOutlinedIcon fontSize="small" />}
              onClick={() => setPurgeOpen(true)}
            >
              {t('messages.purge')}
            </Button>
          </Stack>
        </Stack>

        <Typography variant="bodyMedium" color="text.secondary">
          {t('messages.subtitle')}
        </Typography>

        <FiltersBar
          state={filters}
          onChange={commit}
          onKeyword={commitKeyword}
          onClearAll={clearAll}
          resetToken={filterResetToken}
          senderFacets={senderFacetsResult.data}
          deviceFacets={deviceFacetsResult.data}
          facetsLoading={senderFacetsResult.isFetching || deviceFacetsResult.isFetching}
          devices={devices}
        />

        {messagesResult.isFetching && !messagesResult.isPending ? <LinearProgress /> : null}

        <MessageList
          items={items}
          density={density}
          keyword={filters.q}
          loading={messagesResult.isPending}
          error={messagesResult.error}
          onRetry={() => void messagesResult.refetch()}
          hasNextPage={messagesResult.hasNextPage}
          loadingMore={messagesResult.isFetchingNextPage}
          onLoadMore={() => void messagesResult.fetchNextPage()}
          onDelete={setPendingDelete}
          sharedDeviceIds={sharedDeviceIds}
          deviceOwners={deviceOwners}
          filtered={filtered}
          onClearFilters={clearAll}
        />
      </Stack>

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        title={pendingShared ? t('messages.deleteSharedTitle') : t('messages.deleteTitle')}
        description={
          <Stack spacing={1.25}>
            {pendingShared ? (
              <Alert severity="warning">
                {t('messages.deleteSharedWarning')}
                {pendingOwner ? `（${t('messages.ownerLabel')}: ${pendingOwner}）` : ''}
              </Alert>
            ) : null}
            <span>
              {pendingShared
                ? t('messages.deleteSharedBody', {
                    device: pendingDelete?.device_name ?? '',
                    owner: pendingOwner ?? '',
                  })
                : t('messages.deleteOwnBody')}
            </span>
            {deleteError ? <Alert severity="error">{deleteError}</Alert> : null}
          </Stack>
        }
        confirmText={pendingShared ? t('messages.deleteSharedConfirm') : t('messages.deleteConfirm')}
        loading={deleteMessage.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => {
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />

      <PurgeDialog
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        ownedDeviceIds={ownedDeviceIds}
        filteredDeviceIds={filters.deviceIds}
      />

      <Snackbar
        open={snack !== null}
        autoHideDuration={2500}
        onClose={() => setSnack(null)}
        message={snack ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </DatePickersProvider>
  );
}
