import { useCallback } from 'react';

import { setLocale, type AppLocale } from '@/i18n';

import { useAuth } from './AuthProvider';

/**
 * 切换界面语言：立即生效 + 写入 localStorage；已登录时同时 `PATCH /api/auth/me` 同步到账户。
 */
export function useLocaleSwitch(): (locale: AppLocale) => void {
  const { user, updatePrefs } = useAuth();

  return useCallback(
    (locale: AppLocale) => {
      void setLocale(locale);
      if (user) {
        void updatePrefs({ locale }).catch(() => {
          // 同步失败不阻塞本地切换（本地已是新语言）
        });
      }
    },
    [user, updatePrefs],
  );
}
