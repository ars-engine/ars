import type {
  ConventionSet, Experiment, ExperimentConfig, FailureCategory, GateResult, Profile, Proposal, ProposalChange, Run, SkillVersion,
} from '../core/entities.ts';
import { list, mustGet, put, update } from '../core/store.ts';
import type { Convention } from '../core/types.ts';
import { mean, newId, round } from '../core/util.ts';
import { executeExperiment, runsOf } from '../bench/experiment.ts';
import { rewriteInstruction } from '../bench/judge.ts';
import { taskById } from '../bench/tasks.ts';
import { startJob, type JobContext } from '../jobs.ts';
import { llmConfigured } from '../llm/claude.ts';
import { currentConventions, generateSkills, getProfile, latestSkill, publishSkill, readSource } from '../pipeline.ts';
import { defaultDescriptions, skillOf } from '../skills/generate.ts';

/**
 * The improvement loop. Failures are diagnosed from evidence (self-tests, confidence, transcripts,
 * counterfactual reruns), never by asking a model to grade itself. Fixes become candidate skill
 * versions that must pass a gate on dev tasks and held-out tasks before promotion.
 */

const FAIL_BELOW = 0.9;

const DIAGNOSES: Record<FailureCategory, string> = {
  checker: 'The checker itself is unreliable: its self-test missed a planted violation.',
  learned: 'ARS probably learned this rule wrong: its support in your code is weak.',
  unclear: 'The skill was loaded but the instruction was not followed; an explicit reminder fixed it, so the wording is unclear.',
  'not-loaded': 'The agent never loaded the skill that contains this rule.',
  ignored: 'The skill was loaded and the instruction is clear, but the agent still ignored it.',
};

export function describeChange(change: ProposalChange): string {
  switch (change.type) {
    case 'rewrite': return `Rewrite the instruction: "${change.instruction}"`;
    case 'description': return `Sharpen the "${change.skill}" skill trigger description so the agent loads it`;
    case 'enforce': return 'Enforce the rule in the edit hook so the agent is corrected while it works';
    case 'remove': return 'Remove the rule from the skills';
    case 'to-judgment': return 'Score this rule with the rubric judge instead of the broken checker';
  }
}

async function changeFor(category: FailureCategory, c: Convention, profile: Profile, violations: string[]): Promise<ProposalChange> {
  if (category === 'checker') return { type: 'to-judgment' };
  if (category === 'learned') return { type: 'remove' };
  if (category === 'ignored') return { type: 'enforce' };
  if (category === 'not-loaded') {
    const skill = skillOf(c.layer);
    const base = latestSkill(profile.id)?.descriptions?.[skill] ?? defaultDescriptions(profile.name)[skill];
    return { type: 'description', skill, description: `${base} Load this before writing or changing ANY code in this project (${c.scope}).` };
  }
  const evidence = c.evidence.slice(0, 3).map((e) => {
    const line = readSource(profile, e.file).split('\n')[e.line - 1]?.trim() ?? '';
    return `${e.file}:${e.line}  ${line}`;
  });
  if (llmConfigured()) {
    try {
      return { type: 'rewrite', instruction: await rewriteInstruction(c, violations, evidence) };
    } catch {
      /* fall through to the deterministic rewrite */
    }
  }
  return { type: 'rewrite', instruction: `${c.instruction} Correct example from the codebase: \`${evidence[0] ?? c.evidence[0]?.file}\`.` };
}

export function applyChange(conventions: Convention[], conventionId: string, change: ProposalChange): Convention[] {
  return conventions.map((c) => {
    if (c.id !== conventionId) return c;
    switch (change.type) {
      case 'rewrite': return { ...c, instruction: change.instruction, edited: true };
      case 'enforce': return { ...c, enforce: true };
      case 'remove': return { ...c, status: 'rejected' as const };
      case 'to-judgment': return { ...c, check: { type: 'judgment' as const, rubric: c.instruction } };
      default: return c;
    }
  });
}

/** Re-run one failing task with an explicit reminder. Passing now => the instruction was unclear. */
async function counterfactual(profile: Profile, exp: Experiment, run: Run, c: Convention, ctx: JobContext): Promise<boolean> {
  const config: ExperimentConfig = {
    ...exp.config, purpose: 'counterfactual', runs: 1, tests: [run.test === 'T1' ? 'T1' : 'T2'], taskIds: [run.taskId], split: 'all',
    conditions: exp.config.conditions.filter((x) => x.label === run.condition), reminder: { conventionId: c.id, text: c.instruction },
  };
  const cf = put<Experiment>('experiments', { id: newId('exp'), profileId: profile.id, config, status: 'running' });
  ctx.log(`Counterfactual for "${c.title}": rerunning ${run.taskId} with an explicit reminder…`);
  const done = await executeExperiment(cf.id, ctx);
  const rate = done.summary?.conditions[0]?.perConvention[c.id];
  return rate !== undefined && rate >= FAIL_BELOW;
}

