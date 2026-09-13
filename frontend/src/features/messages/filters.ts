/**
 * 消息列表的 URL query 契约（纯函数，无 React 依赖，可直接被 Vitest 覆盖）。
 *
 * 参数名清单（与后端 `GET /api/messages` 的查询参数保持一致，便于分享与刷新保持）：
 *
 * | query 参数   | 取值                            | 说明                                        |
 * | ------------ | ------------------------------- | ------------------------------------------- |
 * | `q`          | string                          | 关键词，输入框防抖 300ms 后写入             |
 * | `senders`    | string，可重复                  | 发送者（facets.value 精确匹配）             |
 * | `device_ids` | number，可重复                  | 设备 id                                     |
 * | `range`      | `today` \| `7d` \| `30d`        | 时间快捷项；`全部` 时该参数不存在           |
 * | `from`       | ISO 时间                        | 自定义区间起点（含）                        |
 * | `to`         | ISO 时间                        | 自定义区间终点（含）                        |
 * | `sort`       | `received_at` \| `ingested_at`  | 排序字段，默认 `received_at`（不写入 URL）  |
 * | `order`      | `desc` \| `asc`                 | 排序方向，默认 `desc`（不写入 URL）         |
 * | `has_code`   | `1`                             | 只看识别出验证码的消息；关闭时不存在        |
 * | `kind`       | `sms` \| `notification` \| `call` | 消息类型；`全部` 时该参数不存在           |
 *
 * 约定：
 * `range` 与 `from`+`to` 两种时间模式互斥，优先级 `range` > `from`/`to`。
 * - `from` / `to` 在 URL 与 UI 里都是「闭区间」语义（当日 23:59:59.999）；
 *   `toApiQuery` 会 +1ms 转成后端的半开区间 `[from, to)`。
 * - 显示密度不在这里，存在 localStorage（见 `density.ts`）。
 */

import dayjs from 'dayjs';

import type { Query } from '@/api/client';

/** 每页条数；游标由 react-query 维护，不进 URL。 */
export const PAGE_SIZE = 50;

export const FILTER_PARAM = {
  q: 'q',
  senders: 'senders',
  deviceIds: 'device_ids',
  range: 'range',
  from: 'from',
  to: 'to',
  sort: 'sort',
  order: 'order',
  hasCode: 'has_code',
  kind: 'kind',
} as const;

export type TimeRangePreset = 'today' | '7d' | '30d';
export const TIME_RANGE_PRESETS = ['today', '7d', '30d'] as const;

export type SortField = 'received_at' | 'ingested_at';
export const SORT_FIELDS = ['received_at', 'ingested_at'] as const;

export type SortOrder = 'desc' | 'asc';
export const SORT_ORDERS = ['desc', 'asc'] as const;

export type KindFilter = 'sms' | 'notification' | 'call';
export const KIND_FILTERS = ['sms', 'notification', 'call'] as const;

export const DEFAULT_SORT: SortField = 'received_at';
export const DEFAULT_ORDER: SortOrder = 'desc';

/** 归一化后的筛选状态（组件与 query key 使用的唯一形态）。 */
export interface MessagesUrlState {
  q?: string;
  senders: string[];
  deviceIds: number[];
  range?: TimeRangePreset;
  from?: string;
  to?: string;
  sort: SortField;
  order: SortOrder;
  hasCode: boolean;
  kind?: KindFilter;
}

/** 宽松输入：URL 解析、部分 patch、外部传入的脏值都走这里。 */
export interface MessagesUrlInput {
  q?: string | null;
  senders?: readonly string[] | null;
  deviceIds?: readonly (number | string)[] | null;
  range?: string | null;
  from?: string | null;
  to?: string | null;
  sort?: string | null;
  order?: string | null;
  hasCode?: boolean | null;
  kind?: string | null;
}

function oneOf<T extends string>(values: readonly T[], raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  const needle = raw.trim();
  return (values as readonly string[]).includes(needle) ? (needle as T) : undefined;
}

function normalizeText(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function uniqueStrings(values: readonly string[] | null | undefined): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function toDeviceId(value: number | string): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function uniqueNumbers(values: readonly (number | string)[] | null | undefined): number[] {
  if (!values?.length) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of values) {
    const parsed = toDeviceId(value);
    if (parsed === undefined || seen.has(parsed)) continue;
    seen.add(parsed);
    out.push(parsed);
  }
  return out;
}

