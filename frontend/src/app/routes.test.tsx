import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useRoutes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appRoutes } from '@/app/router';
import { AuthProvider } from '@/features/auth/AuthProvider';
import LoginPage from '@/features/auth/LoginPage';
import SetupPage from '@/features/auth/SetupPage';
import { ThemeModeProvider } from '@/theme/ThemeModeProvider';
import { generateTonalScheme } from '@/theme/tonal';

const ADMIN_USER = {
  id: 1,
  username: 'admin',
  display_name: '管理员',
  role: 'admin',
  is_admin: true,
  is_active: true,
  locale: 'zh',
  theme_seed: '#0B57D0',
  theme_mode: 'system',
  created_at: '2026-09-12T10:00:00Z',
  last_login_at: null,
};

let setupRequired = true;
let currentUser: unknown = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderRoute(element: ReactElement, path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeModeProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path={path} element={element} />
            </Routes>
          </MemoryRouter>
        </ThemeModeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function stylesheetText(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n');
}

/** 用真实路由表渲染整个应用。
 *
 * 这里刻意用声明式路由（`MemoryRouter` + `useRoutes`）而不是 `createMemoryRouter`：
 * jsdom 的 `AbortController` 与 Node/undici 的 `Request` 不是同一实现，
 * react-router 的数据路由在导航时 `new Request(url, { signal })` 会抛
 * "Expected signal to be an instance of AbortSignal"，这是测试环境特有的问题，
 * 浏览器里不存在（生产代码仍用 `createBrowserRouter`）。
 */
function RoutesFromTable() {
  return useRoutes(appRoutes);
}

function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeModeProvider>
          <MemoryRouter initialEntries={[path]}>
            <RoutesFromTable />
          </MemoryRouter>
        </ThemeModeProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('认证路由与守卫', () => {
  beforeEach(() => {
    setupRequired = true;
    currentUser = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/setup-status')) {
          return jsonResponse({ setup_required: setupRequired, allow_public_registration: false });
        }
        if (url.includes('/api/auth/me')) {
          return currentUser ? jsonResponse(currentUser) : jsonResponse({ detail: '未登录' }, 401);
        }
        return jsonResponse({ detail: 'not found' }, 404);
      }),
    );
    try {
      globalThis.localStorage?.removeItem('smsf.theme-seed');
      globalThis.localStorage?.setItem('smsf.theme-mode', 'system');
    } catch {
      /* ignore */
    }
  });

  it('渲染 /login', async () => {
    renderRoute(<LoginPage />, '/login');
    expect(await screen.findByRole('heading', { name: /登录短信中心|Sign in/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/用户名|Username/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^密码$|^Password$/)).toBeInTheDocument();
  });

  it('渲染 /setup 并展示密码强度提示', async () => {
    renderRoute(<SetupPage />, '/setup');
    expect(
      await screen.findByRole('heading', { name: /初始化短信中心|Initialise the message center/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/至少 8 位字符|At least 8 characters/)).toBeInTheDocument();
    expect(screen.getByText(/密码强度|Password strength/)).toBeInTheDocument();
  });

  it('把 MD3 tonal token 写成浅/深两套 CSS 变量', async () => {
    try {
      globalThis.localStorage?.setItem('smsf.theme-seed', '#B3261E');
    } catch {
      /* ignore */
    }
    renderRoute(<LoginPage />, '/login');
    await screen.findByRole('heading', { name: /登录短信中心|Sign in/ });

    const css = stylesheetText();
    expect(css).toContain('--mui-palette-primaryContainer');
    expect(css).toContain('--mui-palette-onPrimaryContainer');
    expect(css).toContain('--mui-palette-surfaceContainerHigh');
    // 自定义 seed 必须落到实际样式：浅色 primary 就是该 seed 生成的 tone-40 主色
    const expectedPrimary = generateTonalScheme('#B3261E', 'light').primary;
    expect(css.toUpperCase()).toContain(`--MUI-PALETTE-PRIMARY-MAIN:${expectedPrimary.toUpperCase()}`);
    expect(css).toContain('--mui-shape-borderRadius:12px');
    expect(css).toContain('[data-mui-color-scheme="dark"]');
  });

  it('未初始化时任意路径都跳到 /setup', async () => {
    renderApp('/login');
    expect(
      await screen.findByRole('heading', { name: /初始化短信中心|Initialise the message center/ }),
    ).toBeInTheDocument();
  });

  it('已初始化时 /login 渲染登录表单', async () => {
    setupRequired = false;
    renderApp('/login');
    expect(await screen.findByRole('heading', { name: /登录短信中心|Sign in/ })).toBeInTheDocument();
  });

  it('未登录访问受保护路由会跳转登录页', async () => {
    setupRequired = false;
    renderApp('/devices');
    expect(await screen.findByRole('heading', { name: /登录短信中心|Sign in/ })).toBeInTheDocument();
  });

  it('已登录时渲染外壳（导航 + 顶栏）', async () => {
    setupRequired = false;
    currentUser = ADMIN_USER;
    renderApp('/settings');
    // 外壳：桌面导航（消息/设备/设置/管理）
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /用户菜单|Account menu/ })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /切换主题|Toggle theme/ })).toBeInTheDocument();
  });

  it('非管理员访问 /admin 会被送回消息页', async () => {
    setupRequired = false;
    currentUser = { ...ADMIN_USER, role: 'user', is_admin: false };
    renderApp('/admin');
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
    // 导航项是真实链接（ListItemButton component={RouterLink}），不再是 div-button
    expect(screen.getByRole('link', { name: /消息|Messages/ })).toBeInTheDocument();
  });
});
