/**
 * 认证上下文：当前用户、登录/登出/初始化/注册/改密/偏好同步。
 * 数据层由 TanStack Query 提供（`@/api/queries`）。
 */

import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { ApiError, setUnauthorizedHandler } from '@/api/client';
import {
  queryKeys,
  useChangePassword,
  useLogin,
  useLogout,
  useMe,
  useRegister,
  useSetup,
  useUpdateMe,
} from '@/api/queries';
import type {
  LoginRequest,
  PasswordChange,
  PreferencesUpdate,
  RegisterRequest,
  SetupRequest,
  UserOut,
} from '@/api/types';
import { applyUserLocale } from '@/i18n';

export interface AuthContextValue {
  user: UserOut | null;
  loading: boolean;
  isAdmin: boolean;
  login: (input: LoginRequest) => Promise<UserOut>;
  logout: () => Promise<void>;
  setup: (input: SetupRequest) => Promise<UserOut>;
  register: (input: RegisterRequest) => Promise<UserOut>;
  changePassword: (input: PasswordChange) => Promise<void>;
  updatePrefs: (input: PreferencesUpdate) => Promise<UserOut>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内部使用');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  const setupMutation = useSetup();
  const registerMutation = useRegister();
  const updatePrefsMutation = useUpdateMe();
  const changePasswordMutation = useChangePassword();

  const user = me.data ?? null;
  /** 已吸附语言的用户 id：/auth/me 的每次刷新 payload 不再重复覆盖当前语言。 */
  const localeHydratedForUser = useRef<number | null>(null);

  // 语言跟随 `user.locale`：每个用户登录后只吸附一次（登出后重置）。
  useEffect(() => {
    if (!user) {
      localeHydratedForUser.current = null;
      return;
    }
    if (localeHydratedForUser.current === user.id) return;
    localeHydratedForUser.current = user.id;
    applyUserLocale(user.locale);
  }, [user]);

  // 任何 401 都清理登录态（路由守卫会据此跳转登录页）
  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.setQueryData(queryKeys.me, null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.setupStatus });
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const login = useCallback(async (input: LoginRequest) => loginMutation.mutateAsync(input), [loginMutation]);

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error) {
      // 会话已失效时也要完成本地登出
      if (!(error instanceof ApiError)) throw error;
      queryClient.setQueryData(queryKeys.me, null);
    }
  }, [logoutMutation, queryClient]);

  const setup = useCallback(async (input: SetupRequest) => setupMutation.mutateAsync(input), [setupMutation]);

  const register = useCallback(async (input: RegisterRequest) => registerMutation.mutateAsync(input), [registerMutation]);

  const changePassword = useCallback(
    async (input: PasswordChange) => {
      await changePasswordMutation.mutateAsync(input);
    },
    [changePasswordMutation],
  );

  const updatePrefs = useCallback(
    async (input: PreferencesUpdate) => updatePrefsMutation.mutateAsync(input),
    [updatePrefsMutation],
  );

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading: me.isLoading,
      isAdmin: Boolean(user?.is_admin),
      login,
      logout,
      setup,
      register,
      changePassword,
      updatePrefs,
      refresh,
    }),
    [user, me.isLoading, login, logout, setup, register, changePassword, updatePrefs, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
