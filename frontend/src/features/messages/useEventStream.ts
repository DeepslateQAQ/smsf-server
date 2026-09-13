/**
 * 实时通道：
 * - `useEventStream`：`EventSource('/api/events')`，任何事件触发 `onEvent`；断线按指数退避重连
 *   （1s → 2s → 4s … 上限 30s，带抖动）。事件只是「有新数据」的唤醒信号，
 *   数据仍由 REST 游标拉取，所以丢事件/重复都不影响正确性。
 * - `useVisibilityInterval`：兜底轮询，页面不可见时暂停，回到前台立即补一次。
 */

import { useEffect, useMemo, useRef, useState } from 'react';

export interface EventStreamState {
  connected: boolean;
  /** 已重连次数（连上后归零） */
  retryCount: number;
  /**
   * 下一次重连的实际等待秒数（带抖动的 timeout 值取整），
   * 连接中/正常时一律为 null。用于 UI 展示「{{seconds}}s 后重连」。
   */
  nextRetrySeconds: number | null;
  /** 最近一次事件时间戳 */
  lastEventAt: number | null;
}

export interface UseEventStreamOptions {
  url?: string;
  enabled?: boolean;
  /** 收到任意事件时回调（内部保持最新引用，不需要 memo） */
  onEvent?: (event: MessageEvent<string>) => void;
  onOpen?: () => void;
  /** 首次重连等待，默认 1000ms */
  minBackoffMs?: number;
  /** 退避上限，默认 30000ms */
  maxBackoffMs?: number;
  /** 需要额外监听的具名事件（`event:` 字段）；冒烟事件被忽略 */
  eventNames?: readonly string[];
}

const DEFAULT_EVENT_NAMES = ['message', 'messages', 'ingest', 'device', 'settings'] as const;
const IGNORED_EVENT_NAMES = ['ping', 'heartbeat', 'keepalive', 'comment'];

export function useEventStream(options: UseEventStreamOptions = {}): EventStreamState {
  const {
    url = '/api/events',
    enabled = true,
    onEvent,
    onOpen,
    minBackoffMs = 1000,
    maxBackoffMs = 30_000,
    eventNames = DEFAULT_EVENT_NAMES,
  } = options;

  const [state, setState] = useState<EventStreamState>({
    connected: false,
    retryCount: 0,
    nextRetrySeconds: null,
    lastEventAt: null,
  });

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  // 归一化连接依赖：内联数组字面量每次渲染都是新引用，直接放进 deps 会让
  // EventSource 每渲染一次就重建一次。转成稳定字符串 key 即可避免。
  const eventNamesKey = useMemo(() => [...eventNames].join('\n'), [eventNames]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof EventSource === 'undefined') return undefined;

    let disposed = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    // 从稳定 key 还原监听列表：effect 内不再直接引用 eventNames 引用。
    const names = eventNamesKey ? eventNamesKey.split('\n') : [];

    const dispatch = (event: MessageEvent<string>) => {
      setState((prev) => ({ ...prev, lastEventAt: Date.now() }));
      onEventRef.current?.(event);
    };

    const listen = (names: readonly string[]): (() => void) => {
      if (!source) return () => {};
      const listener = (event: Event) => dispatch(event as MessageEvent<string>);
      const registered: string[] = [];
      for (const name of names) {
        if (name === 'message' || IGNORED_EVENT_NAMES.includes(name)) continue;
        source.addEventListener(name, listener);
        registered.push(name);
      }
      return () => {
        for (const name of registered) source?.removeEventListener(name, listener);
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      const base = Math.min(maxBackoffMs, minBackoffMs * 2 ** attempt);
      const delay = Math.round(base * (0.7 + Math.random() * 0.6));
      attempt += 1;
      setState((prev) => ({
        ...prev,
        connected: false,
        retryCount: attempt,
        nextRetrySeconds: Math.round(delay / 1000),
      }));
      timer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed) return;
      let unlisten = () => {};
      try {
        source = new EventSource(url);
      } catch {
        scheduleReconnect();
        return;
      }
      const current = source;
      current.onopen = () => {
        attempt = 0;
        setState((prev) => ({ ...prev, connected: true, retryCount: 0, nextRetrySeconds: null }));
        onOpenRef.current?.();
      };
      current.onmessage = (event) => dispatch(event as MessageEvent<string>);
      current.onerror = () => {
        unlisten();
        current.close();
        if (source === current) source = null;
        scheduleReconnect();
      };
      unlisten = listen(names);
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
      source = null;
    };
  }, [enabled, url, minBackoffMs, maxBackoffMs, eventNamesKey]);

  return state;
}

/**
 * 每 `intervalMs` 跑一次 `callback`，`document.visibilityState !== 'visible'` 时跳过；
 * 从后台切回前台时立即补一次（避免等待一个完整周期）。
 */
export function useVisibilityInterval(callback: () => void, intervalMs: number, enabled = true): void {
  const handler = useRef(callback);
  handler.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return undefined;
    const tick = () => {
      if (document.visibilityState === 'visible') handler.current();
    };
    const timer = window.setInterval(tick, intervalMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') handler.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled, intervalMs]);
}
