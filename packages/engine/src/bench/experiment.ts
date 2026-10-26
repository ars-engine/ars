import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConditionSummary, Experiment, ExperimentConfig, ExperimentSummary, HeldOutFile, Profile, Run, SkillVersion,
} from '../core/entities.ts';
import { facts } from '../core/factsCache.ts';
import { dataPath, ensureDir } from '../core/paths.ts';
import { get, list, mustGet, put, update } from '../core/store.ts';
import type { Convention, Layer } from '../core/types.ts';
import { bootstrapCI, clamp, groupBy, mean, newId, round } from '../core/util.ts';
import { ingest } from '../ingest/ingest.ts';
import { startJob, type JobContext } from '../jobs.ts';
import { accountProblem, llmConfigured, LlmUnavailableError, MODELS } from '../llm/claude.ts';
import { currentAnalysis, currentConventions, getProfile, latestSkill, touchProfile } from '../pipeline.ts';
import { domainTerms } from '../skills/dedomain.ts';
import { runAgent } from './agent.ts';
import { describeForReconstruction, spotGenerated } from './judge.ts';
import { blockHashes, scoreRun, type SourceContext } from './score.ts';
import { taskById, taskPrompt, TASKS } from './tasks.ts';
import { changedFiles, installCondition, repoWorkspace, scaffoldWorkspace, snapshot } from './workspace.ts';

/** Experiments: run the coding agent under each condition on held-out tasks, then score. */

interface Unit {
  test: Run['test'];
  taskId: string;
  prompt: string;
  heldOut?: HeldOutFile;
}

const MAX_TURNS = { T1: 40, T2: 80, playground: 40 } as const;
const TOKENS_PER_RUN = { T1: { input: 300_000, output: 8_000 }, T2: { input: 900_000, output: 30_000 }, playground: { input: 200_000, output: 8_000 } };

function exportsOf(text: string): string[] {
  return [...text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/g)].map((m) => m[1]);
}

/** T1 brief. Uses Claude when available; otherwise a structural description from the code. */
async function describeHeldOut(profile: Profile, h: HeldOutFile): Promise<string> {
  if (h.description) return h.description;
  const text = readFileSync(join(profile.repoDir, h.path), 'utf8');
  const description = llmConfigured()
    ? await describeForReconstruction({ path: h.path, text })
    : `A ${h.role} module. It exports: ${exportsOf(text).join(', ') || '(see usages in the codebase)'}. Find where it is imported in the codebase to infer what it must do.`;
  const heldOut = profile.setup.heldOut.map((x) => (x.path === h.path ? { ...x, description } : x));
  touchProfile(profile.id, { setup: { ...profile.setup, heldOut } });
  return description;
}

const reconstructionPrompt = (h: HeldOutFile, description: string) => `Implement the file \`${h.path}\` in this existing codebase. It is currently missing.

What it should do:
${description}

The rest of the project is present: read the code around it and integrate with existing modules. Only create or edit what this file needs. When the file is complete, stop.`;

async function unitsFor(profile: Profile, config: ExperimentConfig): Promise<Unit[]> {
  if (config.purpose === 'playground') {
    return [{ test: 'playground', taskId: 'playground', prompt: `${config.prompt}\n\nWrite the code under src/. Do not install packages. When done, stop.` }];
  }
  const units: Unit[] = [];
  if (config.tests.includes('T1')) {
    for (const h of profile.setup.heldOut.filter((x) => !config.taskIds || config.taskIds.includes(x.path))) {
      units.push({ test: 'T1', taskId: h.path, prompt: reconstructionPrompt(h, await describeHeldOut(getProfile(profile.id), h)), heldOut: h });
    }
  }
  if (config.tests.includes('T2')) {
    for (const t of TASKS.filter((x) => (config.split === 'all' || x.split === config.split) && (!config.taskIds || config.taskIds.includes(x.id)))) {
      units.push({ test: 'T2', taskId: t.id, prompt: taskPrompt(t) });
    }
  }
  return units;
}

