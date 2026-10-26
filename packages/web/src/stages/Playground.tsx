import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { Experiment, Run, SkillVersion } from '@ars/engine';
import { api, money, pct, useAction, useApi } from '../api';
import { JobLog } from '../jobs';
import type { ProfileData } from '../ProfileWorkspace';
import { RunFiles } from '../RunView';
import { Badge, Empty, ErrorNote, Section } from '../ui';
import type { ConventionsData } from './Signature';

const EXAMPLES = ['A user list with search and pagination', 'A settings form with validation and a save button', 'A hook that loads notifications and marks them as read'];

export function PlaygroundStage({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const [prompt, setPrompt] = useState('');
  const experiments = useApi<Experiment[]>(`/profiles/${id}/experiments`);
  const conv = useApi<ConventionsData>(`/profiles/${id}/conventions`);
  const versions = useApi<SkillVersion[]>(`/profiles/${id}/skills`);
  const playgrounds = (experiments.data ?? []).filter((e) => e.config.purpose === 'playground');
  const [selected, setSelected] = useState<string>();
  const current = playgrounds.find((e) => e.id === selected) ?? playgrounds[0];
  const detail = useApi<{ experiment: Experiment; runs: Run[] }>(current ? `/experiments/${current.id}` : null, { refetchInterval: current?.status === 'running' ? 3000 : false });
  const run = useAction(
    () => api<Experiment>(`/profiles/${id}/experiments`, {
      purpose: 'playground', prompt, tests: [], runs: 1, split: 'dev', useJudge: false, maxBudgetUsd: 2, model: data.profile.setup.model,
      conditions: [{ label: 'none', kind: 'none' }, { label: 'ars', kind: 'ars' }],
    }),
    (e) => setSelected(e.id),
  );
  const flag = useAction((experimentId: string) => api(`/profiles/${id}/diagnose`, { experimentId }));
  // Same choice as latestSkill() on the server: first published version, else the latest draft.
  const skill = versions.data?.find((v) => v.status === 'published') ?? versions.data?.find((v) => v.status === 'draft');
  const hasSkills = Boolean(skill);

  return (
    <div className="stack-lg">
      <Section title="Playground" hint="A quick gut check: the same request with and without your skills.">
        {versions.data && !hasSkills && (
          <div className="banner warn">
            Generate a skill package first in <Link to="/p/$profileId/$stage" params={{ profileId: id, stage: 'skills' }}>Skills</Link>.
          </div>
        )}
        {!data.llm && <div className="banner warn">No ANTHROPIC_API_KEY found. Agent runs use the Claude Agent SDK, which also accepts a Claude Code login; LLM judging needs the API key.</div>}
      </Section>
      <div className="card pad stack">
        <textarea className="textarea" placeholder="Describe a small piece of UI or logic…" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="row wrap">
          {EXAMPLES.map((x) => <button key={x} className="btn sm ghost" onClick={() => setPrompt(x)}>{x}</button>)}
          {skill && <span className="tiny muted right">Using skills v{skill.version} ({skill.status})</span>}
          <button className={`btn primary ${skill ? '' : 'right'}`} disabled={!prompt.trim() || !hasSkills || run.isPending} onClick={() => run.mutate(undefined)}>Run both ▶</button>
        </div>
        <ErrorNote error={run.error || flag.error} />
      </div>

      {playgrounds.length > 1 && (
        <div className="row wrap">{playgrounds.slice(0, 8).map((e) => <button key={e.id} className={`btn sm ${e.id === current?.id ? 'primary' : ''}`} onClick={() => setSelected(e.id)}>{(e.config.prompt ?? '').slice(0, 32)}…</button>)}</div>
      )}
      {current?.status === 'running' && <div className="card pad"><JobLog jobId={current.jobId} /></div>}
      {!current && <Empty title="Nothing run yet">Try one of the example prompts.</Empty>}
      {detail.data && current?.status !== 'running' && (
        <div className="stack">
          <div className="row"><h3 className="ellipsis">“{current?.config.prompt}”</h3>
            <button className="btn sm right" onClick={() => flag.mutate(current!.id)} title="Diagnose the with-skills run's violations and create improvement proposals">⚑ Send failures to Improve</button>
          </div>
          <div className="grid two">
            {['none', 'ars'].map((label) => {
              const r = detail.data!.runs.find((x) => x.condition === label);
              return (
                <div key={label} className="card pad stack">
                  <div className="row">
                    <h3>{label === 'ars' ? 'With your skills' : 'Without skills'}</h3>
                    {r?.result && <Badge tone={label === 'ars' ? 'accent' : undefined}>adherence {pct(r.result.report.adherence)}</Badge>}
                    {r?.result && <span className="right tiny muted">{money(r.result.usage.costUsd)}</span>}
                  </div>
                  {r ? <RunFiles run={r} conventions={conv.data?.conventions} height={380} /> : <p className="muted">No run.</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
