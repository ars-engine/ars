import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type {
  AnalysisDoc, ConventionSet, Decision, Experiment, HeldOutFile, Profile, Proposal, SkillVersion, StyleChange,
} from './core/entities.ts';
import { DEFAULT_THRESHOLDS } from './core/entities.ts';
import { facts } from './core/factsCache.ts';
import { dataPath } from './core/paths.ts';
import { get, list, mustGet, put, update } from './core/store.ts';
import type { Analysis, Convention, Layer, Role } from './core/types.ts';
import { countBy, newId, slug } from './core/util.ts';
import { analyzeDirectory } from './analyzers/index.ts';
import { inferFormatting } from './analyzers/format.ts';
import { saveFacts } from './core/facts.ts';
import { selfTest } from './check/selftest.ts';
import { cloneRepo, headSha, isRemoteSource } from './ingest/git.ts';
import { ingest } from './ingest/ingest.ts';
import { startJob, type JobContext } from './jobs.ts';
import { AGENT_MODEL, llmConfigured } from './llm/claude.ts';
import { deepRead } from './mine/deepread.ts';
import { mineConventions } from './mine/miner.ts';
import { generateSkillPackage } from './skills/generate.ts';

/** Profile lifecycle: create → analyze → review → generate skills. Every step is idempotent. */

// ── Profiles ──────────────────────────────────────────────────────────

export function createProfile(source: string, name?: string): { profile: Profile; jobId: string } {
  const trimmed = source.trim();
  const remote = isRemoteSource(trimmed);
  if (!remote && !existsSync(resolve(trimmed))) throw new Error(`Folder not found: ${trimmed}`);
  const id = newId('prof');
  const repoName = basename(trimmed.replace(/\/$/, '')).replace(/\.git$/, '');
  const profile = put<Profile>('profiles', {
    id, name: name?.trim() || repoName, slug: slug(name?.trim() || repoName), source: trimmed,
    sourceType: remote ? 'git' : 'local',
    repoDir: remote ? dataPath('profiles', id, 'repo', '.keep').replace(/\/\.keep$/, '') : resolve(trimmed),
    setup: { thresholds: { ...DEFAULT_THRESHOLDS }, heldOut: [], model: AGENT_MODEL },
    updatedAt: Date.now(),
  });
  return { profile, jobId: analyzeProfile(profile.id).id };
}

export const getProfile = (id: string) => mustGet<Profile>('profiles', id);
export const touchProfile = (id: string, patch: Partial<Profile>) => update<Profile>('profiles', id, { ...patch, updatedAt: Date.now() });

export function currentAnalysis(profile: Profile): AnalysisDoc | undefined {
  return profile.currentAnalysisId ? get<AnalysisDoc>('analyses', profile.currentAnalysisId) : undefined;
}

export function conventionsOf(analysisId: string): Convention[] {
  return get<ConventionSet>('conventionSets', analysisId)?.conventions ?? [];
}

export function currentConventions(profile: Profile): Convention[] {
  return profile.currentAnalysisId ? conventionsOf(profile.currentAnalysisId) : [];
}

export function readSource(profile: Profile, path: string): string {
  const abs = join(profile.repoDir, path);
  if (!abs.startsWith(profile.repoDir) || !existsSync(abs)) throw new Error(`File not in repository: ${path}`);
  return readFileSync(abs, 'utf8');
}

// ── Analysis ──────────────────────────────────────────────────────────

const HELD_OUT_QUOTA: Partial<Record<Role, number>> = { component: 3, hook: 1, api: 1 };

/** Pick files to hide from mining, for the reconstruction test (T1). Spread across the repo. */
function chooseHeldOut(analysis: Analysis): HeldOutFile[] {
  const picks: HeldOutFile[] = [];
  for (const [role, n] of Object.entries(HELD_OUT_QUOTA) as [Role, number][]) {
    const pool = analysis.files.filter((f) => f.role === role && f.lines >= 30 && f.lines <= 150).sort((a, b) => a.path.localeCompare(b.path));
    const step = Math.max(1, Math.floor(pool.length / (n + 1)));
    for (let i = 1; i <= n && i * step - 1 < pool.length; i++) picks.push({ path: pool[i * step - 1].path, role });
  }
  return picks;
}

