import { Link, useParams } from '@tanstack/react-router';
import type { AnalysisDoc, Profile, Stage } from '@ars/engine';
import { api, useAction, useApi } from './api';
import { Badge, Spinner } from './ui';
import { IngestStage } from './stages/Ingest';
import { SignatureStage } from './stages/Signature';
import { ReviewStage } from './stages/Review';
import { PlaygroundStage } from './stages/Playground';
import { SkillsStage } from './stages/Skills';
import { LabStage } from './stages/Lab';
import { ImproveStage } from './stages/Improve';

export interface ProfileData {
  profile: Profile;
  stages: Stage[];
  analysis: AnalysisDoc | null;
  latestAnalysis: { id: string; status: string } | null;
  accuracy: { agreed: number; decided: number; accuracy: number | null };
  llm: boolean;
}

export const useProfile = (id: string) => useApi<ProfileData>(`/profiles/${id}`, { refetchInterval: 4000 });

const STAGES = { ingest: IngestStage, signature: SignatureStage, review: ReviewStage, skills: SkillsStage, playground: PlaygroundStage, lab: LabStage, improve: ImproveStage };
const ICON: Record<Stage['state'], string> = { done: '✓', attention: '!', active: '•', stale: '↻', idle: '' };

export function ProfileWorkspace() {
  const { profileId, stage } = useParams({ from: '/p/$profileId/$stage' });
  const data = useProfile(profileId);
  const reanalyze = useAction(() => api(`/profiles/${profileId}/analyze`, {}));
  if (!data.data) return <div className="page row muted"><Spinner /> Loading profile…</div>;
  const { profile, stages, analysis } = data.data;
  const View = STAGES[stage as keyof typeof STAGES] ?? IngestStage;
  return (
    <div className="workspace">
      <nav className="rail">
        <div className="rail-profile">
          <h2 className="ellipsis">{profile.name}</h2>
          <div className="tiny muted mono ellipsis" title={profile.source}>{profile.source}</div>
          <div className="row" style={{ marginTop: 10 }}>
            {analysis && <Badge>@ {analysis.sha.slice(0, 7)}</Badge>}
            <button className="btn sm right" onClick={() => reanalyze.mutate(undefined)} disabled={data.data.latestAnalysis?.status === 'running'} title="Pull the latest commit and re-learn. Your decisions carry over.">↻ Re-analyze</button>
          </div>
        </div>
        {stages.map((s, i) => (
          <Link key={s.id} to="/p/$profileId/$stage" params={{ profileId, stage: s.id }} className={`rail-step ${stage === s.id ? 'on' : ''}`}>
            <span className={`rail-dot ${s.state}`}>{ICON[s.state] || i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div className="rail-label">{s.label}{s.state === 'stale' && <Badge tone="warn">stale</Badge>}</div>
              <div className="rail-summary">{s.summary}</div>
            </div>
          </Link>
        ))}
      </nav>
      <div className="content"><View data={data.data} /></div>
    </div>
  );
}
