import { useState } from 'react';
import type { Experiment, FailureCategory, Job, Proposal } from '@ars/engine';
import { api, pct, useAction, useApi } from '../api';
import { JobLog } from '../jobs';
import type { ProfileData } from '../ProfileWorkspace';
import { Badge, Drawer, Empty, ErrorNote, LayerChip, Section } from '../ui';
import type { ConventionsData } from './Signature';

type ProposalRow = Proposal & { changeSummary: string };

const LANES: [FailureCategory, string, string][] = [
  ['checker', 'Checker wrong', 'The rule checker itself misses violations or flags clean code. Fix: score it with the rubric judge.'],
  ['learned', 'Learned wrong', 'ARS inferred the wrong convention. Fix: remove the rule.'],
  ['unclear', 'Skill unclear', 'Loaded but misread; an explicit reminder fixed it. Fix: rewrite the instruction.'],
  ['not-loaded', 'Not loaded', 'The agent never opened the skill. Fix: sharpen its trigger description.'],
  ['ignored', 'Agent ignores it', 'Loaded and clear, still violated. Fix: enforce it in the edit hook.'],
];

const STATUS_TONE = { proposed: undefined, gating: 'warn', ready: 'ok', 'failed-gate': 'bad', promoted: 'accent', dismissed: undefined } as const;

function Gate({ p, title }: { p: ProposalRow; title: (id: string) => string }) {
  const g = p.gate;
  if (!g) return null;
  const line = (label: string, before?: number, after?: number, ok?: boolean) => (
    <div className="row small"><span style={{ width: 200 }} className="muted">{label}</span><span>{pct(before)}</span><span className="faint">→</span><strong>{pct(after)}</strong>{ok !== undefined && <Badge tone={ok ? 'ok' : 'bad'}>{ok ? 'ok' : 'fail'}</Badge>}</div>
  );
  return (
    <div className="card pad stack" style={{ borderColor: g.passed ? 'var(--ok)' : 'var(--bad)' }}>
      <div className="row"><h3>Promotion gate</h3><Badge tone={g.passed ? 'ok' : 'bad'}>{g.passed ? 'PASSED' : 'FAILED'}</Badge></div>
      {line('Target rule adherence', g.targetBefore, g.targetAfter)}
      {line('Held-out adherence', g.heldOutBefore, g.heldOutAfter, g.heldOutAfter >= g.heldOutBefore - 0.02)}
      {g.functionalBefore !== undefined && line('Functional correctness', g.functionalBefore, g.functionalAfter)}
      <div className="small"><span className="muted">Regressions on other rules: </span>{g.regressions.length ? '' : <Badge tone="ok">none</Badge>}</div>
      {g.regressions.map((r) => <div key={r.conventionId} className="row small"><Badge tone="bad">↓</Badge>{title(r.conventionId)} {pct(r.before)} → {pct(r.after)}</div>)}
      {g.notes.map((n) => <p key={n} className="tiny muted">{n}</p>)}
    </div>
  );
}

