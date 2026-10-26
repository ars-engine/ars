import type { SelfTestResult } from '../check/selftest.ts';
import type { Doc } from './store.ts';
import type { CheckReport, Convention, ConventionResult, FormattingProfile, Layer, Role, StackInfo } from './types.ts';
import type { SecretHit } from '../ingest/secrets.ts';
import type { SkipRecord } from '../ingest/ingest.ts';

/** Persistent entities. Each lives as a document in the store (collection name in comments). */

export interface Thresholds {
  minLift: number;
  maxFunctionalDrop: number;
  minIndistinguishability: number;
  minReviewAccuracy: number;
  regressionTolerance: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minLift: 0.15,
  maxFunctionalDrop: 0.05,
  minIndistinguishability: 0.5,
  minReviewAccuracy: 0.8,
  regressionTolerance: 0.1,
};

export interface HeldOutFile {
  path: string;
  role: Role;
  description?: string;
}

/** collection: profiles */
export interface Profile extends Doc {
  name: string;
  slug: string;
  source: string;
  sourceType: 'git' | 'local';
  repoDir: string;
  currentAnalysisId?: string;
  setup: { thresholds: Thresholds; heldOut: HeldOutFile[]; lockedAt?: number; model: string; heldOutChangedAt?: number };
  baseline?: Record<string, number>;
  selftest?: Record<string, SelfTestResult>;
  updatedAt: number;
}

export interface StyleChange {
  conventionId: string;
  title: string;
  kind: 'added' | 'removed' | 'changed';
  before?: string;
  after?: string;
}

/** collection: analyses — one per analysis run ("profile version"). */
export interface AnalysisDoc extends Doc {
  profileId: string;
  sha: string;
  status: 'running' | 'done' | 'failed';
  factsPath: string;
  stack?: StackInfo;
  counts?: { files: number; observations: number; byRole: Record<string, number> };
  skipped?: SkipRecord[];
  secrets?: SecretHit[];
  formatting?: FormattingProfile;
  dossier?: string;
  llm?: 'done' | 'skipped' | 'failed';
  llmNote?: string;
  changes?: StyleChange[];
  previousId?: string;
  minedAt?: number;
}

/** collection: conventionSets — id = analysis id. */
export interface ConventionSet extends Doc {
  profileId: string;
  conventions: Convention[];
  decidedAt?: number;
}

/** collection: decisions — append-only log; the labels behind convention precision. */
export interface Decision extends Doc {
  profileId: string;
  conventionId: string;
  action: 'approve' | 'reject' | 'edit' | 'exception' | 'voice' | 'reopen';
  payload?: Record<string, unknown>;
}

/** collection: skills */
export interface SkillVersion extends Doc {
  profileId: string;
  version: number;
  analysisId: string;
  status: 'draft' | 'candidate' | 'published' | 'superseded' | 'rejected';
  parentId?: string;
  dir: string;
  note: string;
  conventions: Convention[];
  descriptions: Record<string, string>;
  wordCount: number;
  publishedAt?: number;
}

export type TestKind = 'T1' | 'T2' | 'T3';

export interface Condition {
  label: string;
  kind: 'none' | 'generic' | 'ars';
  skillVersionId?: string;
}

export interface ExperimentConfig {
  purpose: 'lab' | 'gate' | 'probe' | 'playground' | 'counterfactual';
  tests: TestKind[];
  conditions: Condition[];
  runs: number;
  model: string;
  split: 'dev' | 'test' | 'all';
  taskIds?: string[];
  useJudge: boolean;
  maxBudgetUsd: number;
  prompt?: string;
  reminder?: { conventionId: string; text: string };
  proposalId?: string;
}

export interface ConditionSummary {
  label: string;
  runs: number;
  adherence: number;
  ci: [number, number];
  byLayer: Partial<Record<Layer, number>>;
  functional?: number;
  similarity?: number;
  costUsd: number;
  perConvention: Record<string, number>;
}

export interface ExperimentSummary {
  conditions: ConditionSummary[];
  t3?: Record<string, { pairs: number; detectionAccuracy: number; indistinguishability: number }>;
  verdict?: { name: string; passed: boolean; detail: string }[];
}

/** collection: experiments */
export interface Experiment extends Doc {
  profileId: string;
  config: ExperimentConfig;
  status: 'running' | 'done' | 'failed';
  jobId?: string;
  summary?: ExperimentSummary;
  finishedAt?: number;
}

export interface RunResult {
  report: CheckReport;
  files: string[];
  functional?: { passed: number; total: number; typecheck: boolean; score: number };
  copy?: { leakedTerms: string[]; sharedBlocks: number; copyRatio: number };
  similarity?: { style: number; ast: number };
  judgeScores?: Record<string, boolean>;
  usage: { costUsd: number; inputTokens: number; outputTokens: number; turns: number; durationMs: number };
  skillsLoaded: string[];
}

/** collection: runs */
export interface Run extends Doc {
  profileId: string;
  experimentId: string;
  test: 'T1' | 'T2' | 'playground';
  condition: string;
  taskId: string;
  rep: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  workspace: string;
  transcriptPath: string;
  result?: RunResult;
  error?: string;
}

export type FailureCategory = 'checker' | 'learned' | 'unclear' | 'not-loaded' | 'ignored';

export type ProposalChange =
  | { type: 'rewrite'; instruction: string }
  | { type: 'description'; skill: string; description: string }
  | { type: 'enforce' }
  | { type: 'remove' }
  | { type: 'to-judgment' };

export interface GateResult {
  passed: boolean;
  targetBefore: number;
  targetAfter: number;
  regressions: { conventionId: string; before: number; after: number }[];
  functionalBefore?: number;
  functionalAfter?: number;
  heldOutBefore: number;
  heldOutAfter: number;
  notes: string[];
}

/** collection: proposals */
export interface Proposal extends Doc {
  profileId: string;
  experimentId: string;
  conventionId: string;
  title: string;
  layer: Layer;
  category: FailureCategory;
  diagnosis: string;
  change: ProposalChange;
  rate: number;
  failingRuns: string[];
  sampleViolations: ConventionResult['violations'];
  status: 'proposed' | 'gating' | 'ready' | 'failed-gate' | 'promoted' | 'dismissed';
  candidateVersionId?: string;
  gateExperimentId?: string;
  gate?: GateResult;
}

/** collection: jobs */
export interface Job extends Doc {
  kind: string;
  title: string;
  status: 'running' | 'done' | 'failed';
  progress: number;
  log: string[];
  error?: string;
  finishedAt?: number;
}

/** collection: votes — the "Which one did I write?" game. */
export interface Vote extends Doc {
  profileId: string;
  realFile: string;
  generatedRunId: string;
  generatedFile: string;
  pickedReal: boolean;
}