export function diagnoseExperiment(profileId: string, experimentId: string, maxCounterfactuals = 2) {
  const profile = getProfile(profileId);
  return startJob('diagnose', `Diagnose failures · ${profile.name}`, profileId, async (ctx) => {
    const exp = mustGet<Experiment>('experiments', experimentId);
    const arsLabels = new Set(exp.config.conditions.filter((c) => c.kind === 'ars').map((c) => c.label));
    const runs = runsOf(experimentId).filter((r) => arsLabels.has(r.condition) && r.result);
    if (!runs.length) throw new Error('This experiment has no finished ARS runs to diagnose.');
    const open = new Set(list<Proposal>('proposals', profileId).filter((p) => ['proposed', 'gating', 'ready'].includes(p.status)).map((p) => p.conventionId));
    let counterfactualsLeft = maxCounterfactuals;
    let created = 0;

    for (const c of currentConventions(profile).filter((x) => x.status === 'approved')) {
      const results = runs.map((r) => ({ run: r, res: r.result!.report.results.find((x) => x.conventionId === c.id) })).filter((x) => x.res?.applicable);
      if (!results.length || open.has(c.id)) continue;
      const rate = mean(results.map((x) => x.res!.passed / x.res!.total));
      if (rate >= FAIL_BELOW) continue;
      const failing = results.filter((x) => x.res!.passed < x.res!.total);
      const skillName = `ars-${profile.slug}-${skillOf(c.layer)}`;
      let category: FailureCategory;
      let note = '';
      if (profile.selftest?.[c.id]?.status === 'failed') category = 'checker';
      else if (c.confidence < 0.6) {
        category = 'learned';
        note = ` Only ${Math.round(c.support.ratio * 100)}% of your code follows it.`;
      } else if (failing.every((x) => !x.run.result!.skillsLoaded.some((s) => s.includes(skillName)))) category = 'not-loaded';
      else if (counterfactualsLeft > 0) {
        counterfactualsLeft--;
        category = (await counterfactual(profile, exp, failing[0].run, c, ctx)) ? 'unclear' : 'ignored';
      } else {
        category = 'unclear';
        note = ' (Counterfactual budget used up: assumed unclear.)';
      }
      const violations = failing.flatMap((x) => x.res!.violations.slice(0, 2).map((v) => `${v.file}:${v.line} found ${v.value ?? ''}`)).slice(0, 6);
      put<Proposal>('proposals', {
        id: newId('prop'), profileId, experimentId, conventionId: c.id, title: c.title, layer: c.layer, category,
        diagnosis: DIAGNOSES[category] + note, change: await changeFor(category, c, profile, violations), rate: round(rate),
        failingRuns: failing.map((x) => x.run.id), sampleViolations: failing.flatMap((x) => x.res!.violations.slice(0, 3)).slice(0, 8),
        status: 'proposed',
      });
      created++;
      ctx.log(`✗ ${c.title}: ${Math.round(rate * 100)}% adherence → ${category}`);
    }
    ctx.log(created ? `${created} proposals created.` : 'No rule fell below 90% adherence. Nothing to fix.');
  });
}

/** Re-categorize a failure (e.g. the developer says "this rule is wrong") and recompute the fix. */
export async function recategorize(proposalId: string, category: FailureCategory): Promise<Proposal> {
  const p = mustGet<Proposal>('proposals', proposalId);
  const profile = getProfile(p.profileId);
  const c = currentConventions(profile).find((x) => x.id === p.conventionId)!;
  const change = await changeFor(category, c, profile, p.sampleViolations.map((v) => `${v.file}:${v.line}`));
  return update<Proposal>('proposals', proposalId, { category, diagnosis: `${DIAGNOSES[category]} (set by you)`, change, status: 'proposed', candidateVersionId: undefined, gate: undefined });
}

function ensureCandidate(p: Proposal): { candidate: SkillVersion; base: SkillVersion } {
  const base = latestSkill(p.profileId, ['published', 'draft']);
  if (!base) throw new Error('No skill package to improve.');
  if (p.candidateVersionId) return { candidate: mustGet<SkillVersion>('skills', p.candidateVersionId), base };
  const descriptions = p.change.type === 'description' ? { ...base.descriptions, [p.change.skill]: p.change.description } : base.descriptions;
  const candidate = generateSkills(p.profileId, {
    conventions: applyChange(base.conventions, p.conventionId, p.change), status: 'candidate', parentId: base.id, descriptions,
    note: `Candidate for "${p.title}": ${describeChange(p.change)}`,
  });
  update<Proposal>('proposals', p.id, { candidateVersionId: candidate.id });
  return { candidate, base };
}

