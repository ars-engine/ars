import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const newId = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

/**
 * Runs a command without blocking the server. Resolves true on exit 0, false on any other exit or
 * timeout; rejects only when `signal` aborts (the child is killed), so cancellation always propagates.
 */
export function runCommand(cmd: string, args: string[], o: { cwd?: string; timeout?: number; signal?: AbortSignal } = {}): Promise<boolean> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: o.cwd, timeout: o.timeout, signal: o.signal, maxBuffer: 64 * 1024 * 1024 }, (err) => {
      if (o.signal?.aborted) reject(new Error('Cancelled'));
      else resolve(!err);
    });
  });
}

export const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

export function countBy<T>(items: T[], key: (item: T) => string): [string, number][] {
  return [...groupBy(items, key)].map(([k, v]) => [k, v.length] as [string, number]).sort((a, b) => b[1] - a[1]);
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** 95% bootstrap confidence interval of the mean. */
export function bootstrapCI(values: number[], iterations = 1000): [number, number] {
  if (values.length < 2) return [mean(values), mean(values)];
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample = values.map(() => values[Math.floor(Math.random() * values.length)]);
    means.push(mean(sample));
  }
  return [percentile(means, 0.025), percentile(means, 0.975)];
}

export const unique = <T>(xs: T[]) => [...new Set(xs)];

/** "UserCard" | "user-card" | "userCard" | "user_card" | "lower" */
export function caseOf(name: string): string {
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
  if (/^[a-z][a-z0-9]*$/.test(name)) return 'lower';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase';
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return 'kebab-case';
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) return 'snake_case';
  if (/^[A-Z0-9]+(_[A-Z0-9]+)*$/.test(name)) return 'UPPER_CASE';
  return 'mixed';
}

/** Split identifiers into lowercase words: "useUserCard" -> ["use", "user", "card"]. */
export const words = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^a-zA-Z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';

export const daysAgo = (unixSeconds?: number) =>
  unixSeconds ? Math.round((Date.now() / 1000 - unixSeconds) / 86400) : undefined;
