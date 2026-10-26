import { useEffect, useState } from 'react';
import type { Convention } from '@ars/engine';
import { api, pct, useAction, useApi } from '../api';
import { ConventionDetail } from '../ConventionDetail';
import type { ProfileData } from '../ProfileWorkspace';
import { Badge, Empty, ErrorNote, LayerChip, Section } from '../ui';

interface ReviewData {
  queue: Convention[];
  all: Convention[];
  accuracy: { agreed: number; decided: number; accuracy: number | null };
}

const HINT_LABEL = { 'likely-legacy': 'older than the rest: likely old code', 'likely-intentional': 'recent: likely intentional', unknown: 'no git history' } as const;

function ExceptionQuestion({ c, decide }: { c: Convention; decide: (file: string, decision: 'intentional' | 'legacy') => void }) {
  if (!c.exceptions.length) return null;
  const open = c.exceptions.filter((e) => !e.decision).length;
  return (
    <div className="card pad stack" style={{ borderColor: open ? 'var(--warn)' : undefined }}>
      <div className="row">
        <h3>{c.exceptions.length} {c.exceptions.length === 1 ? 'file does' : 'files do'} it differently. Intentional, or old code?</h3>
      </div>
      <p className="tiny muted">Intentional exceptions are kept as allowed exceptions in the skill. Old code is ignored so agents never copy it.</p>
      <div className="row"><button className="btn sm" onClick={() => decide('*', 'intentional')}>All intentional <span className="kbd">I</span></button><button className="btn sm" onClick={() => decide('*', 'legacy')}>All old code <span className="kbd">L</span></button></div>
      <div className="col" style={{ gap: 0, maxHeight: 260, overflow: 'auto' }}>
        {c.exceptions.map((e) => (
          <div key={e.file + e.line} className="col small" style={{ gap: 4, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <span className="mono ellipsis" title={`${e.file}:${e.line}`}>{e.file}:{e.line}</span>
            <div className="row wrap">
              <Badge tone={e.hint === 'likely-legacy' ? 'warn' : e.hint === 'likely-intentional' ? 'info' : undefined} title={e.ageDays !== undefined ? `last touched ${e.ageDays} days ago` : ''}>{HINT_LABEL[e.hint]}</Badge>
              <span className="right row">
                <button className={`btn sm ${e.decision === 'intentional' ? 'ok' : ''}`} onClick={() => decide(e.file, 'intentional')}>Intentional</button>
                <button className={`btn sm ${e.decision === 'legacy' ? 'bad' : ''}`} onClick={() => decide(e.file, 'legacy')}>Old code</button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewStage({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const review = useApi<ReviewData>(`/profiles/${id}/review`);
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const decide = useAction((body: Record<string, unknown>) => api(`/profiles/${id}/decisions`, body));
  const bulk = useAction(() => api<{ count: number }>(`/profiles/${id}/bulk-approve`, { minConfidence: 0.85 }));
  const queue = review.data?.queue ?? [];
  const c = queue[Math.min(index, queue.length - 1)];
  const bulkCount = queue.filter((x) => x.tier === 'enforced' && x.confidence >= 0.85).length;
  const act = (action: string, extra: Record<string, unknown> = {}) => c && decide.mutate({ conventionId: c.id, action, ...extra });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing !== null || (e.target as HTMLElement).tagName.match(/INPUT|TEXTAREA|SELECT/) || !c) return;
      const k = e.key.toLowerCase();
      if (k === 'j') setIndex((i) => Math.min(queue.length - 1, i + 1));
      if (k === 'k') setIndex((i) => Math.max(0, i - 1));
      if (k === 'a') act('approve');
      if (k === 'r') act('reject');
      if (k === 'e') setEditing(c.instruction);
      if (k === 'i' && c.exceptions.length) act('exception', { file: '*', exception: 'intentional' });
      if (k === 'l' && c.exceptions.length) act('exception', { file: '*', exception: 'legacy' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!review.data) return null;
  const { accuracy } = review.data;
  const decided = review.data.all.filter((x) => x.status !== 'pending' && !x.autoApproved).slice(-8).reverse();
  const isVoice = c && c.check.type === 'judgment' && c.example;

  return (
    <div className="stack-lg">
      <Section
        title="Review"
        hint="Most important and least certain first. Your decisions are the ground truth ARS is measured against."
        actions={<button className="btn" disabled={!bulkCount || bulk.isPending} onClick={() => bulk.mutate(undefined)} title="Approve deterministic (L1–L3) rules with ≥85% confidence">✓ Bulk-approve {bulkCount} high-confidence rules</button>}
      >
        <div className="row wrap small muted">
          <Badge tone="warn">{queue.length} need you</Badge>
          <span>ARS accuracy so far: <strong style={{ color: 'var(--text)' }}>{pct(accuracy.accuracy)}</strong> ({accuracy.agreed}/{accuracy.decided} proposals you agreed with; target {pct(data.profile.setup.thresholds.minReviewAccuracy)})</span>
          <span className="right"><span className="kbd">J</span>/<span className="kbd">K</span> move · <span className="kbd">A</span> approve · <span className="kbd">R</span> reject · <span className="kbd">E</span> edit</span>
        </div>
      </Section>
      <ErrorNote error={decide.error || bulk.error} />

      {!c ? (
        <Empty title="Inbox zero 🎉">Every convention has a decision. Generate a skill package in the Skills stage.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 6, maxHeight: '78vh', overflow: 'auto' }}>
            {queue.map((q, i) => (
              <div key={q.id} className={`list-item ${q.id === c.id ? 'sel' : ''}`} onClick={() => setIndex(i)}>
                <LayerChip layer={q.layer} />
                <span className="small ellipsis" style={{ flex: 1 }}>{q.title}</span>
                {q.exceptions.some((e) => !e.decision) && <Badge tone="warn">{q.exceptions.filter((e) => !e.decision).length}</Badge>}
              </div>
            ))}
            {!!decided.length && <div className="tiny faint" style={{ padding: '12px 10px 4px' }}>Recently decided</div>}
            {decided.map((q) => (
              <div key={q.id} className="list-item" onClick={() => decide.mutate({ conventionId: q.id, action: 'reopen' })} title="Click to reopen">
                <Badge tone={q.status === 'approved' ? 'ok' : 'bad'}>{q.status === 'approved' ? '✓' : '✕'}</Badge>
                <span className="small ellipsis faint">{q.title}</span>
              </div>
            ))}
          </div>

          <div className="card pad cq">
            <ConventionDetail profileId={id} c={c}>
              {editing !== null && (
                <div className="stack">
                  <textarea className="textarea" value={editing} onChange={(e) => setEditing(e.target.value)} autoFocus />
                  <div className="row">
                    <button className="btn primary sm" onClick={() => { act('edit', { instruction: editing }); setEditing(null); }}>Save instruction</button>
                    <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <ExceptionQuestion c={c} decide={(file, exception) => act('exception', { file, exception })} />
              {isVoice ? (
                <div className="card pad stack" style={{ borderColor: 'var(--accent)' }}>
                  <h3>Does this read like you?</h3>
                  <p className="tiny muted">Your answer approves or rejects the rule and calibrates the judge that scores it.</p>
                  <div className="row">
                    <button className="btn ok" onClick={() => act('voice', { vote: 'yes' })}>Yes, that's me</button>
                    <button className="btn bad" onClick={() => act('voice', { vote: 'no' })}>No, not me</button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  <button className="btn ok" onClick={() => act('approve')}>✓ Approve <span className="kbd">A</span></button>
                  <button className="btn bad" onClick={() => act('reject')}>✕ Reject <span className="kbd">R</span></button>
                  <button className="btn" onClick={() => setEditing(c.instruction)}>✎ Edit <span className="kbd">E</span></button>
                  <button className="btn ghost right" onClick={() => setIndex((i) => Math.min(queue.length - 1, i + 1))}>Skip →</button>
                </div>
              )}
            </ConventionDetail>
          </div>
        </div>
      )}
    </div>
  );
}
