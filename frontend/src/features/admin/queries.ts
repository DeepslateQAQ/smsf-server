/**
 * admin 的数据访问层：基于 `@/api/client` 的 TanStack Query 封装。
 *
 * 端点（全部挂在 `/api` 前缀下）：
 *   GET    /admin/users
 *   POST   /admin/users
 *   PATCH  /admin/users/{id}
 *   DELETE /admin/users/{id}
 *   POST   /admin/users/{id}/reset-password
 *   GET    /admin/devices
 *   PATCH  /admin/devices/{id}
 *   DELETE /admin/devices/{id}
 *   GET    /admin/settings
 *   PATCH  /admin/settings
 *   GET    /admin/stats
 *   GET    /admin/audit?cursor=&limit=
 *   GET    /admin/lockouts
 *   POST   /admin/lockouts/{username}/clear
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/api/client';
import type {
  AdminDeviceOut,
  AdminUserCreate,
  AdminUserUpdate,
  AuditPage,
  CreatedUserOut,
  DeleteResponse,
  LockoutOut,
  SettingsOut,
  SettingsUpdate,
  StatsOut,
  UserOut,
} from '@/api/types';

export const ADMIN_AUDIT_PAGE_SIZE = 25;

export const adminKeys = {
  all: ['admin'] as const,
  users: () => ['admin', 'users'] as const,
  devices: () => ['admin', 'devices'] as const,
  settings: () => ['admin', 'settings'] as const,
  stats: () => ['admin', 'stats'] as const,
  audit: () => ['admin', 'audit'] as const,
  lockouts: () => ['admin', 'lockouts'] as const,
};

export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.users(),
    queryFn: () => api.get<UserOut[]>('/admin/users'),
  });
}

export function useCreateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminUserCreate) => api.post<CreatedUserOut>('/admin/users', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.users() }),
  });
}

export function useUpdateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: AdminUserUpdate }) =>
      api.patch<UserOut>(`/admin/users/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.users() }),
  });
}

export function useDeleteAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<DeleteResponse>(`/admin/users/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.users() }),
  });
}

export function useResetAdminUserPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CreatedUserOut>(`/admin/users/${id}/reset-password`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.users() }),
  });
}

export function useAdminDevices() {
  return useQuery({
    queryKey: adminKeys.devices(),
    queryFn: () => api.get<AdminDeviceOut[]>('/admin/devices'),
  });
}

export function useUpdateAdminDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: { is_active: boolean } }) =>
      api.patch<AdminDeviceOut>(`/admin/devices/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.devices() }),
  });
}

export function useDeleteAdminDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del<DeleteResponse>(`/admin/devices/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.devices() }),
  });
}

export function useAdminSettings() {
  return useQuery({
    queryKey: adminKeys.settings(),
    queryFn: () => api.get<SettingsOut>('/admin/settings'),
  });
}

export function useUpdateAdminSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) => api.patch<SettingsOut>('/admin/settings', patch),
    onSuccess: (data) => queryClient.setQueryData(adminKeys.settings(), data),
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: () => api.get<StatsOut>('/admin/stats'),
  });
}

export function useAdminAudit() {
  return useInfiniteQuery({
    queryKey: adminKeys.audit(),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get<AuditPage>('/admin/audit', { cursor: pageParam, limit: ADMIN_AUDIT_PAGE_SIZE }),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
}

export function useAdminLockouts() {
  return useQuery({
    queryKey: adminKeys.lockouts(),
    queryFn: () => api.get<LockoutOut[]>('/admin/lockouts'),
  });
}

export function useUnlockUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) =>
      api.post<DeleteResponse>(`/admin/lockouts/${encodeURIComponent(username)}/clear`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: adminKeys.lockouts() }),
  });
}
