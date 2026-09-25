import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/api/client';

import { useSelfCheck } from './useSelfCheck';

const SESSION = { session_id: 'session-1', expires_at: '2026-09-25T00:01:00Z' };
const PUSH = {
  sender: '10086',
  code: '246810',
  received_at: '2026-09-25T00:00:01Z',
  time_source: 'device',
  sign_ok: true,
  auth_kind: 'sign',
};

describe('useSelfCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opens a session, polls it, shows success, and closes it after a push', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(SESSION as never);
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ active: true, push: null } as never)
      .mockResolvedValueOnce({ active: true, push: PUSH } as never);
    const del = vi.spyOn(api, 'del').mockResolvedValue({ ok: true } as never);
    const { result } = renderHook(() => useSelfCheck(7));

    act(() => result.current.start());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(post).toHaveBeenCalledWith('/devices/7/test-session');

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(get).toHaveBeenCalledWith('/devices/7/test-session/session-1');
    expect(result.current.state.phase).toBe('waiting');

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ phase: 'success', message: PUSH });
    expect(del).toHaveBeenCalledWith('/devices/7/test-session/session-1');
  });

  it('closes the session when reset stops waiting', async () => {
    vi.spyOn(api, 'post').mockResolvedValue(SESSION as never);
    const del = vi.spyOn(api, 'del').mockResolvedValue({ ok: true } as never);
    const { result } = renderHook(() => useSelfCheck(7));

    act(() => result.current.start());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => result.current.reset());

    expect(result.current.state).toEqual({ phase: 'idle' });
    expect(del).toHaveBeenCalledWith('/devices/7/test-session/session-1');
  });
});