function ProposalDrawer({ p, data, onClose, title }: { p: ProposalRow; data: ProfileData; onClose: () => void; title: (id: string) => string }) {
  const jobs = useApi<Job[]>('/jobs', { refetchInterval: 3000 });
  const gate = useAction(() => api<{ jobId: string }>(`/proposals/${p.id}/gate`, {}));
  const promote = useAction(() => api(`/proposals/${p.id}/promote`, {}), onClose);
  const dismiss = useAction(() => api(`/proposals/${p.id}/dismiss`, {}), onClose);
  const recat = useAction((category: FailureCategory) => api(`/proposals/${p.id}/recategorize`, { category }));
  const gateJob = gate.data?.jobId ?? jobs.data?.find((j) => j.kind === 'gate' && j.status === 'running' && j.title.includes(p.title))?.id;
  const architectural = p.layer === 'L5';
  return (
    <Drawer title={p.title} onClose={onClose}>
      <div className="stack">
        <div className="row wrap"><LayerChip layer={p.layer} /><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge><Badge tone="warn">{pct(p.rate)} adherence in ARS runs</Badge><Badge>{p.failingRuns.length} failing runs</Badge></div>
        <div className="card pad stack">
          <h3>Diagnosis</h3>
          <p>{p.diagnosis}</p>
          <div className="row small"><span className="muted">Not right?</span>
            <select className="select" style={{ width: 230, height: 28 }} value={p.category} onChange={(e) => recat.mutate(e.target.value as FailureCategory)}>
              {LANES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
        </div>
        <div className="card pad stack">
          <h3>Sample violations</h3>
          {p.sampleViolations.map((v, i) => <div key={i} className="row small mono"><span className="ellipsis">{v.file}:{v.line}</span><span className="right faint">{v.value}</span></div>)}
        </div>
        <div className="card pad stack" style={{ borderColor: 'var(--accent)' }}>
          <h3>Proposed change</h3>
          <p>{p.changeSummary}</p>
          <p className="tiny muted">This creates a candidate skill version. It is promoted only if it improves the failing rule without regressions, on dev and held-out tasks.</p>
        </div>
        <Gate p={p} title={title} />
        {gateJob && <JobLog jobId={gateJob} />}
        <ErrorNote error={gate.error || promote.error || dismiss.error || recat.error} />
        <div className="row">
          <button className="btn primary" disabled={p.status === 'gating' || p.status === 'promoted' || !data.llm || gate.isPending} onClick={() => gate.mutate(undefined)}>{p.gate ? 'Re-run gate' : 'Run gate'} ▶</button>
          <button className="btn ok" disabled={!p.gate?.passed || p.status === 'promoted'} onClick={() => promote.mutate(undefined)} title="Publishes the candidate version">✓ Promote</button>
          {architectural && <span className="tiny muted">Architectural rule: promotion requires your approval.</span>}
          <button className="btn ghost right" disabled={p.status === 'promoted'} onClick={() => dismiss.mutate(undefined)}>Dismiss</button>
        </div>
      </div>
    </Drawer>
  );
}

export function ImproveStage({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const proposals = useApi<ProposalRow[]>(`/profiles/${id}/proposals`, { refetchInterval: 5000 });
  const experiments = useApi<Experiment[]>(`/profiles/${id}/experiments`);
  const conv = useApi<ConventionsData>(`/profiles/${id}/conventions`);
  const jobs = useApi<Job[]>('/jobs', { refetchInterval: 3000 });
  const [exp, setExp] = useState('');
  const [open, setOpen] = useState<string>();
  const diagnose = useAction(() => api<{ jobId: string }>(`/profiles/${id}/diagnose`, { experimentId: exp }));
  const candidates = (experiments.data ?? []).filter((e) => e.status === 'done' && e.config.conditions.some((c) => c.kind === 'ars') && ['lab', 'playground'].includes(e.config.purpose));
  const running = diagnose.data?.jobId ?? jobs.data?.find((j) => j.kind === 'diagnose' && j.status === 'running' && j.profileId === id)?.id;
  const title = (cid: string) => conv.data?.conventions.find((c) => c.id === cid)?.title ?? cid;
  const visible = (proposals.data ?? []).filter((p) => p.status !== 'dismissed');
  const openP = visible.find((p) => p.id === open);

  return (
    <div className="stack-lg">
      <Section title="Improve" hint="Failures are diagnosed from evidence. Fixes are proposed, gated, and promoted only when results improve.">
        <div className="card pad row wrap">
          <select className="select" style={{ maxWidth: 420 }} value={exp} onChange={(e) => setExp(e.target.value)}>
            <option value="">Choose a finished experiment to diagnose…</option>
            {candidates.map((e) => <option key={e.id} value={e.id}>{e.config.purpose === 'playground' ? `Playground: ${(e.config.prompt ?? '').slice(0, 40)}` : `${e.config.tests.join('+')} · ${e.config.conditions.map((c) => c.label).join('/')}`} · {new Date(e.createdAt!).toLocaleString()}</option>)}
          </select>
          <button className="btn primary" disabled={!exp || diagnose.isPending} onClick={() => diagnose.mutate(undefined)}>Diagnose failures</button>
          <span className="tiny muted">Rules under 90% adherence in ARS runs become proposals. Up to 2 counterfactual reruns separate "unclear" from "ignored".</span>
        </div>
        <ErrorNote error={diagnose.error} />
      </Section>
      {running && <div className="card pad"><JobLog jobId={running} /></div>}
      {!visible.length && !running ? (
        <Empty title="Nothing to improve yet">Run an experiment in the Lab, then diagnose it here.</Empty>
      ) : (
        <div className="board">
          {LANES.map(([cat, name, desc]) => (
            <div key={cat} className="lane">
              <div className="lane-head"><div className="row"><h3>{name}</h3><Badge>{visible.filter((p) => p.category === cat).length}</Badge></div><p>{desc}</p></div>
              {visible.filter((p) => p.category === cat).map((p) => (
                <div key={p.id} className="ticket" onClick={() => setOpen(p.id)}>
                  <div className="row"><LayerChip layer={p.layer} /><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge><span className="right tiny warn" style={{ color: 'var(--warn)' }}>{pct(p.rate)}</span></div>
                  <div className="small" style={{ marginTop: 6 }}>{p.title}</div>
                  <div className="tiny muted" style={{ marginTop: 4 }}>{p.changeSummary}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {openP && <ProposalDrawer p={openP} data={data} title={title} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