/** Keep the developer's earlier decisions when a profile is re-analyzed. */
function carryOver(prev: Convention[], next: Convention[]): Convention[] {
  const byId = new Map(prev.map((c) => [c.id, c]));
  return next.map((c) => {
    const p = byId.get(c.id);
    if (!p) return c;
    const decisions = new Map(p.exceptions.filter((e) => e.decision).map((e) => [e.file, e.decision]));
    return {
      ...c,
      status: p.autoApproved && c.autoApproved ? c.status : p.status === 'pending' ? c.status : p.status,
      autoApproved: p.status === 'pending' || p.autoApproved ? c.autoApproved : false,
      instruction: p.edited ? p.instruction : c.instruction,
      edited: p.edited,
      enforce: p.enforce,
      voiceVote: p.voiceVote,
      exceptions: c.exceptions.map((e) => ({ ...e, decision: decisions.get(e.file) ?? e.decision })),
    };
  });
}

function styleChanges(prev: Convention[], next: Convention[]): StyleChange[] {
  const before = new Map(prev.map((c) => [c.id, c]));
  const after = new Map(next.map((c) => [c.id, c]));
  const changes: StyleChange[] = [];
  for (const c of next) {
    const p = before.get(c.id);
    if (!p) changes.push({ conventionId: c.id, title: c.title, kind: 'added', after: c.title });
    else if (p.title !== c.title || Math.abs(p.support.ratio - c.support.ratio) >= 0.1) {
      changes.push({ conventionId: c.id, title: c.title, kind: 'changed', before: `${p.title} (${Math.round(p.support.ratio * 100)}%)`, after: `${c.title} (${Math.round(c.support.ratio * 100)}%)` });
    }
  }
  for (const p of prev) if (!after.has(p.id)) changes.push({ conventionId: p.id, title: p.title, kind: 'removed', before: p.title });
  return changes;
}

function syncRepository(profile: Profile, ctx: JobContext) {
  if (profile.sourceType !== 'git') return;
  if (!existsSync(join(profile.repoDir, '.git'))) {
    ctx.log(`Cloning ${profile.source} (using this machine's git credentials)…`);
    cloneRepo(profile.source, profile.repoDir);
  } else {
    ctx.log('Pulling latest commits…');
    try {
      execFileSync('git', ['pull', '--ff-only'], { cwd: profile.repoDir, stdio: 'pipe' });
    } catch (err) {
      ctx.log(`git pull failed, analyzing the existing checkout: ${(err as Error).message.split('\n')[0]}`);
    }
  }
}

/** Mine, deep-read and self-test conventions for an analysis. Shared by analyze and re-mine. */
async function learnConventions(profile: Profile, analysisDoc: AnalysisDoc, analysis: Analysis, texts: Map<string, string>, ctx: JobContext) {
  const heldOut = new Set(profile.setup.heldOut.map((h) => h.path));
  ctx.log(`Mining conventions (${heldOut.size} held-out files excluded)…`);
  let conventions = mineConventions({ analysis, formatting: analysisDoc.formatting!, heldOut });
  ctx.log(`Found ${conventions.length} deterministic conventions.`);
  ctx.progress(0.7);

  if (llmConfigured()) {
    ctx.log('Deep-reading representative files with Claude for architecture and voice…');
    try {
      const r = await deepRead(analysis, texts, conventions, heldOut);
      conventions = [...conventions, ...r.conventions];
      analysisDoc.dossier = r.dossier;
      analysisDoc.llm = 'done';
      ctx.log(`Deep-read proposed ${r.conventions.length} conventions (pattern rules verified against your code).`);
    } catch (err) {
      analysisDoc.llm = 'failed';
      analysisDoc.llmNote = (err as Error).message;
      ctx.log(`Deep-read skipped: ${analysisDoc.llmNote}`);
    }
  } else {
    analysisDoc.llm = 'skipped';
    analysisDoc.llmNote = 'Set ANTHROPIC_API_KEY to add LLM deep-read (L5/L6 judgment conventions and a style dossier).';
    ctx.log(analysisDoc.llmNote);
  }
  ctx.progress(0.85);

  ctx.log('Self-testing every checker with planted violations…');
  const selftest = await selfTest(conventions, texts);
  const counts = countBy(Object.values(selftest), (r) => r.status);
  ctx.log(`Self-test: ${counts.map(([k, v]) => `${v} ${k}`).join(', ')}.`);

  const previous = analysisDoc.previousId ? conventionsOf(analysisDoc.previousId) : conventionsOf(analysisDoc.id);
  if (previous.length) {
    conventions = carryOver(previous, conventions);
    if (analysisDoc.previousId) analysisDoc.changes = styleChanges(previous, conventions);
  }
  put<ConventionSet>('conventionSets', { id: analysisDoc.id, profileId: profile.id, conventions });
  put('analyses', { ...analysisDoc, minedAt: Date.now() });
  touchProfile(profile.id, { selftest, currentAnalysisId: analysisDoc.id });
}

