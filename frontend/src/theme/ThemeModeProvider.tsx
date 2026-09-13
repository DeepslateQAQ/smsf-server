/**
 * 主题模式 Provider：`light | dark | system` + 种子色。
 *
 * - 本地持久化：localStorage（`smsf.theme-mode` / `smsf.theme-seed`）
 * - 登录后与后端同步：`PATCH /api/auth/me`（PreferencesUpdate）
 * - 实际渲染走 MUI `CssVarsProvider`（`colorSchemes.light/dark`）
 */

import { CssVarsProvider, useColorScheme } from '@mui/material/styles';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { ThemeMode } from '@/api/types';
import { useAuth } from '@/features/auth/AuthProvider';

import { DEFAULT_SEED, createAppTheme, isThemeMode, normalizeHex } from './index';

export const MODE_STORAGE_KEY = 'smsf.theme-mode';
export const SEED_STORAGE_KEY = 'smsf.theme-seed';
const SYNC_DEBOUNCE_MS = 400;

/**
 * 把应用态的 mode 同步进 MUI 的 colorScheme 运行时（以及反向吸附外部变化）。
 *
 * 背景：MUI v7 的 CssVarsProvider 是「非受控」的——`mode`/`onModeChange` prop 只是
 * 被透传展开，运行时从不读取；真正的模式状态在 `useColorScheme()` 里。不写桥接的话，
 * 切换主题只改了 localStorage，data-mui-color-scheme 与配色在刷新前都不会变。
 */
function ColorSchemeSync({ mode, onExternalMode }: { mode: ThemeMode; onExternalMode: (mode: ThemeMode) => void }) {
  const { mode: muiMode, setMode: setMuiMode } = useColorScheme();
  // 应用 → MUI：本页切换浅/深/跟随，立即翻转 color-scheme 与 CSS 变量
  useEffect(() => {
    if (muiMode !== mode) setMuiMode(mode);
  }, [muiMode, mode, setMuiMode]);
  // MUI → 应用：storage 事件等外部改变（如其他标签页切换）
  useEffect(() => {
    if (isThemeMode(muiMode) && muiMode !== mode) onExternalMode(muiMode);
    // onExternalMode 稳定；只跟随 muiMode 变化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muiMode]);
  return null;
}

export type SyncState = 'idle' | 'syncing' | 'error';

export interface ThemeModeContextValue {
  seed: string;
  mode: ThemeMode;
  /** `system` 解析后的实际模式 */
  resolvedMode: 'light' | 'dark';
  setSeed: (seed: string) => void;
  setMode: (mode: ThemeMode) => void;
  resetSeed: () => void;
  syncState: SyncState;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function readStoredMode(): ThemeMode {
  const stored = readStored(MODE_STORAGE_KEY);
  return isThemeMode(stored) ? stored : 'system';
}

export function readStoredSeed(): string {
  return normalizeHex(readStored(SEED_STORAGE_KEY) ?? '') ?? DEFAULT_SEED;
}

export function useThemeMode(): ThemeModeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode 必须在 ThemeModeProvider 内部使用');
  return ctx;
}

function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const { user, updatePrefs } = useAuth();
  const [seed, setSeedState] = useState<string>(() => readStoredSeed());
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredMode());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => systemPrefersDark());
  const [syncState, setSyncState] = useState<SyncState>('idle');
  const hydratedForUser = useRef<number | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 跟随系统主题
  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const listener = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    setPrefersDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // 登录后采用账户偏好（每个用户只吸附一次）
  useEffect(() => {
    if (!user || hydratedForUser.current === user.id) return;
    hydratedForUser.current = user.id;
    const serverSeed = normalizeHex(user.theme_seed ?? '');
    if (serverSeed) {
      setSeedState(serverSeed);
      writeStored(SEED_STORAGE_KEY, serverSeed);
    }
    const serverMode = isThemeMode(user.theme_mode) ? user.theme_mode : 'system';
    setModeState(serverMode);
    writeStored(MODE_STORAGE_KEY, serverMode);
  }, [user]);

  useEffect(() => () => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
  }, []);

  const scheduleSync = useCallback(
    (payload: { theme_seed?: string; theme_mode?: ThemeMode }) => {
      if (!user) return;
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        setSyncState('syncing');
        updatePrefs(payload)
          .then(() => setSyncState('idle'))
          .catch(() => setSyncState('error'));
      }, SYNC_DEBOUNCE_MS);
    },
    [updatePrefs, user],
  );

  const setSeed = useCallback(
    (next: string) => {
      const normalized = normalizeHex(next) ?? DEFAULT_SEED;
      setSeedState(normalized);
      writeStored(SEED_STORAGE_KEY, normalized);
      scheduleSync({ theme_seed: normalized });
    },
    [scheduleSync],
  );

  const setMode = useCallback(
    (next: ThemeMode) => {
      setModeState(next);
      writeStored(MODE_STORAGE_KEY, next);
      scheduleSync({ theme_mode: next });
    },
    [scheduleSync],
  );

  const resetSeed = useCallback(() => setSeed(DEFAULT_SEED), [setSeed]);

  const theme = useMemo(() => createAppTheme({ seed }), [seed]);
  const resolvedMode: 'light' | 'dark' = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;

  const contextValue = useMemo<ThemeModeContextValue>(
    () => ({ seed, mode, resolvedMode, setSeed, setMode, resetSeed, syncState }),
    [seed, mode, resolvedMode, setSeed, setMode, resetSeed, syncState],
  );

  return (
    <ThemeModeContext.Provider value={contextValue}>
      <CssVarsProvider
        theme={theme}
        defaultMode="system"
        modeStorageKey={MODE_STORAGE_KEY}
        colorSchemeStorageKey={MODE_STORAGE_KEY}
      >
        <ColorSchemeSync mode={mode} onExternalMode={setMode} />
        {children}
      </CssVarsProvider>
    </ThemeModeContext.Provider>
  );
}
