import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult } from '../core/entities.ts';
import type { Analysis, Convention, Observation } from '../core/types.ts';
import { groupBy, mean, round, runCommand, words } from '../core/util.ts';
import { analyzeDirectory } from '../analyzers/index.ts';
import { syntaxShape } from '../analyzers/typescript.ts';
import { checkConventions } from '../check/checker.ts';
import { judgeRules } from './judge.ts';
import { acceptanceTest, type TaskSpec } from './tasks.ts';

/** Scoring of one agent run: rule adherence, functionality, copying and similarity. */

export interface SourceContext {
  analysis: Analysis;
  terms: string[];
  blocks: Set<string>;
  texts: Map<string, string>;
}

const BLOCK = 4;

/** Normalized 4-line windows, ignoring imports and lone braces. */
export function blockHashes(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3 && !/^(import|export \{|[})\];,]+$)/.test(l));
  const out: string[] = [];
  for (let i = 0; i + BLOCK <= lines.length; i++) out.push(lines.slice(i, i + BLOCK).join('\n'));
  return out;
}

function copyDetection(texts: string[], ctx: SourceContext, allowed: string) {
  const generatedWords = new Set(texts.flatMap((t) => words(t)));
  const allowedWords = new Set(words(allowed));
  const leakedTerms = ctx.terms.filter((t) => generatedWords.has(t) && !allowedWords.has(t));
  const windows = texts.flatMap(blockHashes);
  const shared = windows.filter((w) => ctx.blocks.has(w)).length;
  return { leakedTerms, sharedBlocks: shared, copyRatio: windows.length ? round(shared / windows.length) : 0 };
}

function jaccard(a: Map<string, number>, b: Map<string, number>): number {
  let inter = 0;
  let union = 0;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    inter += Math.min(a.get(k) ?? 0, b.get(k) ?? 0);
    union += Math.max(a.get(k) ?? 0, b.get(k) ?? 0);
  }
  return union ? inter / union : 1;
}

const bigrams = (kinds: string[]) => {
  const m = new Map<string, number>();
  for (let i = 1; i < kinds.length; i++) m.set(`${kinds[i - 1]}>${kinds[i]}`, (m.get(`${kinds[i - 1]}>${kinds[i]}`) ?? 0) + 1);
  return m;
};

/** Stylometric similarity: overlap of observed feature values between original and reconstruction. */
function styleSimilarity(original: Observation[], generated: Observation[]): number {
  const bucket = (o: Observation) => (typeof o.value === 'number' ? `~${Math.round(o.value / 25) * 25}` : JSON.stringify(o.value));
  const a = groupBy(original, (o) => o.feature);
  const b = groupBy(generated, (o) => o.feature);
  const features = new Set([...a.keys(), ...b.keys()]);
  const scores = [...features].map((f) => {
    const va = new Set((a.get(f) ?? []).map(bucket));
    const vb = new Set((b.get(f) ?? []).map(bucket));
    const inter = [...va].filter((v) => vb.has(v)).length;
    return inter / new Set([...va, ...vb]).size;
  });
  return scores.length ? round(mean(scores)) : 0;
}

async function runFunctionalTests(workspace: string, task: TaskSpec, signal?: AbortSignal): Promise<RunResult['functional']> {
  const dir = join(workspace, 'ars-acceptance');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'acceptance.test.tsx'), acceptanceTest(task));
  const out = join(dir, 'result.json');
  const bin = (name: string) => join(workspace, 'node_modules/.bin', name);
  // Failing tests exit non-zero; the results are still in the JSON file.
  await runCommand(bin('vitest'), ['run', 'ars-acceptance', '--reporter=json', `--outputFile=${out}`], { cwd: workspace, timeout: 240_000, signal });
  let passed = 0;
  let total = 5;
  if (existsSync(out)) {
    const r = JSON.parse(readFileSync(out, 'utf8'));
    passed = r.numPassedTests ?? 0;
    total = r.numTotalTests || total;
  }
  const typecheck = await runCommand(bin('tsc'), ['--noEmit', '-p', '.'], { cwd: workspace, timeout: 180_000, signal });
  return { passed, total, typecheck, score: round(passed / total) };
}

export interface ScoreInput {
  workspace: string;
  changed: string[];
  conventions: Convention[];
  test: 'T1' | 'T2' | 'playground';
  task?: TaskSpec;
  heldOutPath?: string;
  source: SourceContext;
  useJudge: boolean;
  allowedText: string;
  signal?: AbortSignal;
}

export async function scoreRun(i: ScoreInput): Promise<Omit<RunResult, 'usage' | 'skillsLoaded'>> {
  const analysis = analyzeDirectory(i.workspace);
  const code = i.changed.filter((f) => /\.[cm]?[jt]sx?$/.test(f));
  const scoreDeps = i.test === 'T2' || i.changed.includes('package.json');
  const rules = i.conventions.filter((c) => c.status === 'approved' && c.check.type !== 'judgment' && (scoreDeps || c.check.type !== 'dependency'));
  const report = await checkConventions(rules, analysis, { files: new Set(i.changed) });
  const texts = code.map((f) => readFileSync(join(i.workspace, f), 'utf8'));

  const result: Omit<RunResult, 'usage' | 'skillsLoaded'> = { report, files: i.changed };
  if (i.test === 'T2' && i.task) result.functional = await runFunctionalTests(i.workspace, i.task, i.signal);
  if (i.test !== 'T1') result.copy = copyDetection(texts, i.source, i.allowedText);
  if (i.test === 'T1' && i.heldOutPath && existsSync(join(i.workspace, i.heldOutPath))) {
    const original = i.source.texts.get(i.heldOutPath) ?? '';
    const generated = readFileSync(join(i.workspace, i.heldOutPath), 'utf8');
    result.similarity = {
      style: styleSimilarity(
        i.source.analysis.observations.filter((o) => o.file === i.heldOutPath),
        analysis.observations.filter((o) => o.file === i.heldOutPath),
      ),
      ast: round(jaccard(bigrams(syntaxShape(i.heldOutPath, original)), bigrams(syntaxShape(i.heldOutPath, generated)))),
    };
  }
  const judgment = i.conventions.filter((c) => c.status === 'approved' && c.check.type === 'judgment');
  if (i.useJudge && judgment.length && code.length) {
    result.judgeScores = await judgeRules(judgment, code.slice(0, 4).map((f, k) => ({ path: f, text: texts[k] }))).catch(() => undefined);
  }
  return result;
}
