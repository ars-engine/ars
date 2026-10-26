import { Link } from '@tanstack/react-router';
import type { Job } from '@ars/engine';
import { pct, useApi } from '../api';
import { JobLog } from '../jobs';
import type { ProfileData } from '../ProfileWorkspace';
import { Badge, Bar, Card, Empty, Section, Stat } from '../ui';

const LANG_COLORS = ['var(--l2)', 'var(--l1)', 'var(--l4)', 'var(--l5)', 'var(--l3)', 'var(--l6)'];

export function IngestStage({ data }: { data: ProfileData }) {
  const { profile, analysis, latestAnalysis } = data;
  const jobs = useApi<Job[]>('/jobs', { refetchInterval: 3000 });
  const running = jobs.data?.find((j) => j.profileId === profile.id && j.status === 'running' && ['analyze', 'remine'].includes(j.kind));
  const lastFailed = !running && latestAnalysis?.status === 'failed' ? jobs.data?.find((j) => j.profileId === profile.id && j.kind === 'analyze') : undefined;

  const langs = Object.entries(analysis?.stack?.languages ?? {}).sort((a, b) => b[1] - a[1]);
  const totalFiles = langs.reduce((n, [, c]) => n + c, 0) || 1;
  return (
    <div className="stack-lg">
      <Section title="Ingest" hint="What ARS read, what it skipped, and how deeply it understands each language.">
        {(running || lastFailed) && <Card><JobLog jobId={(running ?? lastFailed)!.id} /></Card>}
      </Section>
      {!analysis && !running && <Empty title="Not analyzed yet">Start an analysis with Re-analyze in the sidebar.</Empty>}
      {analysis?.counts && (
        <>
          <div className="grid three">
            <Card><div className="row" style={{ gap: 28 }}>
              <Stat label="files analyzed" value={analysis.counts.files} />
              <Stat label="style observations" value={analysis.counts.observations.toLocaleString()} />
            </div></Card>
            <Card><Stat label="formatting reproduced" value={pct(analysis.formatting?.lineMatch)} hint={analysis.formatting?.source === 'repo-config' ? 'from your Prettier config' : 'inferred by searching formatter settings'} /></Card>
            <Card><Stat label="possible secrets" value={analysis.secrets?.length ?? 0} hint="redacted before anything reaches an LLM" /></Card>
          </div>

          <div className="grid two">
            <Card title="Stack & coverage">
              <div className="stack">
                <div className="row wrap">{analysis.stack?.frameworks.map((f) => <Badge key={f} tone="accent">{f}</Badge>)}{!analysis.stack?.frameworks.length && <span className="muted small">No known framework detected.</span>}</div>
                <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden' }}>
                  {langs.map(([l, n], i) => <div key={l} title={`${l}: ${n}`} style={{ width: `${(n / totalFiles) * 100}%`, background: LANG_COLORS[i % LANG_COLORS.length] }} />)}
                </div>
                <table className="table">
                  <thead><tr><th>Language</th><th>Files</th><th>Analysis depth</th></tr></thead>
                  <tbody>
                    {langs.map(([l, n]) => (
                      <tr key={l}><td>{l}</td><td>{n}</td><td>{analysis.stack?.coverage[l] === 'deep' ? <Badge tone="ok">deep · AST</Badge> : <Badge>shallow · inventory</Badge>}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="What each file does (roles)">
              <div className="col">
                {Object.entries(analysis.counts.byRole).map(([role, n]) => (
                  <div key={role} className="row"><span style={{ width: 90 }} className="small">{role}</span><Bar value={n / analysis.counts!.files} /><span className="tiny muted" style={{ width: 34, textAlign: 'right' }}>{n}</span></div>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid two">
            <Card title="Skipped" actions={<span className="tiny muted">not part of your style</span>}>
              <table className="table">
                <thead><tr><th>Path</th><th>Reason</th><th>Files</th></tr></thead>
                <tbody>{analysis.skipped?.slice(0, 14).map((s) => <tr key={s.path + s.reason}><td className="mono">{s.path}</td><td className="muted small">{s.reason}</td><td>{s.count}</td></tr>)}</tbody>
              </table>
            </Card>
            <Card title="Held out for the reconstruction test" actions={<Link className="btn sm" to="/p/$profileId/$stage" params={{ profileId: profile.id, stage: 'lab' }}>Edit in Lab →</Link>}>
              <p className="small muted" style={{ marginBottom: 10 }}>These files are hidden from learning. Later, an agent re-writes them from a description and ARS compares the result with what you actually wrote.</p>
              {profile.setup.heldOut.map((h) => <div key={h.path} className="row small" style={{ padding: '4px 0' }}><Badge>{h.role}</Badge><span className="mono ellipsis">{h.path}</span></div>)}
            </Card>
          </div>

          {!!analysis.secrets?.length && (
            <Card title="Possible secrets (redacted)">
              <table className="table"><tbody>{analysis.secrets.slice(0, 20).map((s, i) => <tr key={i}><td className="mono">{s.file}:{s.line}</td><td><Badge tone="warn">{s.kind}</Badge></td></tr>)}</tbody></table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
