/**
 * 接入向导内嵌的「自检」。
 *
 * 点击开始后：
 *   - 记录当前设备的 `last_ingest_at` 作为基线；
 *   - 每 2 秒轮询 `GET /devices/{id}`，一旦 `last_ingest_at` 变化，
 *     再取 `GET /messages?device_ids={id}&limit=1` 回显；
 *   - 60 秒没有变化则进入超时态。
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/api/client';
import type { DeviceOut, MessageOut, MessagePage } from '@/api/types';

import { deviceKeys } from './queries';

export const SELF_CHECK_INTERVAL_MS = 2_000;
export const SELF_CHECK_TIMEOUT_MS = 60_000;

export type SelfCheckState =
  | { phase: 'idle' }
  | { phase: 'waiting' }
  | { phase: 'success'; device: DeviceOut; message: MessageOut | null }
  | { phase: 'timeout' };

export interface SelfCheckController {
  state: SelfCheckState;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSelfCheck(deviceId: number): SelfCheckController {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SelfCheckState>({ phase: 'idle' });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * 每次 start/stop 递增的运行代号：用于作废在途的异步轮询。
   * stop() 之后（或重新 start() 之后），旧 run 即使 await 已返回也不得再 setState。
   */
  const runRef = useRef(0);

  const stop = useCallback(() => {
    runRef.current += 1;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    stop();
    setState({ phase: 'idle' });
  }, [stop]);

  const start = useCallback(() => {
    stop();
    const run = runRef.current;
    setState({ phase: 'waiting' });
    const startedAt = Date.now();
    let baseline: string | null = null;

    function scheduleNext() {
      // stop/reset/unmount 或重新 start 会递增 runRef，旧 run 不得再排期。
      if (runRef.current !== run) return;
      timerRef.current = setTimeout(() => void poll(), SELF_CHECK_INTERVAL_MS);
    }

    async function poll() {
      if (runRef.current !== run) return;
      let device: DeviceOut | null = null;
      let message: MessageOut | null = null;
      try {
        device = await api.get<DeviceOut>(`/devices/${deviceId}`);
      } catch {
        /* 轮询失败继续等待 */
      }
      try {
        const page = await api.get<MessagePage>('/messages', {
          device_ids: [deviceId],
          limit: 1,
        });
        message = page.items[0] ?? null;
      } catch {
        /* 消息回显失败不影响设备是否更新的判断 */
      }
      // 两次 await 期间可能被 stop()/reset()/重新 start()：失效的 run 直接返回，
      // 不得再 setState（取消后状态必须保持原样）。
      if (runRef.current !== run) return;
      const grew =
        device !== null &&
        device.last_ingest_at !== null &&
        (baseline === null || device.last_ingest_at > baseline);
      if (device !== null && grew) {
        stop(); // 结束当前 run，并清掉可能残留的计时器
        setState({ phase: 'success', device, message });
        // 自检确认新推送已入库：主动失效设备列表，
        // 否则关闭向导后卡片仍旧显示「从未推送 / 消息数 0」。
        void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
        return;
      }
      if (Date.now() - startedAt >= SELF_CHECK_TIMEOUT_MS) {
        stop();
        setState({ phase: 'timeout' });
        return;
      }
      scheduleNext();
    }

    void (async () => {
      try {
        baseline = (await api.get<DeviceOut>(`/devices/${deviceId}`)).last_ingest_at;
      } catch {
        /* 基线拿不到，按 null 处理 */
      }
      if (runRef.current !== run) return;
      scheduleNext();
    })();
  }, [deviceId, queryClient, stop]);

  return { state, start, stop, reset };
}
