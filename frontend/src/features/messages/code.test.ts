/**
 * Vitest 用例 2/2：候选展开逻辑的 `primary + rest` 计算。
 * 纯函数断言，不渲染 DOM。
 */

import { describe, expect, it } from 'vitest';

import { normalizeCandidates, splitCodeCandidates } from './code';

const THREE = [
  { code: '111111', confidence: 60 },
  { code: '222222', confidence: 95 },
  { code: '333333', confidence: 80 },
];

describe('splitCodeCandidates —— primary + rest', () => {
  it('服务端选中的 code 作为 primary，其余按置信度倒序进入 rest', () => {
    const result = splitCodeCandidates(THREE, '111111');
    expect(result.primary).toEqual({ code: '111111', confidence: 60 });
    expect(result.rest.map((item) => item.code)).toEqual(['222222', '333333']);
    expect(result.total).toBe(3);
    expect(result.hasRest).toBe(true);
  });

  it('没有选中值时取置信度最高者为 primary', () => {
    const result = splitCodeCandidates(THREE, null);
    expect(result.primary).toEqual({ code: '222222', confidence: 95 });
    expect(result.rest.map((item) => item.code)).toEqual(['333333', '111111']);
  });

  it('单个候选：primary 有值但 rest 为空（不显示 +N）', () => {
    const result = splitCodeCandidates([{ code: '8888', confidence: 90 }], '8888');
    expect(result.primary).toEqual({ code: '8888', confidence: 90 });
    expect(result.rest).toEqual([]);
    expect(result.total).toBe(1);
    expect(result.hasRest).toBe(false);
  });

  it('去重（同码保留最高置信度）、丢弃空候选与脏数据', () => {
    const dirty = [
      { code: ' 1234 ', confidence: 30 },
      { code: '1234', confidence: 70 },
      { code: '', confidence: 99 },
      { code: '   ', confidence: 99 },
      null,
      undefined,
      { code: '5678', confidence: Number.NaN },
    ] as unknown as { code: string; confidence: number }[];
    const result = splitCodeCandidates(dirty, null);
    expect(result.primary).toEqual({ code: '1234', confidence: 70 });
    expect(result.rest).toEqual([{ code: '5678', confidence: 0 }]);
    expect(result.total).toBe(2);
  });

  it('同置信度保持服务端原始顺序（稳定排序）', () => {
    const flat = [
      { code: 'aaaa', confidence: 50 },
      { code: 'bbbb', confidence: 50 },
      { code: 'cccc', confidence: 50 },
    ];
    expect(splitCodeCandidates(flat, null).rest.map((item) => item.code)).toEqual(['bbbb', 'cccc']);
  });

  it('选中的 code 不在候选里时仍作为 primary，全部候选进入 rest', () => {
    const result = splitCodeCandidates(THREE, '999999');
    expect(result.primary).toEqual({ code: '999999', confidence: 0 });
    expect(result.rest).toHaveLength(3);
    expect(result.total).toBe(4);
  });

  it('完全没有候选也没有选中值：primary 为 null', () => {
    for (const input of [[], null, undefined]) {
      const result = splitCodeCandidates(input, null);
      expect(result.primary).toBeNull();
      expect(result.rest).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.hasRest).toBe(false);
    }
  });

  it('normalizeCandidates 与 splitCodeCandidates 的候选顺序一致', () => {
    expect(normalizeCandidates(THREE).map((item) => item.code)).toEqual(['222222', '333333', '111111']);
  });
});
