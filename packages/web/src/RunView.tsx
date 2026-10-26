import { useState } from 'react';
import type { Convention, Run } from '@ars/engine';
import { money, pct, useApi } from './api';
import { CodeView, DiffView } from './code';
import { Badge, Drawer, Tabs } from './ui';

/** Agent run inspection: generated files with violations, transcript, and reconstruction diff. */

export function useRunFile(runId: string, path?: string) {
  return useApi<{ text: string }>(path ? `/runs/${runId}/file?path=${encodeURIComponent(path)}` : null);
}

export function RunFiles({ run, conventions, height = 460 }: { run: Run; conventions?: Convention[]; height?: number }) {
  const files = (run.result?.files ?? []).filter((f) => /\.[cm]?[jt]sx?$|\.css$|\.json$/.test(f));
  const [file, setFile] = useState(files[0]);
  const content = useRunFile(run.id, file);
  const violations = run.result?.report.results.flatMap((r) => r.violations.filter((v) => v.file === file).map((v) => ({ ...v, id: r.conventionId }))) ?? [];
  const title = (id: string) => conventions?.find((c) => c.id === id)?.title ?? id;
  if (!files.length) return <div className="empty">The agent wrote no code files{run.error ? `: ${run.error}` : '.'}</div>;
  return (
    <div className="stack">
      <div className="row wrap">{files.map((f) => <button key={f} className={`btn sm ${f === file ? 'primary' : ''}`} onClick={() => setFile(f)}>{f.split('/').pop()}</button>)}</div>
      {content.data && <CodeView text={content.data.text} path={file!} bad={violations.map((v) => v.line)} height={height} />}
      {violations.length > 0 && (
        <div className="card pad col" style={{ gap: 6 }}>
          {violations.map((v, i) => <div key={i} className="row small"><Badge tone="bad">line {v.line}</Badge><span>{title(v.id)}</span><span className="faint tiny right">{v.value}</span></div>)}
        </div>
      )}
    </div>
  );
}

function Transcript({ runId }: { runId: string }) {
  const items = useApi<{ kind: string; text?: string; name?: string; input?: string }[]>(`/runs/${runId}/transcript`);
  return (
    <div className="log" style={{ maxHeight: '70vh' }}>
      {items.data?.map((it, i) => (
        <div key={i} style={{ marginBottom: 6, color: it.kind === 'tool' ? '#8fb3ff' : it.kind === 'result' ? '#3ecf8e' : undefined }}>
          {it.kind === 'tool' ? `→ ${it.name} ${it.input}` : it.text}
        </div>
      ))}
      {!items.data?.length && 'No transcript.'}
    </div>
  );
}

function ReconstructionDiff({ run }: { run: Run }) {
  const original = useApi<{ text: string }>(`/runs/${run.id}/original`);
  const generated = useRunFile(run.id, run.taskId);
  if (!original.data || !generated.data) return <div className="muted">The agent did not create {run.taskId}.</div>;
  return <DiffView a={original.data.text} b={generated.data.text} path={run.taskId} labels={['your original', 'agent reconstruction']} />;
}

export function RunDrawer({ run, conventions, onClose }: { run: Run; conventions?: Convention[]; onClose: () => void }) {
  const [tab, setTab] = useState<'files' | 'diff' | 'transcript'>(run.test === 'T1' ? 'diff' : 'files');
  const r = run.result;
  return (
    <Drawer title={`${run.test} · ${run.taskId} · ${run.condition} #${run.rep + 1}`} onClose={onClose}>
      <div className="stack">
        <div className="row wrap">
          <Badge tone={run.status === 'done' ? 'ok' : run.status === 'failed' ? 'bad' : 'warn'}>{run.status}</Badge>
          {r && <Badge tone="accent">adherence {pct(r.report.adherence)}</Badge>}
          {r?.functional && <Badge tone={r.functional.score >= 0.8 ? 'ok' : 'warn'}>tests {r.functional.passed}/{r.functional.total}{r.functional.typecheck ? ' · tsc ✓' : ' · tsc ✗'}</Badge>}
          {r?.similarity && <Badge>style sim {pct(r.similarity.style)} · AST sim {pct(r.similarity.ast)}</Badge>}
          {r?.copy && <Badge tone={r.copy.copyRatio > 0.1 || r.copy.leakedTerms.length ? 'warn' : undefined} title={r.copy.leakedTerms.join(', ')}>copied blocks {pct(r.copy.copyRatio)} · {r.copy.leakedTerms.length} leaked terms</Badge>}
          {r && <Badge>{money(r.usage.costUsd)} · {r.usage.turns} turns</Badge>}
          {r && <Badge tone={r.skillsLoaded.length ? 'info' : undefined}>skills loaded: {r.skillsLoaded.join(', ') || 'none'}</Badge>}
        </div>
        {run.error && <div className="banner warn">{run.error}</div>}
        <Tabs tabs={[...(run.test === 'T1' ? [['diff', 'Original vs reconstruction'] as ['diff', string]] : []), ['files', 'Generated files'], ['transcript', 'Transcript']]} value={tab} onChange={setTab} />
        {tab === 'files' && <RunFiles run={run} conventions={conventions} />}
        {tab === 'diff' && <ReconstructionDiff run={run} />}
        {tab === 'transcript' && <Transcript runId={run.id} />}
      </div>
    </Drawer>
  );
}
