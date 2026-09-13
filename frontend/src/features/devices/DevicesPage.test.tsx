/**
 * 回归测试：消息页 FAB 会跳到 `/devices?new=1`，设备页必须在首次挂载
 * （以及 `new` 从无到有变化）时自动打开新建对话框，并在关闭时用
 * replace 把 `new` 从 URL 去掉、不污染历史。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DevicesPage from './DevicesPage';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <DevicesPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DevicesPage 的 ?new=1', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/devices')) {
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ detail: 'not found' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  });

  it('挂载时带 new=1 自动打开新建对话框，关闭后参数被 replace 清掉', async () => {
    renderAt('/devices?new=1');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/设备名称/)).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/devices?new=1');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/devices'));
  });

  it('不带 new=1 时不打开对话框', async () => {
    renderAt('/devices');

    expect(await screen.findByText('还没有设备')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
