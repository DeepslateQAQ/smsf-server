/**
 * i18next 初始化。
 *
 * - `zh` / `en` 两份基础文案在 `./zh.ts` / `./en.ts`，直接作为仅有的 resources。
 * - 功能模块的局部文案（admin/devices/messages 的 `locales.ts` + `useXxxCopy`）
 *   按当前语言自行选择，不参与这里 resource 的合并。
 * - 语言来源：登录前用 localStorage `smsf.locale`（缺省时用浏览器语言），登录后跟随 `user.locale`。
 */

import i18n from 'i18next';
import { useCallback } from 'react';
import { initReactI18next, useTranslation } from 'react-i18next';

import en from './en';
import zh from './zh';

export type AppLocale = 'zh' | 'en';

export const LOCALE_STORAGE_KEY = 'smsf.locale';
export const SUPPORTED_LOCALES: AppLocale[] = ['zh', 'en'];

/**
 * 基础文案即全部 resources。
 * 原先的 `featureModules` glob 指向不存在的 `src/i18n/features/`，
 * `mergePreferBase` / `featureResources` 因此永远只得到空对象，已删除。
 */
export const resources = {
  zh: { translation: zh },
  en: { translation: en },
};

export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'zh' || value === 'en';
}

export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string' || !value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('en')) return 'en';
  return null;
}

/** 登录前的语言：localStorage 优先，其次浏览器语言。 */
export function detectLocale(): AppLocale {
  try {
    const stored = normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* localStorage 不可用（隐私模式/SSR）时忽略 */
  }
  const browser = typeof navigator !== 'undefined' ? navigator.language : '';
  return normalizeLocale(browser) ?? 'zh';
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: 'zh',
  supportedLngs: SUPPORTED_LOCALES,
  load: 'languageOnly',
  defaultNS: 'translation',
  ns: ['translation'],
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
  initImmediate: false,
});

/** 切换语言并持久化（登录后会由 AuthProvider 同步到 `user.locale`）。 */
export function setLocale(locale: AppLocale, options: { persist?: boolean } = {}): Promise<unknown> {
  const { persist = true } = options;
  if (persist) {
    try {
      globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* 忽略 */
    }
  }
  return i18n.changeLanguage(locale);
}

/** 登录/刷新用户信息后调用：跟随 `user.locale`，但不覆盖本地显式选择之外的情况。 */
export function applyUserLocale(locale: unknown): void {
  const normalized = normalizeLocale(locale);
  if (!normalized || normalized === i18n.resolvedLanguage) return;
  void setLocale(normalized, { persist: true });
}

export function currentLocale(): AppLocale {
  return normalizeLocale(i18n.resolvedLanguage ?? i18n.language) ?? 'zh';
}

/** 组件内取翻译函数：`const t = useT(); t('messages.title')`。 */
export function useT(): (key: string, vars?: Record<string, unknown>) => string {
  const { t, i18n: instance } = useTranslation();
  const language = instance.resolvedLanguage ?? instance.language;
  return useCallback(
    (key: string, vars?: Record<string, unknown>) => {
      const options = { ...(vars ?? {}) } as Record<string, unknown>;
      if (!('defaultValue' in options)) options.defaultValue = key;
      return String(t(key, options as never));
    },
    // language 变化时需要重新生成 t
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, language],
  );
}

/** 非组件环境（工具函数、msw 断言等）使用。 */
export function translate(key: string, vars?: Record<string, unknown>): string {
  const options = { ...(vars ?? {}) } as Record<string, unknown>;
  if (!('defaultValue' in options)) options.defaultValue = key;
  return String(i18n.t(key, options as never));
}

// <html lang> 跟随界面语言（a11y / 拼音输入法提示）
function syncDocumentLanguage(locale: string | undefined): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = normalizeLocale(locale) === 'en' ? 'en' : 'zh-CN';
}

i18n.on('languageChanged', syncDocumentLanguage);
syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);

export { i18n };
export default i18n;
