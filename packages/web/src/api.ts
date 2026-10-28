import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

/** One fetch helper + two hooks. Every screen talks to the engine through these. */

/** The API's per-start session token. Refreshed after a 401, which means the server restarted. */
let session: Promise<string> | undefined;
function sessionToken(refresh = false): Promise<string> {
  if (refresh || !session) {
    session = fetch('/api/session')
      .then((r) => r.json() as Promise<{ token: string }>)
      .then((d) => d.token);
    session.catch(() => (session = undefined));
  }
  return session;
}

export async function api<T>(path: string, body?: unknown, method?: string, retried = false): Promise<T> {
  const m = method ?? (body === undefined ? 'GET' : 'POST');
  const res = await fetch(`/api${path}`, {
    method: m,
    headers: { 'x-ars-token': await sessionToken(retried), ...(m === 'GET' ? {} : { 'content-type': 'application/json' }) },
    body: m === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 401 && !retried) return api<T>(path, body, method, true);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data as T;
}

/**
 * Server-sent events with the session token in the URL (EventSource can't set headers).
 * With `reconnect`, a dropped stream reopens with a fresh token, as after a server restart.
 */
export function openStream(path: string, onJob: (data: string, close: () => void) => void, reconnect = false): () => void {
  let es: EventSource | undefined;
  let stopped = false;
  const stop = () => {
    stopped = true;
    es?.close();
  };
  const open = async (refresh: boolean) => {
    const token = await sessionToken(refresh).catch(() => undefined);
    if (stopped) return;
    if (!token) {
      if (reconnect) setTimeout(() => void open(true), 3000);
      return;
    }
    es = new EventSource(`/api${path}?token=${encodeURIComponent(token)}`);
    es.addEventListener('job', (e) => onJob((e as MessageEvent).data, stop));
    es.onerror = () => {
      es?.close();
      if (reconnect && !stopped) setTimeout(() => void open(true), 3000);
    };
  };
  void open(false);
  return stop;
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