function normalizeIso(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const timestamp = Date.parse(raw.trim());
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

/** 空筛选（全部默认值）。 */
export function emptyFilters(): MessagesUrlState {
  return {
    senders: [],
    deviceIds: [],
    sort: DEFAULT_SORT,
    order: DEFAULT_ORDER,
    hasCode: false,
  };
}

/**
 * 归一化：非法值丢弃、数组去重、时间三种模式互斥、默认排序补齐。
 * `buildSearchParams`、`parseFilters`、`toApiQuery` 全部以它为准，保证往返一致。
 */
export function normalizeFilters(input?: MessagesUrlInput | null): MessagesUrlState {
  const source: MessagesUrlInput = input ?? {};
  const range = oneOf(TIME_RANGE_PRESETS, source.range);
  const customFrom = range ? undefined : normalizeIso(source.from);
  const customTo = range ? undefined : normalizeIso(source.to);
  const [from, to] = orderWindow(customFrom, customTo);
  return {
    q: normalizeText(source.q),
    senders: uniqueStrings(source.senders),
    deviceIds: uniqueNumbers(source.deviceIds),
    range,
    from,
    to,
    sort: oneOf(SORT_FIELDS, source.sort) ?? DEFAULT_SORT,
    order: oneOf(SORT_ORDERS, source.order) ?? DEFAULT_ORDER,
    hasCode: source.hasCode === true,
    kind: oneOf(KIND_FILTERS, source.kind),
  };
}

function orderWindow(from?: string, to?: string): [string | undefined, string | undefined] {
  if (from && to && Date.parse(from) > Date.parse(to)) return [to, from];
  return [from, to];
}

function isTruthyFlag(raw: string | null): boolean {
  if (!raw) return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

/** URLSearchParams -> 规范化状态。 */
export function parseFilters(params: URLSearchParams): MessagesUrlState {
  return normalizeFilters({
    q: params.get(FILTER_PARAM.q),
    senders: params.getAll(FILTER_PARAM.senders),
    deviceIds: params.getAll(FILTER_PARAM.deviceIds),
    range: params.get(FILTER_PARAM.range),
    from: params.get(FILTER_PARAM.from),
    to: params.get(FILTER_PARAM.to),
    sort: params.get(FILTER_PARAM.sort),
    order: params.get(FILTER_PARAM.order),
    hasCode: isTruthyFlag(params.get(FILTER_PARAM.hasCode)),
    kind: params.get(FILTER_PARAM.kind),
  });
}

/** 规范化状态 -> URLSearchParams（默认值不落 URL，顺序稳定）。 */
export function buildSearchParams(input?: MessagesUrlInput | null): URLSearchParams {
  const state = normalizeFilters(input);
  const params = new URLSearchParams();
  if (state.q) params.set(FILTER_PARAM.q, state.q);
  for (const sender of state.senders) params.append(FILTER_PARAM.senders, sender);
  for (const id of state.deviceIds) params.append(FILTER_PARAM.deviceIds, String(id));
  if (state.range) params.set(FILTER_PARAM.range, state.range);
  if (state.from) params.set(FILTER_PARAM.from, state.from);
  if (state.to) params.set(FILTER_PARAM.to, state.to);
  if (state.sort !== DEFAULT_SORT) params.set(FILTER_PARAM.sort, state.sort);
  if (state.order !== DEFAULT_ORDER) params.set(FILTER_PARAM.order, state.order);
  if (state.hasCode) params.set(FILTER_PARAM.hasCode, '1');
  if (state.kind) params.set(FILTER_PARAM.kind, state.kind);
  return params;
}

/** 当前生效的时间窗口（闭区间；`to` 为当日 23:59:59.999）。 */
export interface TimeWindow {
  from?: string;
  to?: string;
}

function lastDaysWindow(now: Date, days: number): TimeWindow {
  const end = dayjs(now).endOf('day');
  const start = end.subtract(days - 1, 'day').startOf('day');
  return { from: start.toDate().toISOString(), to: end.toDate().toISOString() };
}

/** 把 `range` / `from`+`to` 解析成具体的时间窗口（本地时区日历语义）。 */
export function resolveTimeWindow(input?: MessagesUrlInput | null, now: Date = new Date()): TimeWindow {
  const state = normalizeFilters(input);
  if (state.range === 'today') {
    const start = dayjs(now).startOf('day');
    return { from: start.toDate().toISOString(), to: start.endOf('day').toDate().toISOString() };
  }
  if (state.range === '7d') return lastDaysWindow(now, 7);
  if (state.range === '30d') return lastDaysWindow(now, 30);
  const [from, to] = orderWindow(state.from, state.to);
  return { from, to };
}

export interface ApiQueryOptions {
  /** 测试注入的「现在」 */
  now?: Date;
  /** 每页条数；传 `null` 表示不带 limit（facets / 导出用） */
  limit?: number | null;
  /** 追加参数（如 `cursor`、`format`），undefined 会被忽略 */
  extra?: Query;
}

/**
 * 规范化状态 -> `api.get` 的 query。
 * `to` 在这里 +1ms：前端闭区间 -> 后端半开区间 `[from, to)`。
 */
export function toApiQuery(input?: MessagesUrlInput | null, options: ApiQueryOptions = {}): Query {
  const state = normalizeFilters(input);
  const window = resolveTimeWindow(state, options.now);
  const query: Query = {
    q: state.q,
    senders: state.senders.length ? state.senders : undefined,
    device_ids: state.deviceIds.length ? state.deviceIds : undefined,
    kind: state.kind,
    has_code: state.hasCode ? true : undefined,
    from: window.from ? new Date(Date.parse(window.from)).toISOString() : undefined,
    to: window.to ? new Date(Date.parse(window.to) + 1).toISOString() : undefined,
    sort: state.sort,
    order: state.order,
    limit: options.limit === null ? undefined : options.limit ?? PAGE_SIZE,
  };
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    if (value !== undefined && value !== null) query[key] = value;
  }
  return query;
}

/**
 * 当前条件计数（用于徽标）：关键词、发送者、设备、时间、has_code、类型。
 * 排序与密度属于「展示偏好」，不计入。
 */
export function activeFilterCount(input?: MessagesUrlInput | null): number {
  const state = normalizeFilters(input);
  let count = 0;
  if (state.q) count += 1;
  if (state.senders.length) count += 1;
  if (state.deviceIds.length) count += 1;
  if (state.range || state.from || state.to) count += 1;
  if (state.hasCode) count += 1;
  if (state.kind) count += 1;
  return count;
}

/** `YYYY-MM-DD` -> 当天 00:00:00.000 的 ISO（本地时区）。 */
export function startOfDayIso(value: string | Date): string {
  return dayjs(value).startOf('day').toDate().toISOString();
}

/** `YYYY-MM-DD` -> 当天 23:59:59.999 的 ISO（本地时区）。 */
export function endOfDayIso(value: string | Date): string {
  return dayjs(value).endOf('day').toDate().toISOString();
}
