import { useEffect, useState } from 'react';
import type { Convention, Evidence } from '@ars/engine';
import { pct, useApi } from './api';
import { CodeView } from './code';
import { Badge, Bar, LayerChip, Tabs, Trend } from './ui';

/** Rule on the left, the developer's real code on the right: every claim links to code. */

export function useSourceFile(profileId: string, path?: string) {
  return useApi<{ text: string }>(path ? `/profiles/${profileId}/file?path=${encodeURIComponent(path)}` : null);
}

const CHECK_LABEL: Record<Convention['check']['type'], string> = {
  feature: 'measured from the AST', formatting: 'formatter check', dependency: 'dependency check', pattern: 'pattern check (LLM-proposed, code-verified)', judgment: 'rubric judge',
};

export function StatusBadge({ c }: { c: Convention }) {
  if (c.status === 'approved') return <Badge tone="ok">{c.autoApproved ? 'auto-approved' : 'approved'}</Badge>;
  if (c.status === 'rejected') return <Badge tone="bad">rejected</Badge>;
  return <Badge tone="warn">needs review</Badge>;
}

export function SelfTestBadge({ status }: { status?: string }) {
  if (!status) return null;
  return <Badge tone={status === 'passed' ? 'ok' : status === 'failed' ? 'bad' : undefined} title="Planted-violation self-test of this rule's checker">checker {status}</Badge>;
}

function RefList({ refs, selected, onSelect, tone }: { refs: Evidence[]; selected?: string; onSelect: (f: string) => void; tone?: 'bad' }) {
  const files = [...new Set(refs.map((r) => r.file))];
  return (
    <div className="col" style={{ gap: 2, maxHeight: 360, overflow: 'auto' }}>
      {files.map((f) => {
        const lines = refs.filter((r) => r.file === f);
        return (
          <div key={f} className={`list-item ${selected === f ? 'sel' : ''}`} onClick={() => onSelect(f)}>
            <span className="mono small ellipsis">{f}</span>
            <span className="right tiny faint">{tone === 'bad' && lines[0].value ? lines[0].value.replace(/"/g, '') : `L${lines.map((l) => l.line).join(',')}`}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ConventionDetail({ profileId, c, selftest, children }: { profileId: string; c: Convention; selftest?: string; children?: React.ReactNode }) {
  const [tab, setTab] = useState<'evidence' | 'exceptions'>('evidence');
  const refs: Evidence[] = tab === 'evidence' ? c.evidence : c.exceptions;
  const [file, setFile] = useState<string | undefined>(refs[0]?.file);
  useEffect(() => setFile((tab === 'evidence' ? c.evidence : c.exceptions)[0]?.file), [c.id, tab]);
  const source = useSourceFile(profileId, file);
  const lines = refs.filter((r) => r.file === file).map((r) => r.line);
  const check = c.check;
  const supportText = check.type === 'formatting' ? `${pct(c.support.ratio)} of lines reproduced` : `${c.support.total ? `${c.support.matched}/${c.support.total} · ` : ''}${pct(c.support.ratio)}`;

  return (
    <div className="split">
      <div className="stack">
        <div className="row wrap"><LayerChip layer={c.layer} /><StatusBadge c={c} /><Badge tone={c.tier === 'enforced' ? 'info' : 'accent'}>{c.tier === 'enforced' ? 'Enforced by tooling' : 'Learned, measured'}</Badge><Trend trend={c.trend} /></div>
        <h2>{c.title}</h2>
        <p className="muted">{c.instruction}</p>
        <div className="card pad stack">
          <div className="row small"><span className="muted" style={{ width: 110 }}>Support</span><Bar value={c.support.ratio} /><span>{supportText}</span></div>
          <div className="row small"><span className="muted" style={{ width: 110 }}>Confidence</span><Bar value={c.confidence} /><span>{pct(c.confidence)}</span></div>
          <div className="row small wrap"><span className="muted" style={{ width: 110 }}>Checked by</span><span>{CHECK_LABEL[check.type]}</span><SelfTestBadge status={selftest} /></div>
          <div className="row small"><span className="muted" style={{ width: 110 }}>Scope</span><span>{c.scope}</span></div>
          {check.type === 'formatting' && <div className="row wrap">{Object.entries(check.options).map(([k, v]) => <Badge key={k}>{k}: {String(v)}</Badge>)}</div>}
          {check.type === 'pattern' && <div className="small"><span className="muted">Pattern </span><code>{check.regex}</code> must be <strong>{check.expect}</strong></div>}
        </div>
        {c.example && <div className="stack"><h3>Sample in this style</h3><pre className="snippet">{c.example}</pre></div>}
        {children}
        {(c.evidence.length > 0 || c.exceptions.length > 0) && (
          <div>
            <Tabs tabs={[['evidence', `Evidence (${c.evidence.length})`], ['exceptions', `Exceptions (${c.exceptions.length})`]]} value={tab} onChange={setTab} />
            {tab === 'exceptions' && !!c.exceptions.length && <p className="tiny muted" style={{ marginBottom: 8 }}>Places in your code that do it differently.</p>}
            <RefList refs={refs} selected={file} onSelect={setFile} tone={tab === 'exceptions' ? 'bad' : undefined} />
          </div>
        )}
      </div>
      <div style={{ position: 'sticky', top: 0 }}>
        {file && source.data ? (
          <CodeView text={source.data.text} path={file} highlight={tab === 'evidence' ? lines : []} bad={tab === 'exceptions' ? lines : []} height="70vh" />
        ) : (
          <div className="empty">{refs.length ? 'Loading file…' : 'This rule has no file-level evidence (it is checked across the project).'}</div>
        )}
      </div>
    </div>
  );
}
