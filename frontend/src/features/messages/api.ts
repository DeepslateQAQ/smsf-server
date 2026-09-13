/**
 * messages 功能的查询 hooks：游标分页、facets、删除、一键清理、导出。
 *
 * queryKey 以 `['messages']` 为根，和 shell 的 `queryKeys.messages` / `messageFacets` 前缀一致，
 * 因此 SSE 事件与 60s 兜底轮询只要 invalidate `['messages']` 就能同时刷新列表与 facets。
 */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';

import { API_PREFIX, api, buildQueryString, type Query } from '@/api/client';
import { deviceKeys } from '@/features/devices/queries';
import type {
  DeleteResponse,
  DeviceOut,
  FacetsOut,
  MessagePage,
  PurgeRequest,
  PurgeResponse,
} from '@/api/types';

export const messagesKeys = {
  all: ['messages'] as const,
  list: (query: Query) => ['messages', 'list', query] as const,
  facets: (query: Query) => ['messages', 'facets', query] as const,
};

/** 失效「消息 + facets」（游标分页会重新从第一页拉取）。 */
export function invalidateMessageQueries(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: messagesKeys.all });
}

/** 游标分页：`data.pages` 里每页带 `next_cursor`。 */
export function useMessagesInfinite(query: Query) {
  return useInfiniteQuery({
    queryKey: messagesKeys.list(query),
    queryFn: ({ pageParam, signal }) =>
      api.get<MessagePage>('/messages', { ...query, cursor: pageParam ?? undefined }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** 发件人 / 设备候选（带计数），用于多选下拉。 */
export function useFacets(query: Query) {
  return useQuery({
    queryKey: messagesKeys.facets(query),
    queryFn: ({ signal }) => api.get<FacetsOut>('/messages/facets', query, { signal }),
    staleTime: 60_000,
  });
}

/**
 * 设备列表：用于判断某条消息是否落在「共享设备」上（删除时要额外警告）。
 * 与 devices 功能的 `useDevices` 共用同一条缓存（`deviceKeys.list()`），
 * 两边看到的数据始终一致。
 */
export function useMessageDevices() {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: () => api.get<DeviceOut[]>('/devices'),
    staleTime: 30_000,
  });
}

export function useDeleteMessage() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<DeleteResponse>(`/messages/${id}`),
    onSuccess: () => invalidateMessageQueries(client),
  });
}

export function usePurgeMessages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: PurgeRequest) => api.post<PurgeResponse>('/messages/purge', payload),
    onSuccess: () => invalidateMessageQueries(client),
  });
}

export type ExportFormat = 'csv' | 'json';

/** 导出 URL（直接指向 `/api/messages/export`，浏览器下载）。 */
export function buildExportUrl(query: Query, format: ExportFormat): string {
  const search = buildQueryString({ ...query, format });
  return `${API_PREFIX}/messages/export${search ? `?${search}` : ''}`;
}

/** 浏览器直接下载当前筛选结果（CSV / JSON）。 */
export function downloadMessagesExport(query: Query, format: ExportFormat): void {
  const anchor = document.createElement('a');
  anchor.href = buildExportUrl(query, format);
  anchor.download = `messages-${new Date().toISOString().slice(0, 10)}.${format}`;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
