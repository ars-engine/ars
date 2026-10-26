import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { Condition, Experiment, ExperimentConfig, FileInfo, HeldOutFile, Profile, Run, TestKind } from '@ars/engine';
import { ago, api, money, pct, useAction, useApi } from '../api';
import { CodeView } from '../code';
import { JobLog } from '../jobs';
import type { ProfileData } from '../ProfileWorkspace';
import { RunDrawer } from '../RunView';
import { Badge, Card, Empty, ErrorNote, LAYER_NAMES, Section, Tabs } from '../ui';
import type { ConventionsData } from './Signature';

interface Task {
  id: string;
  split: 'dev' | 'test';
  title: string;
}

const TESTS: [TestKind, string, string][] = [
  ['T1', 'Reconstruction', 'Re-implement your held-out files from a description and compare with your originals. The most direct "writes exactly like me" test.'],
  ['T2', 'Transfer', 'Build a new app in a different domain. Acceptance tests check it works; rules check it looks like yours.'],
  ['T3', 'Indistinguishability', 'A blind judge tries to tell generated files from your real ones. 100% means it cannot tell.'],
];

const CONDITIONS: [Condition['kind'], string][] = [['none', 'No skills'], ['generic', 'Generic React guide (length-matched)'], ['ars', 'Your ARS skills']];

