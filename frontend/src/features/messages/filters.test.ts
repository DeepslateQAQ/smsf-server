/**
 * Vitest 用例 1/2：关键词与筛选条件 <-> URL query 的双向转换。
 * 全部为纯函数断言，不渲染 DOM。
 */

import { describe, expect, it } from 'vitest';

import {
  activeFilterCount,
  buildSearchParams,
  emptyFilters,
  normalizeFilters,
  parseFilters,
  resolveTimeWindow,
  toApiQuery,
  type MessagesUrlInput,
} from './filters';

/** 一个「什么都打开了」的筛选组合。 */
const FULL: MessagesUrlInput = {
  q: '验证码 1234',
  senders: ['10086', '10690300'],
  deviceIds: [3, 7],
  range: 'today',
  sort: 'ingested_at',
  order: 'asc',
  hasCode: true,
  kind: 'sms',
};

describe('URL query 参数名清单', () => {
  it('关键词 -> q', () => {
    expect(buildSearchParams({ q: 'bank' }).toString()).toBe('q=bank');
  });

  it('发送者 -> senders（可重复）', () => {
    expect(buildSearchParams({ senders: ['10086', '106'] }).toString()).toBe(
      'senders=10086&senders=106',
    );
  });

  it('设备 -> device_ids（可重复）', () => {
    expect(buildSearchParams({ deviceIds: [3, 7] }).toString()).toBe('device_ids=3&device_ids=7');
  });

  it('时间快捷项 / 自定义区间 -> range / from+to', () => {
    expect(buildSearchParams({ range: '7d' }).toString()).toBe('range=7d');
    const from = new Date(2025, 2, 1).toISOString();
    const to = new Date(2025, 2, 31, 23, 59, 59, 999).toISOString();
    const params = buildSearchParams({ from, to });
    expect(params.get('from')).toBe(from);
    expect(params.get('to')).toBe(to);
  });

  it('排序 / has_code / 类型 -> sort / order / has_code=1 / kind', () => {
    expect(buildSearchParams({ sort: 'ingested_at', order: 'asc' }).toString()).toBe(
      'sort=ingested_at&order=asc',
    );
    expect(buildSearchParams({ hasCode: true }).toString()).toBe('has_code=1');
    expect(buildSearchParams({ kind: 'call' }).toString()).toBe('kind=call');
  });

  it('默认值不落 URL：全部清空后 query 为空', () => {
    expect(buildSearchParams(emptyFilters()).toString()).toBe('');
    expect(buildSearchParams({ sort: 'received_at', order: 'desc', hasCode: false }).toString()).toBe('');
  });
});

describe('buildSearchParams -> parseFilters 往返一致', () => {
  it('完整条件往返后与归一化状态完全相同', () => {
    const expected = normalizeFilters(FULL);
    expect(parseFilters(buildSearchParams(FULL))).toEqual(expected);
  });

  it('空条件往返后仍是空条件', () => {
    expect(parseFilters(buildSearchParams(emptyFilters()))).toEqual(normalizeFilters(emptyFilters()));
  });

  it('自定义区间往返一致', () => {
    for (const input of [
      { from: new Date(2025, 0, 2).toISOString(), to: new Date(2025, 0, 9, 23, 59, 59, 999).toISOString() },
      { range: '30d' },
    ] satisfies MessagesUrlInput[]) {
      expect(parseFilters(buildSearchParams(input))).toEqual(normalizeFilters(input));
    }
  });

  it('URL 里的脏值被丢弃或归一', () => {
    const params = new URLSearchParams(
      'q=%20%20&senders=%20&device_ids=abc&device_ids=4&device_ids=4&sort=drop_table&order=sideways&kind=email&range=yesterday&has_code=maybe&from=not-a-date',
    );
    expect(parseFilters(params)).toEqual({
      q: undefined,
      senders: [],
      deviceIds: [4],
      range: undefined,
      from: undefined,
      to: undefined,
      sort: 'received_at',
      order: 'desc',
      hasCode: false,
      kind: undefined,
    });
  });

  it('has_code 兼容 true/1；range 与自定义区间互斥（range 优先）', () => {
    expect(parseFilters(new URLSearchParams('has_code=true')).hasCode).toBe(true);
    expect(parseFilters(new URLSearchParams('has_code=1')).hasCode).toBe(true);
    const state = parseFilters(new URLSearchParams('range=today&from=2025-01-01T00:00:00.000Z'));
    expect(state.range).toBe('today');
    expect(state.from).toBeUndefined();
  });
});

describe('时间窗口 -> 后端半开区间 [from, to)', () => {
  const NOW = new Date(2025, 4, 17, 13, 45, 30);

  it('今天：本地 00:00:00 到 23:59:59.999', () => {
    const window = resolveTimeWindow({ range: 'today' }, NOW);
    expect(window.from).toBe(new Date(2025, 4, 17, 0, 0, 0, 0).toISOString());
    expect(window.to).toBe(new Date(2025, 4, 17, 23, 59, 59, 999).toISOString());
  });

  it('近 7 天：含今天共 7 个自然日', () => {
    const window = resolveTimeWindow({ range: '7d' }, NOW);
    expect(window.from).toBe(new Date(2025, 4, 11, 0, 0, 0, 0).toISOString());
    expect(window.to).toBe(new Date(2025, 4, 17, 23, 59, 59, 999).toISOString());
  });

  it('自定义整月区间：发给后端的 to 恰好是下月 1 日 00:00（不会重复计数）', () => {
    const from = new Date(2025, 2, 1, 0, 0, 0, 0).toISOString();
    const to = new Date(2025, 2, 31, 23, 59, 59, 999).toISOString();
    const query = toApiQuery({ from, to });
    expect(query.from).toBe(from);
    expect(query.to).toBe(new Date(2025, 3, 1, 0, 0, 0, 0).toISOString());
  });

  it('自定义区间：to 是闭区间末尾 +1ms', () => {
    const to = new Date(2025, 2, 31, 23, 59, 59, 999).toISOString();
    const query = toApiQuery({ from: new Date(2025, 2, 1).toISOString(), to });
    expect(query.to).toBe(new Date(2025, 3, 1, 0, 0, 0, 0).toISOString());
  });

  it('没有时间条件时不传 from/to', () => {
    const query = toApiQuery(emptyFilters());
    expect(query.from).toBeUndefined();
    expect(query.to).toBeUndefined();
  });
});

describe('toApiQuery 与条件计数', () => {
  it('把状态映射成后端参数，且 has_code 关闭时不传', () => {
    const query = toApiQuery(FULL, { limit: 20 });
    expect(query).toMatchObject({
      q: '验证码 1234',
      senders: ['10086', '10690300'],
      device_ids: [3, 7],
      kind: 'sms',
      has_code: true,
      sort: 'ingested_at',
      order: 'asc',
      limit: 20,
    });
    expect(toApiQuery(emptyFilters()).has_code).toBeUndefined();
  });

  it('limit 默认 PAGE_SIZE，extra 可追加 cursor', () => {
    expect(toApiQuery(emptyFilters()).limit).toBe(50);
    expect(toApiQuery(emptyFilters(), { extra: { cursor: 'abc' } }).cursor).toBe('abc');
  });

  it('条件计数：关键词/发送者/设备/时间/has_code/类型 各算 1，排序不算', () => {
    expect(activeFilterCount(emptyFilters())).toBe(0);
    expect(activeFilterCount({ sort: 'ingested_at', order: 'asc' })).toBe(0);
    expect(activeFilterCount(FULL)).toBe(6);
    expect(activeFilterCount({ q: 'x', range: 'today', senders: ['a'] })).toBe(3);
  });
});
