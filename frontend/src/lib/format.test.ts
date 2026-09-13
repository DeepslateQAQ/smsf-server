import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
} from './format';

// vitest 的 `test.env` 把 TZ 固定成 Asia/Shanghai（见 vite.config.ts），
// 因此“浏览器本地时区”在测试里是可断言的固定值。
const INSTANT = '2026-09-12T10:30:00Z';

describe('formatDateTime', () => {
  it('renders in the requested fixed time zone', () => {
    expect(formatDateTime(INSTANT, { timeZone: 'Asia/Shanghai' })).toBe('2026-09-12 18:30:00');
    expect(formatDateTime(INSTANT, { timeZone: 'UTC' })).toBe('2026-09-12 10:30:00');
    expect(formatDateTime(INSTANT, { timeZone: 'America/New_York' })).toBe('2026-09-12 06:30:00');
  });

  it('uses the browser local time zone by default', () => {
    expect(formatDateTime(INSTANT)).toBe('2026-09-12 18:30:00');
    expect(formatDate(INSTANT)).toBe('2026-09-12');
  });

  it('treats timezone-less backend timestamps as UTC', () => {
    expect(formatDateTime('2026-09-12T10:30:00', { timeZone: 'UTC' })).toBe('2026-09-12 10:30:00');
    expect(formatDateTime('2026-09-12T10:30:00Z', { timeZone: 'UTC' })).toBe('2026-09-12 10:30:00');
  });

  it('degrades gracefully for empty or invalid input', () => {
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-09-12T10:30:00Z');

  it('shows 刚刚 for the last minute and N 分钟前 after that', () => {
    expect(formatRelative('2026-09-12T10:29:35Z', { now })).toBe('刚刚');
    expect(formatRelative('2026-09-12T10:25:00Z', { now })).toBe('5分钟前');
    expect(formatRelative('2026-09-12T09:30:00Z', { now })).toBe('1小时前');
    expect(formatRelative('2026-09-09T10:30:00Z', { now })).toBe('3天前');
  });

  it('falls back to an absolute timestamp after a week', () => {
    expect(formatRelative('2026-08-01T10:30:00Z', { now })).toBe('2026-08-01 18:30:00');
  });

  it('switches language with the locale option', () => {
    expect(formatRelative('2026-09-12T10:25:00Z', { now, locale: 'en-US' })).toBe('5 minutes ago');
    expect(formatRelative('2026-09-12T10:29:35Z', { now, locale: 'en-US' })).toBe('just now');
  });

  it('handles future timestamps', () => {
    expect(formatRelative('2026-09-12T10:35:00Z', { now })).toBe('5分钟后');
  });
});

describe('formatDuration', () => {
  it('renders m:ss under an hour', () => {
    expect(formatDuration(299)).toBe('4:59');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('renders h:mm:ss over an hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('clamps invalid input', () => {
    expect(formatDuration(-10)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
    expect(formatDuration(59.9)).toBe('0:59');
  });
});

describe('formatCountdown / formatBytes', () => {
  it('counts down to an expiry instant', () => {
    const now = new Date('2026-09-12T10:30:00Z');
    expect(formatCountdown('2026-09-12T10:34:59Z', now)).toBe('4:59');
    expect(formatCountdown('2026-09-12T10:29:00Z', now)).toBe('0:00');
    expect(formatCountdown(null, now)).toBe('');
  });

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
