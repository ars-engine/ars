import { useEffect, useState } from 'react';
import type { Convention, SkillVersion } from '@ars/engine';
import { ago, api, useAction, useApi } from '../api';
import { CodeView, DiffView } from '../code';
import { ConventionDetail } from '../ConventionDetail';
import { Markdown } from '../markdown';
import type { ProfileData } from '../ProfileWorkspace';
import { Badge, Drawer, Empty, ErrorNote, Section } from '../ui';
import type { ConventionsData } from './Signature';

const STATUS_TONE = { published: 'ok', draft: 'warn', candidate: 'info', superseded: undefined, rejected: 'bad' } as const;

function useSkillFile(versionId?: string, path?: string) {
  return useApi<{ text: string }>(versionId && path ? `/skills/${versionId}/file?path=${encodeURIComponent(path)}` : null);
}

function Install({ version }: { version: SkillVersion }) {
  const [target, setTarget] = useState('');
  const install = useAction(() => api<{ written: string[] }>(`/skills/${version.id}/install`, { target }));
  return (
    <div className="card pad stack">
      <h3>Install into a project</h3>
      <p className="tiny muted">Writes the skills to <code>.claude/skills/</code>, the rules to <code>.ars/</code>, and a formatting + style-check hook to <code>.claude/settings.json</code>.</p>
      <div className="row">
        <input className="input" placeholder="/Users/you/code/new-project" value={target} onChange={(e) => setTarget(e.target.value)} />
        <button className="btn primary" disabled={!target.trim() || install.isPending} onClick={() => install.mutate(undefined)}>Install</button>
      </div>
      <ErrorNote error={install.error} />
      {install.data && <div className="banner ok">Installed: {install.data.written.join(', ')}</div>}
    </div>
  );
}

export function SkillsStage({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const versions = useApi<SkillVersion[]>(`/profiles/${id}/skills`);
  const conv = useApi<ConventionsData>(`/profiles/${id}/conventions`);
  const [vid, setVid] = useState<string>();
  const version = versions.data?.find((v) => v.id === vid) ?? versions.data?.[0];
  const files = useApi<string[]>(version ? `/skills/${version.id}/files` : null);
  const [path, setPath] = useState<string>();
  const [compare, setCompare] = useState<string>('');
  const [rule, setRule] = useState<Convention>();
  useEffect(() => setPath(files.data?.find((f) => f.endsWith('code-style/SKILL.md')) ?? files.data?.[0]), [files.data]);
  const file = useSkillFile(version?.id, path);
  const other = useSkillFile(compare || undefined, compare ? path : undefined);
  const generate = useAction(() => api<SkillVersion>(`/profiles/${id}/skills`, {}), (v) => setVid(v.id));
  const publish = useAction((v: string) => api(`/skills/${v}/publish`, {}));
  const stale = data.stages.find((s) => s.id === 'skills')?.state === 'stale';

  const openRule = (ruleId: string) => {
    const c = version?.conventions.find((x) => x.id === ruleId) ?? conv.data?.conventions.find((x) => x.id === ruleId);
    if (c) setRule(c);
  };

  return (
    <div className="stack-lg">
      <Section
        title="Skills"
        hint="Versioned packages: Claude Code skills + executable rules + formatter config + edit hook."
        actions={<button className="btn primary" disabled={generate.isPending} onClick={() => generate.mutate(undefined)}>＋ Generate new version</button>}
      >
        {stale && <div className="banner warn">↻ You made review decisions after the latest version was generated. Generate a new version to include them.</div>}
        <ErrorNote error={generate.error || publish.error} />
      </Section>

      {!versions.data?.length ? (
        <Empty title="No skill package yet">Approve conventions in Review, then generate the first version.</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16, alignItems: 'start' }}>
          <div className="stack">
            <div className="card" style={{ padding: 6 }}>
              {versions.data.map((v) => (
                <div key={v.id} className={`list-item ${v.id === version?.id ? 'sel' : ''}`} onClick={() => setVid(v.id)} style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row"><strong>v{v.version}</strong><Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge></div>
                    <div className="tiny muted ellipsis" title={v.note}>{v.note}</div>
                    <div className="tiny faint">{v.wordCount} words · {ago(v.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
            {version && version.status !== 'published' && version.status !== 'rejected' && (
              <button className="btn ok" onClick={() => publish.mutate(version.id)}>Publish v{version.version}</button>
            )}
            {version && <Install version={version} />}
          </div>

          <div className="stack">
            <div className="row wrap">
              {files.data?.filter((f) => !f.startsWith('exemplars/') || f === path).map((f) => (
                <button key={f} className={`btn sm ${f === path ? 'primary' : ''}`} onClick={() => setPath(f)}>{f}</button>
              ))}
              {files.data?.some((f) => f.startsWith('exemplars/')) && (
                <select className="select" style={{ width: 200, height: 26, fontSize: 12 }} title="Real files from the source project (business names replaced) that the code-style skill tells the agent to read before writing similar code" value={path?.startsWith('exemplars/') ? path : ''} onChange={(e) => e.target.value && setPath(e.target.value)}>
                  <option value="">exemplars…</option>
                  {files.data.filter((f) => f.startsWith('exemplars/')).map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              )}
              <select
                className="select right"
                style={{ width: 190, height: 26, fontSize: 12 }}
                disabled={versions.data.length < 2}
                title={versions.data.length < 2 ? 'Generate another version to compare against' : 'Diff the open file against another version'}
                value={compare === version?.id ? '' : compare}
                onChange={(e) => setCompare(e.target.value)}
              >
                <option value="">{versions.data.length < 2 ? 'Compare (1 version)' : 'Compare with…'}</option>
                {versions.data.filter((v) => v.id !== version?.id).map((v) => <option key={v.id} value={v.id}>v{v.version} ({v.status})</option>)}
              </select>
            </div>
            {compare && compare !== version?.id && file.data && other.data && path ? (
              <DiffView a={other.data.text} b={file.data.text} path={path} labels={[`v${versions.data.find((v) => v.id === compare)?.version}`, `v${version?.version}`]} height={620} />
            ) : path?.endsWith('SKILL.md') && file.data ? (
              <div className="card pad">
                <p className="tiny muted" style={{ marginBottom: 6 }}>Click any rule to see the evidence behind it.</p>
                <Markdown text={file.data.text} onRule={openRule} selectedRule={rule?.id} />
              </div>
            ) : file.data && path ? (
              <CodeView text={file.data.text} path={path} height={620} />
            ) : null}
          </div>
        </div>
      )}

      {rule && (
        <Drawer title="Evidence behind this rule" onClose={() => setRule(undefined)}>
          <ConventionDetail profileId={id} c={rule} selftest={conv.data?.selftest[rule.id]?.status} />
        </Drawer>
      )}
    </div>
  );
}
