/**
 * 正文摘要与高亮（纯函数）：摘要里的命中关键词与验证码数字用 `<mark>` 标出。
 */

export interface HighlightRange {
  start: number;
  end: number;
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

export interface HighlightOptions {
  caseSensitive?: boolean;
}

function mergeRanges(ranges: HighlightRange[]): HighlightRange[] {
  if (ranges.length < 2) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** 所有命中片段（大小写不敏感，重叠区间会合并）。 */
export function findHighlightRanges(
  text: string,
  terms: readonly (string | null | undefined)[],
  options: HighlightOptions = {},
): HighlightRange[] {
  if (!text) return [];
  const caseSensitive = options.caseSensitive === true;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const ranges: HighlightRange[] = [];
  for (const term of terms) {
    if (typeof term !== 'string') continue;
    const needle = (caseSensitive ? term : term.toLowerCase()).trim();
    if (!needle) continue;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      ranges.push({ start: index, end: index + needle.length });
      index = haystack.indexOf(needle, index + 1);
    }
  }
  return mergeRanges(ranges);
}

/** 切成 `match` / 非 `match` 的连续片段，供 `<mark>` 渲染。 */
export function splitHighlighted(
  text: string,
  terms: readonly (string | null | undefined)[],
  options: HighlightOptions = {},
): HighlightSegment[] {
  const ranges = findHighlightRanges(text, terms, options);
  if (!ranges.length) return text ? [{ text, match: false }] : [];
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), match: false });
    segments.push({ text: text.slice(range.start, range.end), match: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/** 压掉换行与连续空白，超长时截断并补省略号。 */
export function summarizeText(text: string | null | undefined, maxLength = 240): string {
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/**
 * 需要高亮的词：关键词（整串 + 空格分词）与识别出的验证码。
 * 顺序稳定（用于 memo 依赖）。
 */
export function buildHighlightTerms(q?: string | null, code?: string | null): string[] {
  const terms: string[] = [];
  const push = (value: string | null | undefined): void => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed && !terms.includes(trimmed)) terms.push(trimmed);
  };
  if (q) {
    for (const token of q.split(/\s+/)) push(token);
    push(q);
  }
  push(code);
  return terms;
}
