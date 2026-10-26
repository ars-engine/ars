/** Shared vocabulary of the ARS engine. Every module speaks these types. */

export type Layer = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export type Role =
  | 'component' | 'hook' | 'api' | 'store' | 'route' | 'test' | 'story'
  | 'type' | 'util' | 'config' | 'style' | 'module';

export type Value = string | number | string[];

/** One measured fact about how a piece of code is written. */
export interface Observation {
  feature: string;
  value: Value;
  file: string;
  line: number;
  role: Role;
}

export interface FileInfo {
  path: string;
  lang: string;
  role: Role;
  lines: number;
  lastTouched?: number;
  commits?: number;
}

export interface ImportEdge {
  from: string;
  spec: string;
  to?: string;
  kind: 'package' | 'builtin' | 'alias' | 'relative' | 'style';
  line: number;
}

export interface StackInfo {
  languages: Record<string, number>;
  frameworks: string[];
  manifests: string[];
  coverage: Record<string, 'deep' | 'shallow'>;
}

export type FormatOptions = Record<string, string | number | boolean>;

export interface FormattingProfile {
  options: FormatOptions;
  source: 'repo-config' | 'inferred';
  lineMatch: number;
  filesExact: number;
  filesSampled: number;
}

/** Everything an analyzer pass produces for one directory. */
export interface Analysis {
  root: string;
  files: FileInfo[];
  observations: Observation[];
  imports: ImportEdge[];
  dependencies: Record<string, string>;
  stack: StackInfo;
}

export type Check =
  | { type: 'feature'; feature: string; kind: 'categorical'; expected: string }
  | { type: 'feature'; feature: string; kind: 'oneOf'; expected: string[] }
  | { type: 'feature'; feature: string; kind: 'max'; expected: number }
  | { type: 'feature'; feature: string; kind: 'order'; expected: string[] }
  | { type: 'formatting'; options: FormatOptions }
  | { type: 'dependency'; category: string; lib: string; alternatives: string[] }
  | { type: 'pattern'; role: Role | null; regex: string; expect: 'present' | 'absent' }
  | { type: 'judgment'; rubric: string };

export interface Evidence {
  file: string;
  line: number;
  value?: string;
}

export interface ExceptionRef extends Evidence {
  hint: 'likely-legacy' | 'likely-intentional' | 'unknown';
  ageDays?: number;
  decision?: 'intentional' | 'legacy';
}

export type ConventionStatus = 'pending' | 'approved' | 'rejected';

/** A learned convention. It is also the executable rule that checks it. */
export interface Convention {
  id: string;
  layer: Layer;
  title: string;
  instruction: string;
  scope: string;
  check: Check;
  support: { matched: number; total: number; ratio: number };
  evidence: Evidence[];
  exceptions: ExceptionRef[];
  confidence: number;
  trend: 'rising' | 'stable' | 'falling' | 'unknown';
  tier: 'enforced' | 'learned';
  source: 'miner' | 'llm';
  status: ConventionStatus;
  autoApproved?: boolean;
  edited?: boolean;
  enforce?: boolean;
  example?: string;
  voiceVote?: 'yes' | 'no';
}

export interface ConventionResult {
  conventionId: string;
  layer: Layer;
  applicable: boolean;
  passed: number;
  total: number;
  violations: Evidence[];
}

export interface CheckReport {
  results: ConventionResult[];
  adherence: number;
  byLayer: Partial<Record<Layer, number>>;
}

export const LAYERS: { id: Layer; name: string; tier: 'enforced' | 'learned' }[] = [
  { id: 'L1', name: 'Formatting', tier: 'enforced' },
  { id: 'L2', name: 'Syntax idioms', tier: 'enforced' },
  { id: 'L3', name: 'Naming', tier: 'enforced' },
  { id: 'L4', name: 'Component anatomy', tier: 'learned' },
  { id: 'L5', name: 'Architecture & decisions', tier: 'learned' },
  { id: 'L6', name: 'Problem-solving voice', tier: 'learned' },
];

export const tierOf = (layer: Layer) => LAYERS.find((l) => l.id === layer)!.tier;