export function estimateCost(config: ExperimentConfig, profile: Profile): { runs: number; usd: number } {
  const t1 = config.tests.includes('T1') ? profile.setup.heldOut.length : 0;
  const t2 = config.tests.includes('T2') ? TASKS.filter((t) => config.split === 'all' || t.split === config.split).length : 0;
  const price = MODELS.find((m) => m.id === config.model) ?? MODELS[0];
  // Most agent input is served from prompt cache, billed at roughly a tenth of the input price.
  const perRun = (k: keyof typeof TOKENS_PER_RUN) => (TOKENS_PER_RUN[k].input * price.input * 0.15 + TOKENS_PER_RUN[k].output * price.output) / 1e6;
  const runsPer = config.conditions.length * config.runs;
  const usd = config.purpose === 'playground' ? perRun('playground') * config.conditions.length : runsPer * (t1 * perRun('T1') + t2 * perRun('T2'));
  return { runs: config.purpose === 'playground' ? config.conditions.length : runsPer * (t1 + t2), usd: round(usd) };
}

function sourceContext(profile: Profile): SourceContext {
  const analysisDoc = currentAnalysis(profile)!;
  const analysis = facts(analysisDoc.factsPath);
  const { texts } = ingest(profile.repoDir);
  return { analysis, texts, terms: domainTerms(analysis), blocks: new Set([...texts.values()].flatMap(blockHashes)) };
}

const stopIfCancelled = (ctx: JobContext) => {
  if (ctx.signal.aborted) throw new Error('Experiment cancelled');
};

async function executeRun(run: Run, unit: Unit, exp: Experiment, profile: Profile, scoring: Convention[], src: SourceContext, ctx: JobContext) {
  const condition = exp.config.conditions.find((c) => c.label === run.condition)!;
  const ws = run.workspace;
  if (unit.test === 'T1') repoWorkspace(ws, profile.repoDir, new Set(profile.setup.heldOut.map((h) => h.path)));
  else await scaffoldWorkspace(ws, unit.test === 'T2', ctx.log, ctx.signal);
  stopIfCancelled(ctx);
  const arsVersion = skillVersionOf(exp.config.conditions.find((c) => c.kind === 'ars')?.skillVersionId) ?? latestSkill(profile.id);
  installCondition(ws, condition, profile, arsVersion?.wordCount ?? 800);
  const before = snapshot(ws);
  const reminder = exp.config.reminder ? `\n\nImportant: ${exp.config.reminder.text}` : '';

  put('runs', { ...run, status: 'running' });
  const out = await runAgent({
    cwd: ws, prompt: unit.prompt + reminder, model: exp.config.model, maxTurns: MAX_TURNS[unit.test],
    maxBudgetUsd: exp.config.maxBudgetUsd, allowBash: unit.test === 'T2', transcriptPath: run.transcriptPath,
    onEvent: (line) => ctx.log(`  [${run.condition} · ${unit.taskId}] ${line}`), signal: ctx.signal,
  });
  stopIfCancelled(ctx);
  const problem = out.error && accountProblem(out.error);
  if (problem) throw new LlmUnavailableError(problem);
  const changed = changedFiles(before, snapshot(ws));
  ctx.log(`  [${run.condition} · ${unit.taskId}] agent finished: ${changed.length} files, $${out.usage.costUsd.toFixed(2)}${out.error ? ` (${out.error})` : ''}; scoring…`);
  const scored = await scoreRun({
    workspace: ws, changed, conventions: scoring, test: unit.test, task: taskById(unit.taskId), heldOutPath: unit.heldOut?.path,
    source: src, useJudge: exp.config.useJudge && llmConfigured(), allowedText: unit.prompt, signal: ctx.signal,
  });
  put<Run>('runs', { ...run, status: changed.length ? 'done' : 'failed', error: out.error ?? (changed.length ? undefined : 'agent wrote no files'), result: { ...scored, usage: out.usage, skillsLoaded: out.skillsLoaded } });
}

function summarizeCondition(label: string, runs: Run[]): ConditionSummary {
  const done = runs.filter((r) => r.result);
  const adherence = done.map((r) => r.result!.report.adherence);
  const layers = groupBy(done.flatMap((r) => Object.entries(r.result!.report.byLayer)), ([l]) => l);
  const byLayer = Object.fromEntries([...layers].map(([l, xs]) => [l, round(mean(xs.map(([, v]) => v as number)))])) as Partial<Record<Layer, number>>;
  const scores = new Map<string, number[]>();
  const add = (id: string, v: number) => scores.set(id, [...(scores.get(id) ?? []), v]);
  for (const r of done) {
    for (const x of r.result!.report.results) if (x.applicable) add(x.conventionId, x.passed / x.total);
    for (const [id, ok] of Object.entries(r.result!.judgeScores ?? {})) add(id, ok ? 1 : 0);
  }
  const perConvention = Object.fromEntries([...scores].map(([id, vs]) => [id, round(mean(vs))]));
  const functional = done.filter((r) => r.result!.functional).map((r) => r.result!.functional!.score);
  const similarity = done.filter((r) => r.result!.similarity).map((r) => (r.result!.similarity!.style + r.result!.similarity!.ast) / 2);
  const [lo, hi] = bootstrapCI(adherence);
  return {
    label, runs: done.length, adherence: round(mean(adherence)), ci: [round(lo), round(hi)], byLayer,
    functional: functional.length ? round(mean(functional)) : undefined,
    similarity: similarity.length ? round(mean(similarity)) : undefined,
    costUsd: round(done.reduce((n, r) => n + r.result!.usage.costUsd, 0)), perConvention,
  };
}

