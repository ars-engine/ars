import { useState } from 'react';
import type { Convention, Layer, StyleChange } from '@ars/engine';
import { pct, useApi } from '../api';
import { ConventionDetail, StatusBadge } from '../ConventionDetail';
import { Markdown } from '../markdown';
import type { ProfileData } from '../ProfileWorkspace';
import { Badge, Bar, Drawer, Empty, LAYER_NAMES, LayerChip, Section } from '../ui';

export interface ConventionsData {
  conventions: Convention[];
  selftest: Record<string, { status: string; detail: string }>;
  baseline: Record<string, number>;
  dossier: string | null;
  llm: string | null;
  llmNote: string | null;
  changes: StyleChange[];
  formatting: { summary: string[]; lineMatch: number; source: string } | null;
}

const LAYERS: Layer[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];
const ENFORCED = new Set<Layer>(['L1', 'L2', 'L3']);

export function Distinctive({ id, baseline }: { id: string; baseline: Record<string, number> }) {
  if (baseline[id] === undefined) return null;
  return baseline[id] < 0.9
    ? <Badge tone="accent" title={`A generic agent follows this ${pct(baseline[id])} of the time`}>distinctive</Badge>
    : <Badge title={`A generic agent already does this ${pct(baseline[id])} of the time`}>generic habit</Badge>;
}

export function SignatureStage({ data }: { data: ProfileData }) {
  const id = data.profile.id;
  const conv = useApi<ConventionsData>(`/profiles/${id}/conventions`);
  const [open, setOpen] = useState<Convention>();
  const [showDossier, setShowDossier] = useState(true);
  if (!conv.data) return null;
  const { conventions, baseline, changes, dossier, formatting } = conv.data;
  if (!conventions.length) return <Empty title="No signature yet">It appears here once the analysis finishes.</Empty>;

  return (
    <div className="stack-lg">
      <Section title={`How ${data.profile.name} writes code`} hint="Read-only. Every convention links to the code it was learned from.">
        {conv.data.llm !== 'done' && conv.data.llmNote && <div className="banner info">ℹ {conv.data.llmNote}</div>}
      </Section>

      {!!changes.length && (
        <div className="card pad stack">
          <h3>What changed in your style since the previous analysis</h3>
          {changes.slice(0, 10).map((ch) => (
            <div key={ch.conventionId} className="row small">
              <Badge tone={ch.kind === 'added' ? 'ok' : ch.kind === 'removed' ? 'bad' : 'warn'}>{ch.kind}</Badge>
              <span>{ch.kind === 'changed' ? <>{ch.before} <span className="faint">→</span> {ch.after}</> : ch.title}</span>
            </div>
          ))}
        </div>
      )}

      {dossier && (
        <div className="card">
          <div className="card-head"><h3>Style dossier</h3><span className="tiny muted">written by Claude after reading your code</span><button className="btn sm ghost right" onClick={() => setShowDossier(!showDossier)}>{showDossier ? 'Hide' : 'Show'}</button></div>
          {showDossier && <div className="card-body"><Markdown text={dossier} /></div>}
        </div>
      )}

      <div className="grid two">
        {LAYERS.map((layer) => {
          const items = conventions.filter((c) => c.layer === layer && c.status !== 'rejected');
          const avg = items.length ? items.reduce((n, c) => n + c.support.ratio, 0) / items.length : 0;
          return (
            <div key={layer} className="card">
              <div className="card-head">
                <LayerChip layer={layer} />
                <h3>{LAYER_NAMES[layer]}</h3>
                <Badge tone={ENFORCED.has(layer) ? 'info' : 'accent'} title={ENFORCED.has(layer) ? 'Guaranteed by formatter, lint rules and the edit hook' : 'Learned behavior, measured in the Lab'}>{ENFORCED.has(layer) ? 'Enforced' : 'Learned'}</Badge>
                <span className="right tiny muted">{items.length ? `${items.length} · ${pct(avg)} consistent` : ''}</span>
              </div>
              <div style={{ padding: 6 }}>
                {layer === 'L1' && formatting && (
                  <div className="row wrap" style={{ padding: '6px 8px 8px' }}>{formatting.summary.map((s) => <Badge key={s}>{s}</Badge>)}</div>
                )}
                {!items.length && <p className="muted small" style={{ padding: 10 }}>{layer === 'L6' && conv.data!.llm !== 'done' ? 'Most of this layer needs the Claude deep-read.' : 'Nothing consistent enough to call a convention.'}</p>}
                {items.map((c) => (
                  <div key={c.id} className="list-item" onClick={() => setOpen(c)}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="small ellipsis">{c.title}</div>
                      <div className="row" style={{ marginTop: 4 }}><Bar value={c.support.ratio} /><span className="tiny faint" style={{ width: 70 }}>{c.check.type === 'formatting' ? 'of lines' : c.support.total ? `${c.support.matched}/${c.support.total}` : c.source}</span></div>
                    </div>
                    <Distinctive id={c.id} baseline={baseline} />
                    <StatusBadge c={c} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <Drawer title={`${LAYER_NAMES[open.layer]} convention`} onClose={() => setOpen(undefined)}>
          <ConventionDetail profileId={id} c={open} selftest={conv.data.selftest[open.id]?.status} />
        </Drawer>
      )}
    </div>
  );
}
