import { readFileSync } from 'node:fs';
import type { Check, Convention, Layer } from '../core/types.ts';
import { tierOf } from '../core/types.ts';

/** The portable rules.json format shipped inside every skill package. */
export interface RuleFile {
  profile: string;
  slug: string;
  version: number;
  rules: { id: string; layer: Layer; title: string; instruction: string; check: Check; enforce: boolean; exempt: string[] }[];
}

export function loadRules(path: string): { file: RuleFile; conventions: Convention[] } {
  const file = JSON.parse(readFileSync(path, 'utf8')) as RuleFile;
  const conventions = file.rules.map((r): Convention => ({
    id: r.id, layer: r.layer, title: r.title, instruction: r.instruction, scope: '', check: r.check,
    support: { matched: 0, total: 0, ratio: 1 }, evidence: [],
    exceptions: r.exempt.map((f) => ({ file: f, line: 1, hint: 'unknown', decision: 'intentional' })),
    confidence: 1, trend: 'unknown', tier: tierOf(r.layer), source: 'miner', status: 'approved', enforce: r.enforce,
  }));
  return { file, conventions };
}