/** T3: a blind judge tries to spot which of two files was not written by the developer. */
async function indistinguishability(profile: Profile, runs: Run[], src: SourceContext, ctx: JobContext) {
  const out: NonNullable<ExperimentSummary['t3']> = {};
  const real = src.analysis.files.filter((f) => ['component', 'hook', 'route'].includes(f.role) && f.lines >= 20 && f.lines <= 200);
  if (real.length < 4) return out;
  const pick = (i: number) => real[(i * 7919) % real.length];
  const references = [pick(1), pick(2)].map((f) => ({ path: 'reference', text: src.texts.get(f.path) ?? '' }));
  for (const [label, rs] of groupBy(runs.filter((r) => r.result), (r) => r.condition)) {
    const generated = rs.flatMap((r) => r.result!.files.filter((f) => /\.tsx$/.test(f)).slice(0, 2).map((f) => ({ run: r, file: f }))).slice(0, 6);
    let correct = 0;
    for (const [i, g] of generated.entries()) {
      const realFile = pick(i + 3);
      const gen = { path: 'x', text: readFileSync(join(g.run.workspace, g.file), 'utf8') };
      const re = { path: 'x', text: src.texts.get(realFile.path) ?? '' };
      const genIsA = i % 2 === 0;
      const answer = await spotGenerated(references, genIsA ? gen : re, genIsA ? re : gen);
      if ((answer === 'A') === genIsA) correct++;
    }
    if (generated.length) {
      const acc = correct / generated.length;
      out[label] = { pairs: generated.length, detectionAccuracy: round(acc), indistinguishability: round(clamp(2 * (1 - acc))) };
      ctx.log(`T3 [${label}]: judge spotted the imitation in ${correct}/${generated.length} pairs.`);
    }
  }
  return out;
}

function verdict(profile: Profile, s: ExperimentSummary): ExperimentSummary['verdict'] {
  const t = profile.setup.thresholds;
  const ars = s.conditions.find((c) => c.label === 'ars');
  const baselines = s.conditions.filter((c) => c.label !== 'ars');
  if (!ars || !baselines.length) return undefined;
  const best = baselines.reduce((a, b) => (b.adherence > a.adherence ? b : a));
  const out = [{ name: 'Convention lift', passed: ars.adherence - best.adherence >= t.minLift, detail: `ARS ${Math.round(ars.adherence * 100)}% vs best baseline (${best.label}) ${Math.round(best.adherence * 100)}%; needs +${Math.round(t.minLift * 100)} pts` }];
  if (ars.functional !== undefined) {
    const bestF = Math.max(...baselines.map((b) => b.functional ?? 0));
    out.push({ name: 'Functional correctness', passed: ars.functional >= bestF - t.maxFunctionalDrop, detail: `ARS ${Math.round(ars.functional * 100)}% vs best baseline ${Math.round(bestF * 100)}%; max drop ${Math.round(t.maxFunctionalDrop * 100)} pts` });
  }
  const t3 = s.t3?.ars;
  if (t3) out.push({ name: 'Indistinguishability', passed: t3.indistinguishability >= t.minIndistinguishability, detail: `${Math.round(t3.indistinguishability * 100)}% (judge accuracy ${Math.round(t3.detectionAccuracy * 100)}%); needs ${Math.round(t.minIndistinguishability * 100)}%` });
  return out;
}

/** Runs an experiment to completion inside an existing job (used directly by the gate and counterfactuals). */
export async function executeExperiment(expId: string, ctx: JobContext): Promise<Experiment> {
  try {
    return await runExperiment(expId, ctx);
  } catch (err) {
    update<Experiment>('experiments', expId, { status: 'failed', finishedAt: Date.now() });
    throw err;
  }
}

