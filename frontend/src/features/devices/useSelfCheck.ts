/**
 * 接入向导内嵌的「自检」。
 *
 * 进入测试步骤后开启一次短暂的测试会话。SmsForwarder 的下一条推送只在
 * 内存中解析并回显，不进入消息数据库；收到首条推送后立即结束等待。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/api/client';
import type { TestPushOut, TestSessionOut, TestSessionStatus } from '@/api/types';

export const SELF_CHECK_INTERVAL_MS = 2_000;
export const SELF_CHECK_TIMEOUT_MS = 60_000;

export type SelfCheckState =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'success'; message: TestPushOut }
  | { phase: 'timeout' };

export interface SelfCheckController {
  state: SelfCheckState;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSelfCheck(deviceId: number): SelfCheckController {
  const [state, setState] = useState<SelfCheckState>({ phase: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<string | null>(null);
  /** 每次 start/stop 递增的运行代号，用于作废在途的异步轮询。 */
  const runRef = useRef(0);

  const closeSession = useCallback(
    (sessionId: string | null = sessionRef.current) => {
      if (sessionId === sessionRef.current) sessionRef.current = null;
      if (sessionId) void api.del(`/devices/${deviceId}/test-session/${sessionId}`).catch(() => {});
    },
    [deviceId],
  );

  const stop = useCallback(() => {
    runRef.current += 1;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    closeSession();
  }, [closeSession]);

  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    setState({ phase: 'idle' });
  }, [stop]);

  const start = useCallback(() => {
    stop();
    const run = runRef.current;
    const startedAt = Date.now();
    setState({ phase: 'waiting' });

    function scheduleNext(sessionId: string) {
      if (runRef.current !== run) return;
      timerRef.current = setTimeout(() => void poll(sessionId), SELF_CHECK_INTERVAL_MS);
    }

    async function poll(sessionId: string) {
      if (runRef.current !== run) return;
      let status: TestSessionStatus | null = null;
      try {
        status = await api.get<TestSessionStatus>(`/devices/${deviceId}/test-session/${sessionId}`);
      } catch {
        /* 轮询失败继续等待 */
      }
      if (runRef.current !== run) return;

      if (status?.push) {
        stop();
        setState({ phase: 'success', message: status.push });
        return;
      }
      if (status && !status.active) {
        stop();
        setState({ phase: 'timeout' });
        return;
      }
      if (Date.now() - startedAt >= SELF_CHECK_TIMEOUT_MS) {
        stop();
        setState({ phase: 'timeout' });
        return;
      }
      scheduleNext(sessionId);
    }

    void (async () => {
      try {
        const session = await api.post<TestSessionOut>(`/devices/${deviceId}/test-session`);
        if (runRef.current !== run) {
          closeSession(session.session_id);
          return;
        }
        sessionRef.current = session.session_id;
        scheduleNext(session.session_id);
      } catch {
        if (runRef.current === run) {
          stop();
          setState({ phase: 'timeout' });
        }
      }
    })();
  }, [closeSession, deviceId, stop]);

  return { state, start, stop, reset };
}
