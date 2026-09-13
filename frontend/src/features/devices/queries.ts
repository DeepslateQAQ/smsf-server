/**
 * devices 的数据访问层：基于 `@/api/client` 的 TanStack Query 封装。
 *
 * 端点（全部挂在 `/api` 前缀下）：
 *   GET    /devices
 *   POST   /devices
 *   GET    /devices/{id}
 *   PATCH  /devices/{id}
 *   DELETE /devices/{id}
 *   POST   /devices/{id}/secret
 *   POST   /devices/{id}/shares
 *   DELETE /devices/{id}/shares/{userId}
 *   GET    /messages?device_ids=..&limit=1   （自检回显）
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import type {
  DeleteResponse,
  DeviceCreate,
  DeviceOut,
  DeviceUpdate,
  ShareCreate,
  ShareOut,
} from '@/api/types';

export const deviceKeys = {
  all: ['devices'] as const,
  list: () => [...deviceKeys.all, 'list'] as const,
};

export function useDevices() {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: () => api.get<DeviceOut[]>('/devices'),
    // 全局 QueryClient 关掉了 refetchOnWindowFocus，这里单独打开：
    // 从后台切回设备页时要立刻反映最新推送/自检结果。
    refetchOnWindowFocus: true,
  });
}

function useDeviceMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<DeviceOut>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}

export function useCreateDevice() {
  return useDeviceMutation((body: DeviceCreate) => api.post<DeviceOut>('/devices', body));
}

export function useUpdateDevice() {
  return useDeviceMutation(({ id, patch }: { id: number; patch: DeviceUpdate }) =>
    api.patch<DeviceOut>(`/devices/${id}`, patch),
  );
}

export function useRotateDeviceSecret() {
  return useDeviceMutation((id: number) => api.post<DeviceOut>(`/devices/${id}/secret`));
}

export function useShareDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, username }: { id: number } & ShareCreate) =>
      api.post<ShareOut>(`/devices/${id}/shares`, { username }),
    // 后端只回单个 ShareOut，因此重新拉取设备列表/详情以刷新 shares。
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}

export function useUnshareDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number }) =>
      api.del<DeleteResponse>(`/devices/${id}/shares/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deviceKeys.list() });
    },
  });
}

export function useDeleteDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<DeleteResponse>(`/devices/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
    },
  });
}