function gateResult(profile: Profile, p: Proposal, runs: Run[], exp: Experiment): GateResult {
  const tol = profile.setup.thresholds.regressionTolerance;
  const byLabel = (label: string) => exp.summary!.conditions.find((c) => c.label === label)!;
  const cur = byLabel('current');
  const cand = byLabel('candidate');
  const heldOutRuns = runs.filter((r) => r.test === 'T2' && taskById(r.taskId)?.split === 'test');
  const pool = heldOutRuns.length ? heldOutRuns : runs;
  const adherenceOf = (label: string) => round(mean(pool.filter((r) => r.condition === label && r.result).map((r) => r.result!.report.adherence)));
  const notes: string[] = [];
  if (!heldOutRuns.length) notes.push('No held-out T2 tasks in this gate; held-out check used all gate runs.');
  const targetBefore = cur.perConvention[p.conventionId] ?? 0;
  const targetAfter = cand.perConvention[p.conventionId] ?? 0;
  const regressions = Object.keys(cur.perConvention)
    .filter((id) => id !== p.conventionId && (cand.perConvention[id] ?? 1) < cur.perConvention[id] - tol)
    .map((id) => ({ conventionId: id, before: cur.perConvention[id], after: cand.perConvention[id] }));
  const removes = p.change.type === 'remove' || p.change.type === 'to-judgment';
  if (removes) notes.push('This change removes or re-scores the rule, so only regressions are checked for the target.');
  const targetOk = removes || targetAfter - targetBefore >= 0.1 || (targetAfter >= 0.99 && targetBefore < 0.99);
  const functionalOk = cand.functional === undefined || cur.functional === undefined || cand.functional >= cur.functional - profile.setup.thresholds.maxFunctionalDrop;
  const heldOutBefore = adherenceOf('current');
  const heldOutAfter = adherenceOf('candidate');
  return {
    passed: targetOk && !regressions.length && functionalOk && heldOutAfter >= heldOutBefore - 0.02,
    targetBefore, targetAfter, regressions, functionalBefore: cur.functional, functionalAfter: cand.functional, heldOutBefore, heldOutAfter, notes,
  };
}

export function gateProposal(proposalId: string) {
  const p = mustGet<Proposal>('proposals', proposalId);
  const profile = getProfile(p.profileId);
  update<Proposal>('proposals', proposalId, { status: 'gating' });
  return startJob('gate', `Gate: ${p.title}`, p.profileId, async (ctx) => {
    try {
      const { candidate, base } = ensureCandidate(p);
      const origin = mustGet<Experiment>('experiments', p.experimentId);
      const config: ExperimentConfig = {
        ...origin.config, purpose: 'gate', proposalId, runs: Math.max(2, origin.config.runs), split: 'all', reminder: undefined, taskIds: undefined,
        tests: origin.config.tests.filter((t) => t !== 'T3'),
        conditions: [{ label: 'current', kind: 'ars', skillVersionId: base.id }, { label: 'candidate', kind: 'ars', skillVersionId: candidate.id }],
      };
      const exp = put<Experiment>('experiments', { id: newId('exp'), profileId: profile.id, config, status: 'running' });
      update<Proposal>('proposals', proposalId, { gateExperimentId: exp.id });
      ctx.log(`Gating v${candidate.version} against v${base.version} on dev and held-out tasks…`);
      const done = await executeExperiment(exp.id, ctx);
      const gate = gateResult(profile, p, runsOf(exp.id), done);
      update<Proposal>('proposals', proposalId, { gate, status: gate.passed ? 'ready' : 'failed-gate' });
      ctx.log(gate.passed ? 'Gate passed: ready to promote.' : 'Gate failed: the candidate is not promoted.');
    } catch (err) {
      update<Proposal>('proposals', proposalId, { status: 'proposed' });
      throw err;
    }
  });
}

export function promoteProposal(proposalId: string): Proposal {
  const p = mustGet<Proposal>('proposals', proposalId);
  if (!p.gate?.passed || !p.candidateVersionId) throw new Error('Only proposals that passed the gate can be promoted.');
  publishSkill(p.profileId, p.candidateVersionId);
  const profile = getProfile(p.profileId);
  const set = mustGet<ConventionSet>('conventionSets', profile.currentAnalysisId!);
  put<ConventionSet>('conventionSets', { ...set, conventions: applyChange(set.conventions, p.conventionId, p.change) });
  return update<Proposal>('proposals', proposalId, { status: 'promoted' });
}

export function dismissProposal(proposalId: string): Proposal {
  const p = mustGet<Proposal>('proposals', proposalId);
  if (p.candidateVersionId) update<SkillVersion>('skills', p.candidateVersionId, { status: 'rejected' });
  return update<Proposal>('proposals', proposalId, { status: 'dismissed' });
}

export const proposalsOf = (profileId: string) => list<Proposal>('proposals', profileId).reverse();
