/**
 * 冒烟测试：MessagesPage 在 jsdom 里完整渲染（列表 / 候选角标 / URL query -> 请求参数）。
 * 不依赖真实后端：fetch 全部打桩。
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import MessagesPage from './MessagesPage';
import type { MessageOut } from '@/api/types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CODE_MESSAGE: MessageOut = {
  id: 1,
  device_id: 3,
  device_name: '主力机',
  device_color: '#0B57D0',
  kind: 'sms',
  sender: '10086',
  content: '您的验证码是 483920 ，请在 5 分钟内输入。',
  raw_content: '您的验证码是 483920 ，请在 5 分钟内输入。',
  received_at: '2025-05-17T10:00:00Z',
  ingested_at: '2025-05-17T10:00:01Z',
  sent_at: null,
  time_source: 'device',
  time_doubtful: false,
  sim_slot: '卡 1',
  code: '483920',
  code_confidence: 96,
  code_candidates: [
    { code: '483920', confidence: 96 },
    { code: '483929', confidence: 61 },
  ],
  code_expires_at: new Date(Date.now() + 300_000).toISOString(),
  code_expired: false,
  can_delete: true,
  raw_payload: {},
};

const PLAIN_MESSAGE: MessageOut = {
  ...CODE_MESSAGE,
  id: 2,
  sender: '10010',
  content: '本月流量已使用 80%',
  raw_content: '本月流量已使用 80%',
  code: null,
  code_confidence: null,
  code_candidates: [],
  code_expires_at: null,
  time_doubtful: true,
};

let requestedUrls: string[] = [];

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <MessagesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MessagesPage 渲染与 URL query', () => {
  beforeAll(() => {
    // MUI X 的 picker 在 jsdom 下需要 ResizeObserver
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    requestedUrls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes('/api/messages/facets')) {
          return jsonResponse({
            senders: [{ value: '10086', label: '10086', count: 12 }],
            devices: [{ value: '3', label: '主力机', count: 12 }],
            total: 12,
          });
        }
        if (url.includes('/api/messages/export')) return jsonResponse([]);
        if (url.includes('/api/messages')) {
          return jsonResponse({ items: [CODE_MESSAGE, PLAIN_MESSAGE], next_cursor: null });
        }
        if (url.includes('/api/devices')) {
          return jsonResponse([
            {
              id: 3,
              name: '主力机',
              description: '',
              color: '#0B57D0',
              sim_label: '',
              is_active: true,
              owner_id: 1,
              owner_name: '我',
              is_owner: true,
              created_at: '2025-01-01T00:00:00Z',
              last_ingest_at: null,
              secret_fingerprint: 'abc',
              device_mark: 'mark',
              last_auth_kind: '',
              message_count: 12,
              shares: [],
            },
          ]);
        }
        return jsonResponse({ detail: 'not found' }, 404);
      }),
    );
  });

  it('渲染验证码大字、+N 候选角标与发件人', async () => {
    renderAt('/');

    // 大字验证码 + 正文摘要里的高亮都会出现这个数字
    const codeNodes = await screen.findAllByText('483920');
    expect(codeNodes.length).toBeGreaterThan(1);
    const bigCode = Array.from(document.querySelectorAll('button')).find(
      (node) => node.textContent === '483920',
    );
    expect(bigCode).toBeTruthy();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getAllByText('10086').length).toBeGreaterThan(0);
    expect(screen.getByText('10010')).toBeInTheDocument();
    // 命中验证码的正文摘要被 <mark> 包住
    expect(document.querySelectorAll('mark').length).toBeGreaterThan(0);
  });

  it('URL query 决定首次请求与筛选控件状态', async () => {
    renderAt('/?q=%E9%AA%8C%E8%AF%81%E7%A0%81&senders=10086&device_ids=3&has_code=1&kind=sms&sort=ingested_at&order=asc');

    expect(await screen.findByDisplayValue('验证码')).toBeInTheDocument();

    const listCall = requestedUrls.find((url) => url.includes('/api/messages?'));
    expect(listCall).toBeTruthy();
    const decoded = decodeURIComponent(listCall ?? '');
    expect(decoded).toContain('q=验证码');
    expect(decoded).toContain('senders=10086');
    expect(decoded).toContain('device_ids=3');
    expect(decoded).toContain('has_code=true');
    expect(decoded).toContain('kind=sms');
    expect(decoded).toContain('sort=ingested_at');
    expect(decoded).toContain('order=asc');
  });
});