export function analyzeProfile(profileId: string) {
  const profile = getProfile(profileId);
  return startJob('analyze', `Analyze ${profile.name}`, profileId, async (ctx) => {
    syncRepository(profile, ctx);
    const sha = headSha(profile.repoDir);
    const id = newId('ana');
    const previousId = profile.currentAnalysisId;
    const analysisDoc: AnalysisDoc = {
      id, profileId, sha, status: 'running', previousId, createdAt: Date.now(),
      factsPath: dataPath('profiles', profileId, 'analyses', id, 'facts.db'),
    };
    put('analyses', analysisDoc);
    try {
      ctx.log(`Reading ${profile.repoDir} @ ${sha.slice(0, 7)}…`);
      const ing = ingest(profile.repoDir);
      ctx.log(`${ing.files.length} files to analyze, ${ing.skipped.reduce((n, s) => n + s.count, 0)} skipped, ${ing.secrets.length} possible secrets found (they will be redacted).`);
      ctx.progress(0.1);

      const analysis = analyzeDirectory(profile.repoDir, ing);
      saveFacts(analysisDoc.factsPath, analysis);
      ctx.log(`Detected ${analysis.stack.frameworks.join(', ') || 'no known framework'}; ${analysis.observations.length} style observations.`);
      ctx.progress(0.35);

      ctx.log('Inferring formatting (searching formatter settings that reproduce your code)…');
      const formatting = await inferFormatting(profile.repoDir, ing.texts);
      ctx.log(`Formatting ${formatting.source === 'repo-config' ? 'read from repo config' : 'inferred'}: ${Math.round(formatting.lineMatch * 100)}% of lines reproduced exactly.`);
      ctx.progress(0.55);

      Object.assign(analysisDoc, {
        stack: analysis.stack, formatting, skipped: ing.skipped, secrets: ing.secrets,
        counts: { files: analysis.files.length, observations: analysis.observations.length, byRole: Object.fromEntries(countBy(analysis.files, (f) => f.role)) },
      });
      let fresh = profile;
      if (!profile.setup.heldOut.length) {
        const heldOut = chooseHeldOut(analysis);
        fresh = touchProfile(profileId, { setup: { ...profile.setup, heldOut } });
        ctx.log(`Held out ${heldOut.length} files for the reconstruction test: ${heldOut.map((h) => h.path).join(', ')}`);
      }
      await learnConventions(fresh, analysisDoc, analysis, ing.texts, ctx);
      put('analyses', { ...get<AnalysisDoc>('analyses', id)!, status: 'done' });
      ctx.log('Analysis complete.');
    } catch (err) {
      put('analyses', { ...analysisDoc, status: 'failed' });
      throw err;
    }
  });
}

/** Re-run mining on the current analysis (e.g. after changing held-out files). */
export function remineProfile(profileId: string) {
  const profile = getProfile(profileId);
  return startJob('remine', `Re-learn conventions for ${profile.name}`, profileId, async (ctx) => {
    const analysisDoc = currentAnalysis(profile);
    if (!analysisDoc) throw new Error('Analyze the profile first.');
    const ing = ingest(profile.repoDir);
    await learnConventions(profile, analysisDoc, facts(analysisDoc.factsPath), ing.texts, ctx);
    ctx.log('Conventions re-learned.');
  });
}

// ── Review ────────────────────────────────────────────────────────────

const LAYER_WEIGHT: Record<Layer, number> = { L1: 0.6, L2: 0.8, L3: 0.8, L4: 0.9, L5: 1, L6: 0.7 };

export function reviewQueue(profile: Profile): Convention[] {
  const priority = (c: Convention) => {
    const importance = LAYER_WEIGHT[c.layer] * Math.min(1, Math.log(1 + c.support.total) / Math.log(50));
    const uncertainty = 1 - c.confidence + 0.05 * Math.min(5, c.exceptions.filter((e) => !e.decision).length);
    return importance * (0.5 + uncertainty);
  };
  return currentConventions(profile).filter((c) => c.status === 'pending').sort((a, b) => priority(b) - priority(a));
}

