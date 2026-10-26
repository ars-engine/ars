import { EventEmitter } from 'node:events';
import type { Job } from './core/entities.ts';
import { get, list, put } from './core/store.ts';
import { newId } from './core/util.ts';

/** Background jobs with live log streaming. Long work (analysis, benchmarks) never blocks the UI. */

export interface JobContext {
  log: (message: string) => void;
  progress: (fraction: number) => void;
  signal: AbortSignal;
}

const events = new EventEmitter();
events.setMaxListeners(100);
const live = new Map<string, { job: Job; abort: AbortController }>();

function persist(job: Job) {
  put('jobs', job);
}

export function startJob(kind: string, title: string, profileId: string | undefined, fn: (ctx: JobContext) => Promise<void>): Job {
  const job: Job = { id: newId('job'), kind, title, profileId, status: 'running', progress: 0, log: [], createdAt: Date.now() };
  const abort = new AbortController();
  live.set(job.id, { job, abort });
  persist(job);
  let lastSave = 0;
  const emit = () => {
    events.emit(job.id, job);
    events.emit('*', job);
    if (Date.now() - lastSave > 2000) {
      lastSave = Date.now();
      persist(job);
    }
  };
  const ctx: JobContext = {
    log: (message) => {
      job.log.push(`${new Date().toLocaleTimeString()}  ${message}`);
      if (job.log.length > 2000) job.log.splice(0, job.log.length - 2000);
      emit();
    },
    progress: (fraction) => {
      job.progress = Math.max(0, Math.min(1, fraction));
      emit();
    },
    signal: abort.signal,
  };
  void (async () => {
    try {
      await fn(ctx);
      job.status = 'done';
      job.progress = 1;
    } catch (err) {
      job.status = 'failed';
      job.error = (err as Error).message;
      ctx.log(`✗ ${job.error}`);
    } finally {
      job.finishedAt = Date.now();
      persist(job);
      events.emit(job.id, job);
      events.emit('*', job);
      live.delete(job.id);
    }
  })();
  return job;
}

export function getJob(id: string): Job | undefined {
  return live.get(id)?.job ?? get<Job>('jobs', id);
}

export function listJobs(limit = 30): Job[] {
  const stored = list<Job>('jobs').slice(-limit);
  return stored.map((j) => live.get(j.id)?.job ?? (j.status === 'running' ? { ...j, status: 'failed' as const, error: 'interrupted (server restarted)' } : j)).reverse();
}

export function cancelJob(id: string): void {
  live.get(id)?.abort.abort();
}

/** Subscribe to one job (or '*' for all). Returns an unsubscribe function. */
export function onJob(id: string, listener: (job: Job) => void): () => void {
  events.on(id, listener);
  return () => events.off(id, listener);
}
