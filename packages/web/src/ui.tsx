import type { ReactNode } from 'react';
import type { Layer } from '@ars/engine';

/** Small, reusable visual primitives. */

export const LAYER_NAMES: Record<Layer, string> = {
  L1: 'Formatting', L2: 'Syntax idioms', L3: 'Naming', L4: 'Component anatomy', L5: 'Architecture & decisions', L6: 'Problem-solving voice',
};

export function LayerChip({ layer }: { layer: Layer }) {
  return <span className="layer-chip" style={{ color: `var(--${layer.toLowerCase()})` }}>{layer}</span>;
}

export function Badge({ tone, children, title }: { tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode; title?: string }) {
  return <span className={`badge ${tone ?? ''}`} title={title}>{children}</span>;
}

export function Bar({ value, tone }: { value: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone ? `var(--${tone})` : value >= 0.85 ? 'var(--ok)' : value >= 0.6 ? 'var(--accent)' : 'var(--warn)';
  return <div className="bar"><div style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`, background: color }} /></div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="stat">
      <span className="value">{value}</span>
      <span className="label">{label}</span>
      {hint && <span className="tiny faint">{hint}</span>}
    </div>
  );
}

export function Card({ title, actions, children, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <div className="card">
      {title && <div className="card-head"><h3>{title}</h3><div className="right row">{actions}</div></div>}
      <div className={pad ? 'card-body' : ''}>{children}</div>
    </div>
  );
}

export function Section({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="section-title"><h2>{title}</h2>{hint && <p>{hint}</p>}<div className="right row">{actions}</div></div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export const Spinner = () => <span className="spinner" />;

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, ReactNode][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map(([id, label]) => <div key={id} className={`tab ${value === id ? 'on' : ''}`} onClick={() => onChange(id)}>{label}</div>)}
    </div>
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head"><h2 className="ellipsis">{title}</h2><div className="right row">{actions}<button className="btn ghost" onClick={onClose}>Close ✕</button></div></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="banner bad">⚠ {(error as Error).message}</div>;
}

const TREND = { rising: ['↗', 'ok', 'adherence rising in recent code'], falling: ['↘', 'warn', 'adherence falling in recent code'], stable: ['→', undefined, 'stable over time'], unknown: ['', undefined, ''] } as const;

export function Trend({ trend }: { trend: keyof typeof TREND }) {
  const [icon, tone, title] = TREND[trend];
  return icon ? <Badge tone={tone} title={title}>{icon} {trend}</Badge> : null;
}
