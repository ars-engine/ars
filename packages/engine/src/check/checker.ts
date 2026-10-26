import type { Analysis, CheckReport, Convention, ConventionResult, Evidence, Layer } from '../core/types.ts';
import { groupBy, mean } from '../core/util.ts';
import { isFormattable, isFormatted } from '../analyzers/format.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchesFeature } from './match.ts';

export interface CheckOptions {
  /** Only evaluate these files (e.g. the files an agent wrote). */
  files?: Set<string>;
  /** Count decided "intentional" exceptions as passing (used on the source repo). */
  honorExceptions?: boolean;
  /** Read file text (defaults to disk under analysis.root). */
  readText?: (path: string) => string;
}

const MAX_VIOLATIONS = 25;

/** Evaluate conventions against an analysis. Judgment rules are scored separately by the LLM judge. */
export async function checkConventions(conventions: Convention[], analysis: Analysis, opts: CheckOptions = {}): Promise<CheckReport> {
  const inScope = (file: string) => !opts.files || opts.files.has(file);
  const read = opts.readText ?? ((p: string) => readFileSync(join(analysis.root, p), 'utf8'));
  const byFeature = groupBy(analysis.observations, (o) => o.feature);
  const results: ConventionResult[] = [];

  for (const c of conventions) {
    const exempt = new Set(opts.honorExceptions ? c.exceptions.filter((e) => e.decision === 'intentional').map((e) => e.file) : []);
    const violations: Evidence[] = [];
    let passed = 0;
    let total = 0;
    const tally = (ok: boolean, ev: Evidence) => {
      total++;
      if (ok) passed++;
      else if (violations.length < MAX_VIOLATIONS) violations.push(ev);
    };
    const check = c.check;

    if (check.type === 'feature') {
      for (const o of byFeature.get(check.feature) ?? []) {
        if (!inScope(o.file) || exempt.has(o.file)) continue;
        tally(matchesFeature(check, o.value), { file: o.file, line: o.line, value: JSON.stringify(o.value) });
      }
    } else if (check.type === 'formatting') {
      for (const f of analysis.files) {
        if (!isFormattable(f.path) || !inScope(f.path) || f.role === 'config') continue;
        tally(await isFormatted(read(f.path), f.path, check.options), { file: f.path, line: 1, value: 'not formatted' });
      }
    } else if (check.type === 'dependency') {
      const deps = Object.keys(analysis.dependencies);
      const used = deps.filter((d) => check.alternatives.includes(d));
      if (deps.includes(check.lib) || used.length) {
        tally(!used.length, { file: 'package.json', line: 1, value: used.join(', ') || check.lib });
      }
    } else if (check.type === 'pattern') {
      const re = new RegExp(check.regex, 'm');
      for (const f of analysis.files) {
        if ((check.role && f.role !== check.role) || !inScope(f.path) || exempt.has(f.path) || !/\.[jt]sx?$/.test(f.path)) continue;
        const present = re.test(read(f.path));
        tally(check.expect === 'present' ? present : !present, { file: f.path, line: 1 });
      }
    }
    results.push({ conventionId: c.id, layer: c.layer, applicable: total > 0, passed, total, violations });
  }
  return summarize(results);
}

export function summarize(results: ConventionResult[]): CheckReport {
  const applicable = results.filter((r) => r.applicable);
  const score = (rs: ConventionResult[]) => mean(rs.map((r) => r.passed / r.total));
  const byLayer: Partial<Record<Layer, number>> = {};
  for (const [layer, rs] of groupBy(applicable, (r) => r.layer)) byLayer[layer as Layer] = score(rs);
  return { results, adherence: score(applicable), byLayer };
}