export interface DecisionInput {
  conventionId: string;
  action: Decision['action'];
  instruction?: string;
  file?: string;
  exception?: 'intentional' | 'legacy';
  vote?: 'yes' | 'no';
}

export function decide(profileId: string, input: DecisionInput): Convention {
  const profile = getProfile(profileId);
  const set = mustGet<ConventionSet>('conventionSets', profile.currentAnalysisId!);
  const c = set.conventions.find((x) => x.id === input.conventionId);
  if (!c) throw new Error(`Unknown convention ${input.conventionId}`);
  switch (input.action) {
    case 'approve': c.status = 'approved'; break;
    case 'reject': c.status = 'rejected'; break;
    case 'reopen': c.status = 'pending'; break;
    case 'edit':
      if (!input.instruction?.trim()) throw new Error('Instruction cannot be empty.');
      c.instruction = input.instruction.trim();
      c.edited = true;
      break;
    case 'exception':
      for (const e of c.exceptions) if (e.file === input.file || input.file === '*') e.decision = input.exception;
      break;
    case 'voice':
      c.voiceVote = input.vote;
      c.status = input.vote === 'yes' ? 'approved' : 'rejected';
      break;
  }
  if (input.action !== 'exception') c.autoApproved = false;
  put('conventionSets', { ...set, decidedAt: Date.now() });
  put<Decision>('decisions', { id: newId('dec'), profileId, conventionId: c.id, action: input.action, payload: { ...input } });
  return c;
}

export function bulkApprove(profileId: string, minConfidence = 0.85): number {
  const profile = getProfile(profileId);
  const set = mustGet<ConventionSet>('conventionSets', profile.currentAnalysisId!);
  const targets = set.conventions.filter((c) => c.status === 'pending' && c.tier === 'enforced' && c.confidence >= minConfidence);
  for (const c of targets) c.status = 'approved';
  put('conventionSets', { ...set, decidedAt: Date.now() });
  for (const c of targets) put<Decision>('decisions', { id: newId('dec'), profileId, conventionId: c.id, action: 'approve', payload: { bulk: true } });
  return targets.length;
}

/** How often the developer agreed with ARS's proposals: the convention-precision metric. */
export function reviewAccuracy(profile: Profile): { agreed: number; decided: number; accuracy: number | null } {
  const decided = currentConventions(profile).filter((c) => !c.autoApproved && c.status !== 'pending');
  const agreed = decided.filter((c) => c.status === 'approved').length;
  return { agreed, decided: decided.length, accuracy: decided.length ? agreed / decided.length : null };
}

// ── Skills ────────────────────────────────────────────────────────────

export const skillVersions = (profileId: string) => list<SkillVersion>('skills', profileId).sort((a, b) => b.version - a.version);

export function latestSkill(profileId: string, statuses: SkillVersion['status'][] = ['published', 'draft']): SkillVersion | undefined {
  const all = skillVersions(profileId);
  for (const s of statuses) {
    const hit = all.find((v) => v.status === s);
    if (hit) return hit;
  }
  return undefined;
}

export function generateSkills(
  profileId: string,
  opts: { note?: string; conventions?: Convention[]; status?: SkillVersion['status']; parentId?: string; descriptions?: Record<string, string> } = {},
): SkillVersion {
  const profile = getProfile(profileId);
  const analysisDoc = currentAnalysis(profile);
  if (!analysisDoc || analysisDoc.status !== 'done') throw new Error('Analyze the profile first.');
  const conventions = opts.conventions ?? currentConventions(profile);
  if (!conventions.some((c) => c.status === 'approved')) throw new Error('Approve at least one convention first.');
  const published = latestSkill(profileId, ['published']);
  return generateSkillPackage({
    profile, analysisDoc, analysis: facts(analysisDoc.factsPath), conventions,
    readSource: (p) => readSource(profile, p),
    version: (skillVersions(profileId)[0]?.version ?? 0) + 1,
    status: opts.status ?? 'draft',
    note: opts.note ?? 'Generated from approved conventions',
    parentId: opts.parentId ?? published?.id,
    descriptions: opts.descriptions ?? published?.descriptions,
  });
}

export function publishSkill(profileId: string, versionId: string): SkillVersion {
  for (const v of skillVersions(profileId)) if (v.status === 'published' && v.id !== versionId) put('skills', { ...v, status: 'superseded' });
  return update<SkillVersion>('skills', versionId, { status: 'published', publishedAt: Date.now() });
}

