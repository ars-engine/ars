import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Job } from '@ars/engine';
import { api, openStream, useApi } from './api';
import { Badge, Bar, Spinner } from './ui';

/** Live job streaming (server-sent events) and the global job tray. */

export function useJob(jobId?: string | null): Job | undefined {
  const [job, setJob] = useState<Job>();
  const qc = useQueryClient();
  useEffect(() => {
    if (!jobId) return;
    return openStream(`/jobs/${jobId}/stream`, (data, close) => {
      const next = JSON.parse(data) as Job;
      setJob(next);
      if (next.status !== 'running') {
        close();
        void qc.invalidateQueries();
      }
    });
  }, [jobId, qc]);
  return job;
}

export function JobLog({ jobId, compact }: { jobId?: string | null; compact?: boolean }) {
  const job = useJob(jobId);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [job?.log.length]);
  if (!jobId) return null;
  if (!job) return <div className="row muted"><Spinner /> connecting…</div>;
  return (
    <div className="col">
      <div className="row">
        {job.status === 'running' ? <Spinner /> : <Badge tone={job.status === 'done' ? 'ok' : 'bad'}>{job.status}</Badge>}
        <strong className="ellipsis">{job.title}</strong>
        <span className="right tiny muted">{Math.round(job.progress * 100)}%</span>
        {job.status === 'running' && <button className="btn sm ghost" onClick={() => api(`/jobs/${job.id}/cancel`, {})}>Cancel</button>}
      </div>
      <Bar value={job.progress} />
      <div ref={ref} className="log" style={compact ? { maxHeight: 180 } : undefined}>{job.log.join('\n') || 'Starting…'}</div>
      {job.error && <div className="banner bad">⚠ {job.error}</div>}
    </div>
  );
}

/** Global background-job tray; also refreshes data whenever any job finishes. */
export function JobTray() {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const jobs = useApi<Job[]>('/jobs', { refetchInterval: 4000 });
  const qc = useQueryClient();
  useEffect(() => {
    return openStream('/events', (data) => {
      const job = JSON.parse(data) as Job;
      if (job.status !== 'running') void qc.invalidateQueries();
    }, true);
  }, [qc]);
  const running = (jobs.data ?? []).filter((j) => j.status === 'running');
  return (
    <>
      <button className="btn tray-button" onClick={() => setOpen(!open)}>
        {running.length ? <Spinner /> : '◷'} {running.length ? `${running.length} running` : 'Jobs'}
      </button>
      {open && (
        <div className="card tray">
          <div className="card-head"><h3>Background jobs</h3><button className="btn sm ghost right" onClick={() => setOpen(false)}>✕</button></div>
          <div style={{ overflow: 'auto', padding: 10 }} className="col">
            {(jobs.data ?? []).slice(0, 12).map((j) => (
              <div key={j.id} className="col" style={{ gap: 6 }}>
                <div className="list-item" onClick={() => setFocus(focus === j.id ? null : j.id)}>
                  {j.status === 'running' ? <Spinner /> : <Badge tone={j.status === 'done' ? 'ok' : 'bad'}>{j.status}</Badge>}
                  <span className="ellipsis small">{j.title}</span>
                  <span className="right tiny faint">{Math.round(j.progress * 100)}%</span>
                </div>
                {focus === j.id && <JobLog jobId={j.id} compact />}
              </div>
            ))}
            {!jobs.data?.length && <p className="muted small" style={{ padding: 10 }}>No jobs yet.</p>}
          </div>
        </div>
      )}
    </>
  );
}
