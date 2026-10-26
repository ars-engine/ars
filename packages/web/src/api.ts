import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

/** One fetch helper + two hooks. Every screen talks to the engine through these. */

export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

export function useApi<T>(path: string | null, opts: Partial<UseQueryOptions<T>> = {}) {
  return useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path, ...opts });
}

/** Mutation that refreshes every query afterwards. Local app: correctness beats cleverness. */
export function useAction<I, O>(fn: (input: I) => Promise<O>, onDone?: (out: O) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (out) => {
      void qc.invalidateQueries();
      onDone?.(out);
    },
  });
}

export const pct = (x: number | null | undefined, digits = 0) => (x === null || x === undefined || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(digits)}%`);
export const money = (x: number | undefined) => (x === undefined ? '—' : `$${x.toFixed(2)}`);
export const ago = (ts?: number) => {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
};
