import type { Check, Value } from '../core/types.ts';

/** Does one observed value satisfy a feature check? Shared by miner, checker and self-test. */
export function matchesFeature(check: Extract<Check, { type: 'feature' }>, value: Value): boolean {
  switch (check.kind) {
    case 'categorical':
      return value === check.expected;
    case 'oneOf':
      return typeof value === 'string' && check.expected.includes(value);
    case 'max':
      return typeof value === 'number' && value <= check.expected;
    case 'order':
      return Array.isArray(value) && respectsOrder(value, check.expected);
  }
}

/**
 * Compile a pattern rule's regex. The regex comes from LLM output, which repo text can steer, and
 * runs on the server's event loop, so refuse long patterns and nested quantifiers such as (a+)+
 * that can backtrack for minutes. Returns undefined for anything refused or invalid.
 */
export function patternRegex(source: string): RegExp | undefined {
  if (source.length > 300) return undefined;
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{]/.test(source) || /\\\d/.test(source)) return undefined;
  try {
    return new RegExp(source, 'm');
  } catch {
    return undefined;
  }
}

/** True when the sequence never places a later canonical step before an earlier one. */
export function respectsOrder(seq: string[], canonical: string[]): boolean {
  const ranks = seq.map((s) => canonical.indexOf(s)).filter((r) => r >= 0);
  return ranks.every((r, i) => i === 0 || r >= ranks[i - 1]);
}

/** Canonical order: steps sorted by their average relative position across sequences. */
export function canonicalOrder(seqs: string[][]): string[] {
  const pos = new Map<string, number[]>();
  for (const seq of seqs) {
    seq.forEach((s, i) => pos.set(s, [...(pos.get(s) ?? []), seq.length > 1 ? i / (seq.length - 1) : 0]));
  }
  return [...pos]
    .filter(([, ps]) => ps.length >= Math.max(2, seqs.length * 0.1))
    .map(([s, ps]) => [s, ps.reduce((a, b) => a + b, 0) / ps.length] as const)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
}
