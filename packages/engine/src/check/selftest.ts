import { dirname, join } from 'node:path';
import type { Analysis, Convention } from '../core/types.ts';
import { analyzeDirectory } from '../analyzers/index.ts';
import { formatText } from '../analyzers/format.ts';
import { FEATURE_MAP } from '../mine/features.ts';
import { checkConventions } from './checker.ts';

/**
 * Checker self-test: plant a deliberate violation for each rule and confirm the checker catches it.
 * A rule whose checker cannot catch its own violation would silently score everything as passing.
 */

export type SelfTestStatus = 'passed' | 'failed' | 'untestable';

export interface SelfTestResult {
  status: SelfTestStatus;
  detail: string;
}

const NO_GIT_ROOT = '/__ars_selftest__';

function miniAnalysis(files: Record<string, string>): Analysis {
  const texts = new Map(Object.entries(files));
  return analyzeDirectory(NO_GIT_ROOT, { root: NO_GIT_ROOT, files: [...texts.keys()], texts, skipped: [], secrets: [] });
}

async function caught(c: Convention, files: Record<string, string>, target: string, analysis = miniAnalysis(files)): Promise<boolean> {
  const report = await checkConventions([c], analysis, { files: new Set([target]), readText: (p) => files[p] ?? '' });
  return report.results[0].violations.length > 0;
}

async function testOne(c: Convention, texts: Map<string, string>): Promise<SelfTestResult> {
  const check = c.check;
  const sample = c.evidence[0]?.file;
  if (check.type === 'feature') {
    const plant = FEATURE_MAP.get(check.feature)?.plant?.(check.expected);
    if (!plant || !sample) return { status: 'untestable', detail: 'no violation template for this rule yet' };
    const target = plant.file ? (plant.file.atRoot ? plant.file.name : join(dirname(sample), plant.file.name)) : sample;
    const content = plant.file ? plant.file.content : `${texts.get(sample) ?? ''}${plant.append}`;
    const ok = await caught(c, { [target]: content }, target);
    return ok ? { status: 'passed', detail: `planted violation in ${target} was caught` } : { status: 'failed', detail: `planted violation in ${target} was NOT caught` };
  }
  if (check.type === 'formatting') {
    const file = [...texts.keys()].find((p) => /\.[jt]sx?$/.test(p) && !/config|rc\./.test(p) && (texts.get(p) ?? '').length > 200);
    if (!file) return { status: 'untestable', detail: 'no sample file' };
    const flipped = await formatText(texts.get(file)!, file, { ...check.options, semi: !check.options.semi, singleQuote: !check.options.singleQuote }).catch(() => undefined);
    if (!flipped) return { status: 'untestable', detail: 'sample could not be formatted' };
    const ok = await caught(c, { [file]: flipped }, file);
    return ok ? { status: 'passed', detail: 'mis-formatted copy was caught' } : { status: 'failed', detail: 'mis-formatted copy was NOT caught' };
  }
  if (check.type === 'dependency') {
    const analysis: Analysis = { ...miniAnalysis({}), dependencies: { [check.alternatives[0]]: '1.0.0' } };
    const ok = await caught(c, {}, 'package.json', analysis);
    return ok ? { status: 'passed', detail: `adding ${check.alternatives[0]} was caught` } : { status: 'failed', detail: 'competing library was NOT caught' };
  }
  if (check.type === 'pattern') {
    const violating = check.expect === 'present' ? '// ars planted\nexport const arsPlanted = 1;\n' : sample && c.exceptions[0] ? texts.get(c.exceptions[0].file) : undefined;
    if (!violating) return { status: 'untestable', detail: 'no violating example available' };
    const target = 'src/arsPlanted.ts';
    const analysis = miniAnalysis({ [target]: violating });
    if (check.role) analysis.files.forEach((f) => (f.role = check.role!));
    const ok = await caught(c, { [target]: violating }, target, analysis);
    return ok ? { status: 'passed', detail: 'planted violation was caught' } : { status: 'failed', detail: 'planted violation was NOT caught' };
  }
  return { status: 'untestable', detail: 'judgment rules are calibrated against your review votes instead' };
}

export async function selfTest(conventions: Convention[], texts: Map<string, string>): Promise<Record<string, SelfTestResult>> {
  const out: Record<string, SelfTestResult> = {};
  for (const c of conventions) {
    try {
      out[c.id] = await testOne(c, texts);
    } catch (err) {
      out[c.id] = { status: 'failed', detail: `self-test crashed: ${(err as Error).message}` };
    }
  }
  return out;
}
