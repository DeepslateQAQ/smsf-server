/**
 * 验证码候选的纯计算：把 `code_candidates` 拆成「primary（大字展示）+ rest（「+N」展开列表）」。
 *
 * 规则：
 * - 丢弃空串候选；同一个 code 去重（保留最高置信度）。
 * - 排序：置信度倒序，同分保持服务端给的原始顺序（稳定）。
 * - primary：服务端选中的 `code` 优先（即使它不在候选里，也仍然作为 primary）；
 *   没有选中值时取置信度最高者。
 * - rest：其余候选，已排除 primary。
 */

export interface CodeCandidate {
  code: string;
  confidence: number;
}

export interface SplitCodeCandidates {
  /** 大字展示的验证码 */
  primary: CodeCandidate | null;
  /** 「+N」候选列表（不含 primary） */
  rest: CodeCandidate[];
  /** primary + rest 的总数 */
  total: number;
  hasRest: boolean;
}

function isCandidate(value: unknown): value is CodeCandidate {
  return typeof value === 'object' && value !== null && typeof (value as CodeCandidate).code === 'string';
}

/** 去重 + 清洗 + 按置信度倒序（稳定）。 */
export function normalizeCandidates(
  candidates: readonly CodeCandidate[] | null | undefined,
): CodeCandidate[] {
  if (!candidates?.length) return [];
  const best = new Map<string, CodeCandidate>();
  const order: string[] = [];
  for (const raw of candidates) {
    if (!isCandidate(raw)) continue;
    const code = raw.code.trim();
    if (!code) continue;
    const confidence = Number.isFinite(raw.confidence) ? Math.trunc(raw.confidence) : 0;
    const existing = best.get(code);
    if (!existing) {
      best.set(code, { code, confidence });
      order.push(code);
    } else if (confidence > existing.confidence) {
      best.set(code, { code, confidence });
    }
  }
  return order
    .map((code, index) => ({ candidate: best.get(code) as CodeCandidate, index }))
    .sort((a, b) => b.candidate.confidence - a.candidate.confidence || a.index - b.index)
    .map((entry) => entry.candidate);
}

/** `primary + rest`。 */
export function splitCodeCandidates(
  candidates: readonly CodeCandidate[] | null | undefined,
  selectedCode?: string | null,
): SplitCodeCandidates {
  const list = normalizeCandidates(candidates);
  const selected = typeof selectedCode === 'string' ? selectedCode.trim() : '';
  let primary: CodeCandidate | null = null;
  if (selected) {
    primary = list.find((item) => item.code === selected) ?? { code: selected, confidence: 0 };
  } else if (list.length > 0) {
    primary = list[0];
  }
  const rest = primary ? list.filter((item) => item.code !== primary.code) : [];
  return { primary, rest, total: (primary ? 1 : 0) + rest.length, hasRest: rest.length > 0 };
}