// ── Pipeline status (the workspace rail) ──────────────────────────────

export type StageState = 'done' | 'active' | 'attention' | 'stale' | 'idle';

export interface Stage {
  id: 'ingest' | 'signature' | 'review' | 'skills' | 'playground' | 'lab' | 'improve';
  label: string;
  state: StageState;
  summary: string;
}

export function pipelineStatus(profile: Profile): Stage[] {
  const analysis = currentAnalysis(profile);
  const latestAnalysis = list<AnalysisDoc>('analyses', profile.id).at(-1);
  const set = profile.currentAnalysisId ? get<ConventionSet>('conventionSets', profile.currentAnalysisId) : undefined;
  const conventions = set?.conventions ?? [];
  const versions = skillVersions(profile.id);
  const experiments = list<Experiment>('experiments', profile.id);
  const labs = experiments.filter((e) => e.config.purpose === 'lab');
  const playgrounds = experiments.filter((e) => e.config.purpose === 'playground').length;
  const lastLab = labs.at(-1);
  const proposals = list<Proposal>('proposals', profile.id);
  const pending = conventions.filter((c) => c.status === 'pending').length;
  const auto = conventions.filter((c) => c.autoApproved).length;
  const latestVersion = versions[0];
  const published = versions.find((v) => v.status === 'published');
  const arsSummary = lastLab?.summary?.conditions.find((c) => c.label === 'ars');
  const t3 = lastLab?.summary?.t3?.ars;
  const open = proposals.filter((p) => ['proposed', 'gating', 'ready'].includes(p.status));
  const running = latestAnalysis?.status === 'running';

  return [
    {
      id: 'ingest', label: 'Ingest',
      state: running ? 'active' : latestAnalysis?.status === 'failed' ? 'attention' : analysis ? 'done' : 'idle',
      summary: running ? 'analyzing…' : analysis?.counts
        ? `${analysis.counts.files} files · ${analysis.stack?.frameworks.slice(0, 2).join('/') || 'unknown stack'} · ${analysis.skipped?.length ?? 0} skipped`
        : latestAnalysis?.status === 'failed' ? 'analysis failed' : 'not analyzed',
    },
    {
      id: 'signature', label: 'Signature',
      state: !conventions.length ? 'idle' : (profile.setup.heldOutChangedAt ?? 0) > (analysis?.minedAt ?? 0) ? 'stale' : 'done',
      summary: conventions.length ? `${new Set(conventions.map((c) => c.layer)).size} layers · ${conventions.length} conventions` : '—',
    },
    {
      id: 'review', label: 'Review',
      state: !conventions.length ? 'idle' : pending ? 'attention' : 'done',
      summary: conventions.length ? `${pending} need you · ${auto} auto-approved` : '—',
    },
    {
      id: 'skills', label: 'Skills',
      state: !latestVersion ? 'idle' : (set?.decidedAt ?? 0) > (latestVersion.createdAt ?? 0) ? 'stale' : 'done',
      summary: latestVersion ? [published && `v${published.version} published`, latestVersion !== published && `v${latestVersion.version} ${latestVersion.status}`].filter(Boolean).join(' · ') : 'no package yet',
    },
    {
      id: 'playground', label: 'Playground', state: playgrounds ? 'done' : 'idle',
      summary: playgrounds ? `${playgrounds} prompt${playgrounds > 1 ? 's' : ''} tried` : 'try a prompt, with and without skills',
    },
    {
      id: 'lab', label: 'Lab',
      state: !lastLab ? 'idle' : lastLab.status === 'running' ? 'active' : (latestVersion?.createdAt ?? 0) > (lastLab.createdAt ?? 0) ? 'stale' : 'done',
      summary: lastLab?.status === 'running' ? 'experiment running…'
        : arsSummary ? [`adherence ${Math.round(arsSummary.adherence * 100)}%`, t3 && `T3 ${Math.round(t3.indistinguishability * 100)}%`].filter(Boolean).join(' · ')
        : 'no experiments yet',
    },
    {
      id: 'improve', label: 'Improve',
      state: open.some((p) => p.status === 'ready') ? 'attention' : open.length ? 'active' : proposals.length ? 'done' : 'idle',
      summary: proposals.length ? `${open.length} open · ${proposals.filter((p) => p.status === 'ready').length} ready to promote` : 'no failures diagnosed',
    },
  ];
}