async function runExperiment(expId: string, ctx: JobContext): Promise<Experiment> {
  const exp = mustGet<Experiment>('experiments', expId);
  const profile = getProfile(exp.profileId);
  const scoring = currentConventions(profile);
  const src = sourceContext(profile);
  const units = await unitsFor(profile, exp.config);
  const plan = units.flatMap((u) => exp.config.conditions.flatMap((c) => Array.from({ length: exp.config.purpose === 'playground' ? 1 : exp.config.runs }, (_, rep) => ({ u, c, rep }))));
  ctx.log(`${plan.length} agent runs planned (${units.length} tasks × ${exp.config.conditions.length} conditions × ${exp.config.runs} repeats).`);

  const runs: Run[] = [];
  for (const [i, { u, c, rep }] of plan.entries()) {
    stopIfCancelled(ctx);
    const id = newId('run');
    const run = put<Run>('runs', {
      id, profileId: profile.id, experimentId: exp.id, test: u.test, condition: c.label, taskId: u.taskId, rep, status: 'queued',
      workspace: ensureDir(dataPath('runs', id, 'ws', '.keep').replace(/\/\.keep$/, '')), transcriptPath: dataPath('runs', id, 'transcript.json'),
    });
    ctx.log(`Run ${i + 1}/${plan.length}: ${u.test} ${u.taskId} · ${c.label} · repeat ${rep + 1}`);
    try {
      await executeRun(run, u, exp, profile, scoring, src, ctx);
    } catch (err) {
      put<Run>('runs', { ...mustGet<Run>('runs', id), status: 'failed', error: (err as Error).message });
      // An account problem fails every remaining run the same way: stop instead of spending the queue.
      if (err instanceof LlmUnavailableError) throw new Error(`Experiment aborted after run ${i + 1}/${plan.length}. ${err.message}`);
      stopIfCancelled(ctx);
      ctx.log(`  run failed: ${(err as Error).message}`);
    }
    runs.push(mustGet<Run>('runs', id));
    ctx.progress((i + 1) / (plan.length + (exp.config.tests.includes('T3') ? 1 : 0)));
  }

  const summary: ExperimentSummary = { conditions: exp.config.conditions.map((c) => summarizeCondition(c.label, runs.filter((r) => r.condition === c.label))) };
  stopIfCancelled(ctx);
  if (exp.config.tests.includes('T3') && llmConfigured()) summary.t3 = await indistinguishability(profile, runs, src, ctx);
  if (exp.config.purpose === 'lab') summary.verdict = verdict(profile, summary);
  if (exp.config.purpose === 'probe' || exp.config.purpose === 'lab') {
    const none = summary.conditions.find((c) => c.label === 'none');
    if (none?.runs) touchProfile(profile.id, { baseline: { ...profile.baseline, ...none.perConvention } });
  }
  return update<Experiment>('experiments', exp.id, { status: 'done', summary, finishedAt: Date.now() });
}

export function createExperiment(profileId: string, config: ExperimentConfig): Experiment {
  const profile = getProfile(profileId);
  if (!currentAnalysis(profile)) throw new Error('Analyze the profile first.');
  const ars = latestSkill(profileId, ['published', 'draft']);
  const conditions = config.conditions.map((c) => {
    if (c.kind !== 'ars' || c.skillVersionId) return c;
    if (!ars) throw new Error('Generate a skill package before running ARS conditions.');
    return { ...c, skillVersionId: ars.id };
  });
  if (config.purpose === 'lab' && !profile.setup.lockedAt) touchProfile(profileId, { setup: { ...profile.setup, lockedAt: Date.now() } });
  const exp = put<Experiment>('experiments', { id: newId('exp'), profileId, config: { ...config, conditions }, status: 'running' });
  const label = config.purpose === 'playground' ? 'Playground' : `${config.purpose === 'lab' ? 'Experiment' : config.purpose} ${config.tests.join('+')}`;
  const job = startJob('experiment', `${label} · ${profile.name}`, profileId, async (ctx) => {
    await executeExperiment(exp.id, ctx);
  });
  return update<Experiment>('experiments', exp.id, { jobId: job.id });
}

export const experimentsOf = (profileId: string) => list<Experiment>('experiments', profileId).reverse();
export const runsOf = (experimentId: string) => list<Run>('runs').filter((r) => r.experimentId === experimentId);
export const skillVersionOf = (id?: string) => (id ? get<SkillVersion>('skills', id) : undefined);
