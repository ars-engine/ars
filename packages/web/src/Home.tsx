import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { AnalysisDoc, Profile, Stage } from '@ars/engine';
import { ago, api, pct, useAction, useApi } from './api';
import { Badge, Empty, ErrorNote } from './ui';

interface ProfileRow {
  profile: Profile;
  stages: Stage[];
  analysis: AnalysisDoc | null;
  headline: { adherence?: number; lift?: number; indistinguishability?: number; conventions: number };
}

export function MiniPipeline({ stages }: { stages: Stage[] }) {
  return <div className="mini-pipeline">{stages.map((s) => <span key={s.id} className={s.state} title={`${s.label}: ${s.summary}`} />)}</div>;
}

function NewProfile() {
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const create = useAction(
    () => api<{ profile: Profile }>('/profiles', { source, name }),
    (r) => navigate({ to: '/p/$profileId/$stage', params: { profileId: r.profile.id, stage: 'ingest' } }),
  );
  return (
    <div className="hero">
      <h1>Teach agents to write code the way you do.</h1>
      <p>Point ARS at your best project. It measures how you format, name, structure and solve problems, turns that into Claude Code skills, and proves on new projects that agents follow them.</p>
      <form className="row wrap" style={{ marginTop: 20 }} onSubmit={(e) => { e.preventDefault(); create.mutate(undefined); }}>
        <input className="input lg" style={{ flex: '3 1 380px' }} placeholder="Git URL (https://github.com/you/app.git) or local folder (/Users/you/code/app)" value={source} onChange={(e) => setSource(e.target.value)} autoFocus />
        <input className="input lg" style={{ flex: '1 1 180px' }} placeholder="Profile name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary lg" disabled={!source.trim() || create.isPending}>{create.isPending ? 'Starting…' : 'Analyze →'}</button>
      </form>
      <p className="tiny faint" style={{ marginTop: 10 }}>Private repos clone with this machine's own git credentials. Code is analyzed locally; only redacted excerpts are sent to Claude.</p>
      <div style={{ marginTop: 10 }}><ErrorNote error={create.error} /></div>
    </div>
  );
}

export function Home() {
  const profiles = useApi<ProfileRow[]>('/profiles', { refetchInterval: 5000 });
  return (
    <div className="page stack-lg">
      <NewProfile />
      <section>
        <div className="section-title"><h2>Profiles</h2><p>One profile = one reference project and the signature learned from it.</p></div>
        {profiles.data?.length === 0 && <Empty title="No profiles yet">Analyze a project above to create your first signature.</Empty>}
        <div className="grid auto">
          {profiles.data?.map(({ profile, stages, analysis, headline }) => (
            <Link key={profile.id} to="/p/$profileId/$stage" params={{ profileId: profile.id, stage: analysis ? 'signature' : 'ingest' }} className="card pad stack" style={{ display: 'block' }}>
              <div className="row">
                <h3 className="ellipsis">{profile.name}</h3>
                <span className="right tiny faint">{ago(profile.updatedAt)}</span>
              </div>
              <div className="tiny muted ellipsis mono">{profile.source}{analysis ? ` @ ${analysis.sha.slice(0, 7)}` : ''}</div>
              <div className="row wrap">{analysis?.stack?.frameworks.slice(0, 4).map((f) => <Badge key={f}>{f}</Badge>)}</div>
              <MiniPipeline stages={stages} />
              <div className="row" style={{ gap: 18 }}>
                <div className="stat"><span className="value" style={{ fontSize: 17 }}>{headline.conventions}</span><span className="label">conventions</span></div>
                <div className="stat"><span className="value" style={{ fontSize: 17 }}>{pct(headline.adherence)}</span><span className="label">adherence</span></div>
                <div className="stat"><span className="value" style={{ fontSize: 17, color: (headline.lift ?? 0) > 0 ? 'var(--ok)' : undefined }}>{headline.lift === undefined ? '—' : `${headline.lift > 0 ? '+' : ''}${Math.round(headline.lift * 100)}`}</span><span className="label">lift (pts)</span></div>
                <div className="stat"><span className="value" style={{ fontSize: 17 }}>{pct(headline.indistinguishability)}</span><span className="label">T3</span></div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
