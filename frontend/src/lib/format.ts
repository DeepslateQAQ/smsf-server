/**
 * 时间与体积格式化。
 *
 * - `formatDateTime` / `formatRelative` 默认使用浏览器本地时区；
 *   传入 `timeZone`（IANA 名，如 `Asia/Shanghai`）可做确定性输出（测试用）。
 * - `formatDuration` 输出 `4:59` / `1:02:03`。
 */

export interface FormatOptions {
  /** IANA 时区名，默认浏览器本地时区 */
  timeZone?: string;
  /** BCP-47 语言标签，默认 `zh-CN` */
  locale?: string;
  /** 相对时间的基准时刻，默认当前时间 */
  now?: Date | string | number;
}

const LOCALE_ZH = 'zh-CN';

function toDate(value: string | number | Date): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
  }
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  // 后端返回 naive UTC ISO（无时区后缀）时按 UTC 解析
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasZone ? raw : `${raw}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地时区（或指定时区）的 `YYYY-MM-DD HH:mm:ss`。 */
export function formatDateTime(iso: string | number | Date, options: FormatOptions = {}): string {
  const date = toDate(iso);
  if (!date) return '—';
  const { timeZone } = options;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const pick = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? '';
    const hour = pick('hour') === '24' ? '00' : pick('hour');
    return `${pick('year')}-${pick('month')}-${pick('day')} ${hour}:${pick('minute')}:${pick('second')}`;
  } catch {
    // 时区名非法时退回本地时区
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
      date.getHours(),
    )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }
}

/** 本地时区（或指定时区）的 `YYYY-MM-DD`。 */
export function formatDate(iso: string | number | Date, options: FormatOptions = {}): string {
  return formatDateTime(iso, options).slice(0, 10);
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前，超过 7 天回落到日期时间。 */
export function formatRelative(iso: string | number | Date, options: FormatOptions = {}): string {
  const date = toDate(iso);
  if (!date) return '—';
  const { locale = LOCALE_ZH } = options;
  const now = options.now ? toDate(options.now) : new Date();
  if (!now) return formatDateTime(date, options);

  const diffSeconds = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diffSeconds);
  const isEnglish = locale.toLowerCase().startsWith('en');

  if (abs < 45) return isEnglish ? 'just now' : '刚刚';
  if (abs < 3600) return formatUnit(Math.trunc(diffSeconds / 60), 'minute', locale);
  if (abs < 86_400) return formatUnit(Math.trunc(diffSeconds / 3600), 'hour', locale);
  if (abs < 7 * 86_400) return formatUnit(Math.trunc(diffSeconds / 86_400), 'day', locale);
  return formatDateTime(date, options);
}

function formatUnit(value: number, unit: 'minute' | 'hour' | 'day', locale: string): string {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
  } catch {
    const labels = { minute: '分钟', hour: '小时', day: '天' };
    const suffix = value < 0 ? '前' : '后';
    return `${Math.abs(value)}${labels[unit]}${suffix}`;
  }
}

/** 时长：`4:59`、`1:02:03`。负数按 0 处理。 */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

/** 验证码剩余毫秒 -> 倒计时文案（`4:59`）。 */
export function formatCountdown(expiresAt: string | null, now: Date = new Date()): string {
  const date = expiresAt ? toDate(expiresAt) : null;
  if (!date) return '';
  return formatDuration((date.getTime() - now.getTime()) / 1000);
}

/** 体积：`1.5 MB`。 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(fractionDigits)} ${units[index]}`;
}
