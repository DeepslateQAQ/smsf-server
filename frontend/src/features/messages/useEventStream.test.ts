/**
 * 实时通道单测：`useEventStream` 的退避重连与 `useVisibilityInterval` 的「不可见暂停」。
 * 用假 EventSource + 假定时器，验证需求「挂掉时退避重连 / 每 60 秒兜底轮询一次（页面不可见时暂停）」。
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEventStream, useVisibilityInterval } from './useEventStream';

type Listener = (event: Event) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    const bucket = this.listeners.get(type) ?? new Set<Listener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitMessage(data = '{}'): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitNamed(type: string, data = '{}'): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as unknown as Event);
    }
  }

  emitError(): void {
    this.onerror?.();
  }
}

/** 最近建立的连接 */
function latest(): FakeEventSource {
  return FakeEventSource.instances[FakeEventSource.instances.length - 1];
}

describe('useEventStream —— SSE 连接与退避重连', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('连接 /api/events，open 后 connected，事件回调透传', () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() => useEventStream({ onEvent }));

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(latest().url).toBe('/api/events');
    expect(result.current.connected).toBe(false);

    act(() => latest().emitOpen());
    expect(result.current.connected).toBe(true);
    expect(result.current.retryCount).toBe(0);

    act(() => latest().emitMessage('{"type":"ingest"}'));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(result.current.lastEventAt).not.toBeNull();

    // 具名事件同样算「有新数据」
    act(() => latest().emitNamed('ingest'));
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('断线后按退避重连，间隔逐次变长，连上后 retryCount 归零', () => {
    const { result } = renderHook(() =>
      useEventStream({ minBackoffMs: 1000, maxBackoffMs: 30_000 }),
    );
    const first = latest();
    act(() => first.emitOpen());
    expect(result.current.connected).toBe(true);
    expect(result.current.nextRetrySeconds).toBeNull();

    // 第 1 次断开：attempt 0 -> 延迟 1000 * [0.7, 1.3]，最长 1300ms
    act(() => first.emitError());
    expect(first.closed).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.retryCount).toBe(1);
    // UI 展示的是实际调度秒数（抖动后取整），不是重连次数
    expect(result.current.nextRetrySeconds).toBeGreaterThanOrEqual(1);
    expect(result.current.nextRetrySeconds).toBeLessThanOrEqual(2);
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    // 第 2 次断开：attempt 1 -> 延迟 2000 * [0.7, 1.3] >= 1400，1 秒内不应重连
    act(() => latest().emitError());
    expect(result.current.retryCount).toBe(2);
    expect(result.current.nextRetrySeconds).toBeGreaterThanOrEqual(1);
    expect(result.current.nextRetrySeconds).toBeLessThanOrEqual(3);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(FakeEventSource.instances).toHaveLength(3);

    // 重新连上后计数归零，重连倒计时清空
    act(() => latest().emitOpen());
    expect(result.current.connected).toBe(true);
    expect(result.current.retryCount).toBe(0);
    expect(result.current.nextRetrySeconds).toBeNull();
  });

  it('退避有上限：连续断线不会超过 maxBackoffMs', () => {
    renderHook(() => useEventStream({ minBackoffMs: 1000, maxBackoffMs: 4000 }));
    for (let step = 0; step < 8; step += 1) {
      act(() => {
        latest().emitError();
        // 4000 * 1.3 = 5200 足以覆盖任何一次退避
        vi.advanceTimersByTime(5200);
      });
    }
    expect(FakeEventSource.instances.length).toBe(9);
  });

  it('卸载时关闭连接，不再重连', () => {
    const { unmount } = renderHook(() => useEventStream());
    const source = latest();
    unmount();
    expect(source.closed).toBe(true);

    act(() => {
      source.emitError();
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('enabled=false 时不建立连接', () => {
    renderHook(() => useEventStream({ enabled: false }));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});

describe('useVisibilityInterval —— 60s 兜底轮询', () => {
  let visibility: 'visible' | 'hidden';

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('可见时按周期触发，切回前台立即补一次', () => {
    const onTick = vi.fn();
    renderHook(() => useVisibilityInterval(onTick, 60_000));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    act(() => {
      vi.advanceTimersByTime(180_000);
    });
    expect(onTick).toHaveBeenCalledTimes(1);

    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it('enabled=false 时不注册定时器', () => {
    const onTick = vi.fn();
    renderHook(() => useVisibilityInterval(onTick, 60_000, false));
    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(onTick).not.toHaveBeenCalled();
  });
});