// ── Setup (M0): thresholds, held-out files, tasks ─────────────────────
function Setup({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const setup = useApi<{ setup: Profile['setup']; tasks: Task[] }>(`/profiles/${id}/setup`);
  const files = useApi<FileInfo[]>(`/profiles/${id}/files`);
  const [filter, setFilter] = useState('');
  const save = useAction((patch: Partial<Profile['setup']>) => api(`/profiles/${id}/setup`, patch, 'PUT'));
  const remine = useAction(() => api(`/profiles/${id}/remine`, {}));
  if (!setup.data) return null;
  const s = setup.data.setup;
  const locked = !!s.lockedAt;
  const heldOut = new Set(s.heldOut.map((h) => h.path));
  const stale = data.stages.find((x) => x.id === 'signature')?.state === 'stale';
  const candidates = (files.data ?? []).filter((f) => ['component', 'hook', 'api', 'route', 'store', 'util'].includes(f.role) && !heldOut.has(f.path) && f.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 8);
  const setHeldOut = (list: HeldOutFile[]) => save.mutate({ heldOut: list });
  const thresholds: [keyof Profile['setup']['thresholds'], string][] = [
    ['minLift', 'Minimum adherence lift over the best baseline'], ['maxFunctionalDrop', 'Maximum functional-correctness drop'],
    ['minIndistinguishability', 'Minimum indistinguishability (T3)'], ['minReviewAccuracy', 'Minimum review accuracy (convention precision)'],
    ['regressionTolerance', 'Regression tolerance per rule (gate)'],
  ];

  return (
    <div className="stack-lg">
      <ErrorNote error={save.error || remine.error} />
      <div className="grid two">
        <Card title="Pass thresholds" actions={locked ? <Badge tone="info">🔒 locked {ago(s.lockedAt)}</Badge> : <Badge tone="warn">set these before the first run</Badge>}>
          <p className="tiny muted" style={{ marginBottom: 10 }}>Written down before any experiment runs, so results can't move the goalposts. They lock when the first experiment starts.</p>
          <div className="col">
            {thresholds.map(([k, label]) => (
              <div key={k} className="row small">
                <span style={{ flex: 1 }}>{label}</span>
                <input className="input" type="number" min={0} max={100} step={1} style={{ width: 80 }} disabled={locked} defaultValue={Math.round(s.thresholds[k] * 100)}
                  onBlur={(e) => save.mutate({ thresholds: { ...s.thresholds, [k]: Number(e.target.value) / 100 } })} />
                <span className="muted">%</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Transfer tasks (T2)">
          <p className="tiny muted" style={{ marginBottom: 10 }}>Different domains from your project. The improvement loop may only use <Badge>dev</Badge> tasks; reported results use held-out <Badge tone="accent">test</Badge> tasks.</p>
          <table className="table"><tbody>{setup.data.tasks.map((t) => <tr key={t.id}><td>{t.title}</td><td><Badge tone={t.split === 'test' ? 'accent' : undefined}>{t.split}</Badge></td></tr>)}</tbody></table>
        </Card>
      </div>

      <Card title="Held-out files (T1 reconstruction)" actions={stale && <button className="btn sm primary" onClick={() => remine.mutate(undefined)}>↻ Re-learn conventions without them</button>}>
        <p className="tiny muted" style={{ marginBottom: 10 }}>Hidden from learning, so the reconstruction test is fair. Changing them marks the signature stale until you re-learn.</p>
        {s.heldOut.map((h) => (
          <div key={h.path} className="row small" style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
            <Badge>{h.role}</Badge><span className="mono">{h.path}</span>
            <span className="faint tiny ellipsis" style={{ flex: 1 }} title={h.description}>{h.description}</span>
            <button className="btn sm ghost" onClick={() => setHeldOut(s.heldOut.filter((x) => x.path !== h.path))}>Remove</button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12 }}>
          <input className="input" placeholder="Find a file to hold out…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {filter && candidates.map((f) => (
          <div key={f.path} className="list-item" onClick={() => { setHeldOut([...s.heldOut, { path: f.path, role: f.role }]); setFilter(''); }}>
            <Badge>{f.role}</Badge><span className="mono small">{f.path}</span><span className="right tiny faint">{f.lines} lines</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Experiment builder ────────────────────────────────────────────────
function Builder({ data, onCreated }: { data: ProfileData; onCreated: (e: Experiment) => void }) {
  const id = data.profile.id;
  const models = useApi<{ models: { id: string; label: string }[] }>('/health');
  const [config, setConfig] = useState<ExperimentConfig>({
    purpose: 'lab', tests: ['T1', 'T2'], runs: 2, split: 'test', useJudge: true, maxBudgetUsd: 5, model: data.profile.setup.model,
    conditions: CONDITIONS.map(([kind]) => ({ label: kind, kind })),
  });
  const { data: cost } = useQuery({ queryKey: ['estimate', id, config], queryFn: () => api<{ runs: number; usd: number }>(`/profiles/${id}/estimate`, config) });
  const patch = (p: Partial<ExperimentConfig>) => setConfig({ ...config, ...p });
  const run = useAction((c: ExperimentConfig) => api<Experiment>(`/profiles/${id}/experiments`, c), onCreated);
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const kinds = config.conditions.map((c) => c.kind);
  const hasSkills = data.stages.find((s) => s.id === 'skills')?.state !== 'idle';

  return (
    <div className="card pad stack">
      <h3>New experiment</h3>
      <div className="grid three">
        {TESTS.map(([t, name, desc]) => (
          <label key={t} className={`check ${config.tests.includes(t) ? 'on' : ''}`}>
            <input type="checkbox" checked={config.tests.includes(t)} onChange={() => patch({ tests: toggle(config.tests, t) })} />
            <div><strong>{t} · {name}</strong><div className="tiny muted">{desc}</div></div>
          </label>
        ))}
      </div>
      <div className="row wrap">
        {CONDITIONS.map(([kind, label]) => (
          <label key={kind} className={`check ${kinds.includes(kind) ? 'on' : ''}`} style={{ padding: '6px 10px' }}>
            <input type="checkbox" checked={kinds.includes(kind)} onChange={() => patch({ conditions: kinds.includes(kind) ? config.conditions.filter((c) => c.kind !== kind) : [...config.conditions, { label: kind, kind }] })} />
            <span className="small">{label}</span>
          </label>
        ))}
      </div>
      <div className="row wrap">
        <label className="field">Repeats per task<select className="select" value={config.runs} onChange={(e) => patch({ runs: Number(e.target.value) })}>{[1, 2, 3, 5].map((n) => <option key={n}>{n}</option>)}</select></label>
        <label className="field">T2 tasks<select className="select" value={config.split} onChange={(e) => patch({ split: e.target.value as ExperimentConfig['split'] })}><option value="test">held-out test tasks</option><option value="dev">dev tasks</option><option value="all">all tasks</option></select></label>
        <label className="field">Model (same for every condition)<select className="select" value={config.model} onChange={(e) => patch({ model: e.target.value })}>{models.data?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="field">Budget cap per run ($)<input className="input" type="number" min={1} value={config.maxBudgetUsd} onChange={(e) => patch({ maxBudgetUsd: Number(e.target.value) })} /></label>
        <label className="check" style={{ alignSelf: 'flex-end', padding: '7px 10px' }}><input type="checkbox" checked={config.useJudge} onChange={() => patch({ useJudge: !config.useJudge })} /><span className="small">Judge rubric rules</span></label>
      </div>
      <div className="row">
        <span className="small muted">{cost ? <>≈ <strong style={{ color: 'var(--text)' }}>{cost.runs}</strong> agent runs · rough estimate <strong style={{ color: 'var(--text)' }}>{money(cost.usd)}</strong></> : '…'}</span>
        <button className="btn right" disabled={!hasSkills || run.isPending} onClick={() => run.mutate({ ...config, purpose: 'probe', tests: ['T2'], split: 'dev', runs: 1, conditions: [{ label: 'none', kind: 'none' }] })} title="One no-skills run on dev tasks to learn which conventions a generic agent already follows">Baseline probe</button>
        <button className="btn primary" disabled={!hasSkills || !config.tests.length || !config.conditions.length || run.isPending} onClick={() => run.mutate(config)}>Run experiment ▶</button>
      </div>
      {!hasSkills && <div className="banner warn">Generate a skill package before running experiments.</div>}
      {!data.llm && <div className="banner warn">No ANTHROPIC_API_KEY found. Agent runs use the Claude Agent SDK, which also accepts a Claude Code login; LLM judging needs the API key.</div>}
      <ErrorNote error={run.error} />
    </div>
  );
}

// ── Results ───────────────────────────────────────────────────────────
function Scorecard({ exp }: { exp: Experiment }) {
  const s = exp.summary;
  if (!s) return null;
  const cols = s.conditions;
  const best = (vals: (number | undefined)[]) => Math.max(...vals.map((v) => v ?? -1));
  const row = (label: string, get: (c: (typeof cols)[number]) => number | undefined, fmt = pct, hint?: string) => {
    const vals = cols.map(get);
    if (vals.every((v) => v === undefined)) return null;
    const top = best(vals);
    return (
      <tr key={label}>
        <td>{label}{hint && <div className="tiny faint">{hint}</div>}</td>
        {vals.map((v, i) => <td key={i} style={{ fontWeight: v === top && cols.length > 1 ? 650 : undefined, color: v === top && cols.length > 1 ? 'var(--ok)' : undefined }}>{fmt(v)}</td>)}
      </tr>
    );
  };
  return (
    <div className="stack">
      {s.verdict && (
        <div className="row wrap">{s.verdict.map((v) => <Badge key={v.name} tone={v.passed ? 'ok' : 'bad'} title={v.detail}>{v.passed ? '✓' : '✕'} {v.name}</Badge>)}</div>
      )}
      <table className="table">
        <thead><tr><th>Metric</th>{cols.map((c) => <th key={c.label}>{c.label} <span className="faint">({c.runs} runs)</span></th>)}</tr></thead>
        <tbody>
          <tr><td><strong>Convention adherence</strong><div className="tiny faint">95% bootstrap CI</div></td>{cols.map((c) => <td key={c.label}><strong>{pct(c.adherence)}</strong> <span className="tiny faint">[{pct(c.ci[0])}–{pct(c.ci[1])}]</span></td>)}</tr>
          {(['L1', 'L2', 'L3', 'L4', 'L5', 'L6'] as const).map((l) => row(`  ${l} ${LAYER_NAMES[l]}`, (c) => c.byLayer[l]))}
          {row('Functional correctness', (c) => c.functional, pct, 'acceptance tests (T2)')}
          {row('Similarity to your original', (c) => c.similarity, pct, 'style + AST (T1)')}
          {row('Indistinguishability', (c) => s.t3?.[c.label]?.indistinguishability, pct, 'T3: 100% = judge cannot tell')}
          {row('Cost', (c) => -c.costUsd, (v) => money(v == null ? undefined : -v))}
        </tbody>
      </table>
      {s.verdict && <div className="col tiny muted">{s.verdict.map((v) => <span key={v.name}>{v.passed ? '✓' : '✕'} {v.name}: {v.detail}</span>)}</div>}
    </div>
  );
}

function ExperimentDetail({ exp, profileId, conventions }: { exp: Experiment; profileId: string; conventions: ConventionsData['conventions'] }) {
  const detail = useApi<{ experiment: Experiment; runs: Run[] }>(`/experiments/${exp.id}`, { refetchInterval: exp.status === 'running' ? 3000 : false });
  const [open, setOpen] = useState<Run>();
  const navigate = useNavigate();
  const diagnose = useAction(() => api(`/profiles/${profileId}/diagnose`, { experimentId: exp.id }), () => navigate({ to: '/p/$profileId/$stage', params: { profileId, stage: 'improve' } }));
  const e = detail.data?.experiment ?? exp;
  return (
    <div className="stack">
      {(e.status === 'running' || e.status === 'failed') && <Card><JobLog jobId={e.jobId} /></Card>}
      {e.summary && (
        <Card title="Scorecard" actions={e.config.conditions.some((c) => c.kind === 'ars') && <button className="btn sm" onClick={() => diagnose.mutate(undefined)}>Diagnose failures → Improve</button>}>
          <Scorecard exp={e} />
        </Card>
      )}
      <Card title="Runs" pad={false}>
        <table className="table">
          <thead><tr><th>Test</th><th>Task</th><th>Condition</th><th>Status</th><th>Adherence</th><th>Tests</th><th>Similarity</th><th>Skills loaded</th><th>Cost</th></tr></thead>
          <tbody>
            {detail.data?.runs.map((r) => (
              <tr key={r.id} className="click" onClick={() => setOpen(r)}>
                <td>{r.test}</td>
                <td className="mono small ellipsis" style={{ maxWidth: 220 }}>{r.taskId}</td>
                <td>{r.condition} #{r.rep + 1}</td>
                <td><Badge tone={r.status === 'done' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'}>{r.status}</Badge></td>
                <td>{pct(r.result?.report.adherence)}</td>
                <td>{r.result?.functional ? `${r.result.functional.passed}/${r.result.functional.total}` : '—'}</td>
                <td>{r.result?.similarity ? pct((r.result.similarity.style + r.result.similarity.ast) / 2) : '—'}</td>
                <td className="tiny">{r.result?.skillsLoaded.length ?? '—'}</td>
                <td>{money(r.result?.usage.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {open && <RunDrawer run={open} conventions={conventions} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function Experiments({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const experiments = useApi<Experiment[]>(`/profiles/${id}/experiments`, { refetchInterval: 5000 });
  const conv = useApi<ConventionsData>(`/profiles/${id}/conventions`);
  const [selected, setSelected] = useState<string>();
  const list = (experiments.data ?? []).filter((e) => e.config.purpose !== 'playground' && e.config.purpose !== 'counterfactual');
  const current = list.find((e) => e.id === selected) ?? list[0];
  return (
    <div className="stack-lg">
      <Builder data={data} onCreated={(e) => setSelected(e.id)} />
      {!list.length ? <Empty title="No experiments yet">Run one above. A typical first run: T1 + T2 + T3 with all three conditions, 2 repeats.</Empty> : (
        <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ padding: 6 }}>
            {list.map((e) => {
              const ars = e.summary?.conditions.find((c) => c.label === 'ars' || c.label === 'candidate');
              return (
                <div key={e.id} className={`list-item ${e.id === current?.id ? 'sel' : ''}`} onClick={() => setSelected(e.id)} style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row"><strong className="small">{e.config.purpose === 'lab' ? e.config.tests.join(' + ') : e.config.purpose}</strong>
                      <Badge tone={e.status === 'done' ? 'ok' : e.status === 'failed' ? 'bad' : 'warn'}>{e.status}</Badge></div>
                    <div className="tiny muted">{e.config.conditions.map((c) => c.label).join(' · ')} · {ago(e.createdAt)}</div>
                    {ars && <div className="tiny">ARS {pct(ars.adherence)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
          {current && <ExperimentDetail key={current.id} exp={current} profileId={id} conventions={conv.data?.conventions ?? []} />}
        </div>
      )}
    </div>
  );
}

// ── "Which one did I write?" ──────────────────────────────────────────
interface Score { votes: number; accuracy: number | null; indistinguishability: number | null }

function Game({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const [round, setRound] = useState(0);
  const pair = useApi<{ pair: { id: string; a: string; b: string } | null }>(`/profiles/${id}/game?r=${round}`, { staleTime: Infinity });
  const score = useApi<Score>(`/profiles/${id}/game/score`);
  const [result, setResult] = useState<{ pickedReal: boolean; realFile: string } | null>(null);
  const guess = useAction((pick: 'A' | 'B') => api<{ pickedReal: boolean; realFile: string }>(`/profiles/${id}/game`, { pairId: pair.data!.pair!.id, pick }), setResult);
  if (pair.data && !pair.data.pair) return <Empty title="Nothing to compare yet">Run an experiment first; generated files from those runs are mixed with your real ones.</Empty>;
  return (
    <div className="stack">
      <div className="row">
        <h3>Which one did you write?</h3>
        <span className="small muted">One file is yours, one was written by an agent. Your guesses feed the T3 score.</span>
        <span className="right small">{score.data?.votes ? <>You spotted the agent {pct(score.data.accuracy)} of the time · indistinguishability <strong>{pct(score.data.indistinguishability)}</strong> ({score.data.votes} rounds)</> : 'No rounds yet'}</span>
      </div>
      {pair.data?.pair && (
        <div className="grid two">
          {(['A', 'B'] as const).map((side) => (
            <div key={side} className="stack">
              <CodeView text={side === 'A' ? pair.data!.pair!.a : pair.data!.pair!.b} path={`${side}.tsx`} height={520} />
              <button className={`btn lg ${result ? '' : 'primary'}`} disabled={!!result || guess.isPending} onClick={() => guess.mutate(side)}>{side} is mine</button>
            </div>
          ))}
        </div>
      )}
      {result && (
        <div className={`banner ${result.pickedReal ? 'ok' : 'warn'}`}>
          {result.pickedReal ? 'Correct: you spotted your own code.' : 'Fooled: that was the agent.'} Your file was <code>{result.realFile}</code>.
          <button className="btn sm right" onClick={() => { setResult(null); setRound(round + 1); }}>Next pair →</button>
        </div>
      )}
    </div>
  );
}

export function LabStage({ data }: { data: ProfileData }) {
  const [tab, setTab] = useState<'experiments' | 'setup' | 'game'>(data.profile.setup.lockedAt ? 'experiments' : 'setup');
  return (
    <div className="stack-lg">
      <Section title="Lab" hint="Does an agent with your skills write like you, on tasks it has never seen?"><span /></Section>
      <Tabs tabs={[['setup', 'Setup & thresholds'], ['experiments', 'Experiments'], ['game', 'Which one did I write?']]} value={tab} onChange={setTab} />
      {tab === 'setup' && <Setup data={data} />}
      {tab === 'experiments' && <Experiments data={data} />}
      {tab === 'game' && <Game data={data} />}
    </div>
  );
}
