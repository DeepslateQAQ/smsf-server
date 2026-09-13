/**
 * TanStack Query hooks 与 queryKey 工厂。
 *
 * 路径约定：`/auth/me` 这类相对路径由 `api` 自动补 `/api` 前缀。
 *
 * 这里只保留认证相关、且真正被使用的 hooks（`AuthProvider` / 外壳 / 登录页）。
 * devices、messages、admin 各自在 feature 目录下的 `queries.ts`（或 `api.ts`）
 * 里维护数据层，不要再往这里加回别名/转发。
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { ApiError, api } from './client';
import type {
  DeleteResponse,
  LoginRequest,
  PasswordChange,
  PreferencesUpdate,
  RegisterRequest,
  SetupRequest,
  SetupStatus,
  UserOut,
} from './types';

// --------------------------------------------------------------------- keys

export const queryKeys = {
  me: ['me'] as const,
  setupStatus: ['setup-status'] as const,
};

// --------------------------------------------------------------------- auth

const SESSION_RETRY_FALSE = { retry: false, staleTime: 30_000 } as const;

export function useSetupStatus(): UseQueryResult<SetupStatus> {
  return useQuery({
    queryKey: queryKeys.setupStatus,
    queryFn: () => api.get<SetupStatus>('/auth/setup-status'),
    retry: 1,
    staleTime: 15_000,
  });
}

/** 当前登录用户；401 时返回 `null` 而不是抛错。 */
export function useMe(): UseQueryResult<UserOut | null> {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return await api.get<UserOut>('/auth/me');
      } catch (error) {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null;
        throw error;
      }
    },
    ...SESSION_RETRY_FALSE,
  });
}

export function useLogin(): UseMutationResult<UserOut, Error, LoginRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginRequest) => api.post<UserOut>('/auth/login', payload),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogout(): UseMutationResult<DeleteResponse, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DeleteResponse>('/auth/logout'),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.me, null);
      queryClient.clear();
    },
  });
}

export function useSetup(): UseMutationResult<UserOut, Error, SetupRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SetupRequest) => api.post<UserOut>('/auth/setup', payload),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.setupStatus });
    },
  });
}

export function useRegister(): UseMutationResult<UserOut, Error, RegisterRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: RegisterRequest) => api.post<UserOut>('/auth/register', payload),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
      void queryClient.invalidateQueries({ queryKey: queryKeys.setupStatus });
    },
  });
}

export function useUpdateMe(): UseMutationResult<UserOut, Error, PreferencesUpdate> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PreferencesUpdate) => api.patch<UserOut>('/auth/me', payload),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.me, user);
    },
  });
}

export function useChangePassword(): UseMutationResult<DeleteResponse, Error, PasswordChange> {
  return useMutation({
    mutationFn: (payload: PasswordChange) => api.post<DeleteResponse>('/auth/password', payload),
  });
}
