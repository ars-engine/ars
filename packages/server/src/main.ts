import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  AGENT_MODEL, analyzeProfile, bulkApprove, cancelJob, createExperiment, createProfile, currentAnalysis, currentConventions,
  DATA_DIR, decide, describeChange, describeFormatting, diagnoseExperiment, dismissProposal, estimateCost, experimentsOf, facts,
  gateProposal, generateSkills, getJob, getProfile, installPackage, LAYERS, list, listJobs, llmConfigured, MODELS, mustGet,
  onJob, pipelineStatus, promoteProposal, proposalsOf, publishSkill, put, readSource, recategorize, remineProfile, reviewAccuracy,
  reviewQueue, runsOf, skillVersions, TASKS, touchProfile,
  type ExperimentConfig, type Job, type Profile, type Run, type SkillVersion, type Vote,
} from '@ars/engine';

/** Thin HTTP layer over the engine. No business logic lives here. */

const app = new Hono();
const PORT = Number(process.env.PORT ?? 4317);

app.onError((err, c) => c.json({ error: err.message }, 400));

const body = async <T>(c: { req: { json: () => Promise<unknown> } }) => ((await c.req.json().catch(() => ({}))) ?? {}) as T;

/** Resolve a path inside a root folder; refuse anything that escapes it. */
function safeRead(root: string, rel: string): string {
  const abs = resolve(root, rel);
  if (relative(root, abs).startsWith('..') || !existsSync(abs) || !statSync(abs).isFile()) throw new Error(`File not found: ${rel}`);
  return readFileSync(abs, 'utf8');
}

function walk(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(root, join(dir, e.name))) : [relative(root, join(dir, e.name))],
  );
}

function headline(profile: Profile) {
  const lab = experimentsOf(profile.id).find((e) => e.config.purpose === 'lab' && e.summary);
  const ars = lab?.summary?.conditions.find((x) => x.label === 'ars');
  const best = lab?.summary?.conditions.filter((x) => x.label !== 'ars').sort((a, b) => b.adherence - a.adherence)[0];
  return {
    adherence: ars?.adherence, lift: ars && best ? ars.adherence - best.adherence : undefined,
    indistinguishability: lab?.summary?.t3?.ars?.indistinguishability, conventions: currentConventions(profile).length,
  };
}

// ── system ────────────────────────────────────────────────────────────
app.get('/api/health', (c) => c.json({ llm: llmConfigured(), dataDir: DATA_DIR, models: MODELS, defaultModel: AGENT_MODEL, layers: LAYERS }));

// ── profiles ──────────────────────────────────────────────────────────
app.get('/api/profiles', (c) =>
  c.json(list<Profile>('profiles').reverse().map((p) => ({ profile: p, stages: pipelineStatus(p), headline: headline(p), analysis: currentAnalysis(p) ?? null }))),
);

app.post('/api/profiles', async (c) => {
  const { source, name } = await body<{ source: string; name?: string }>(c);
  if (!source?.trim()) throw new Error('Enter a Git URL or a local folder path.');
  return c.json(createProfile(source, name));
});

app.get('/api/profiles/:id', (c) => {
  const profile = getProfile(c.req.param('id'));
  const analysis = currentAnalysis(profile);
  const latest = list<{ id: string; status: string }>('analyses', profile.id).at(-1);
  return c.json({ profile, stages: pipelineStatus(profile), analysis: analysis ?? null, latestAnalysis: latest ?? null, accuracy: reviewAccuracy(profile), llm: llmConfigured() });
});

app.post('/api/profiles/:id/analyze', (c) => c.json({ jobId: analyzeProfile(c.req.param('id')).id }));
app.post('/api/profiles/:id/remine', (c) => c.json({ jobId: remineProfile(c.req.param('id')).id }));

app.get('/api/profiles/:id/conventions', (c) => {
  const profile = getProfile(c.req.param('id'));
  const analysis = currentAnalysis(profile);
  return c.json({
    conventions: currentConventions(profile), selftest: profile.selftest ?? {}, baseline: profile.baseline ?? {},
    dossier: analysis?.dossier ?? null, llm: analysis?.llm ?? null, llmNote: analysis?.llmNote ?? null, changes: analysis?.changes ?? [],
    formatting: analysis?.formatting ? { ...analysis.formatting, summary: describeFormatting(analysis.formatting.options) } : null,
  });
});

app.get('/api/profiles/:id/files', (c) => {
  const profile = getProfile(c.req.param('id'));
  const analysis = currentAnalysis(profile);
  return c.json(analysis ? facts(analysis.factsPath).files : []);
});

app.get('/api/profiles/:id/file', (c) => {
  const profile = getProfile(c.req.param('id'));
  return c.json({ path: c.req.query('path'), text: readSource(profile, c.req.query('path') ?? '') });
});

// ── review ────────────────────────────────────────────────────────────
app.get('/api/profiles/:id/review', (c) => {
  const profile = getProfile(c.req.param('id'));
  return c.json({ queue: reviewQueue(profile), accuracy: reviewAccuracy(profile), all: currentConventions(profile) });
});
app.post('/api/profiles/:id/decisions', async (c) => c.json(decide(c.req.param('id'), await body(c))));
app.post('/api/profiles/:id/bulk-approve', async (c) => {
  const { minConfidence } = await body<{ minConfidence?: number }>(c);
  return c.json({ count: bulkApprove(c.req.param('id'), minConfidence) });
});

// ── skills ────────────────────────────────────────────────────────────
app.get('/api/profiles/:id/skills', (c) => c.json(skillVersions(c.req.param('id'))));
app.post('/api/profiles/:id/skills', async (c) => {
  const { note } = await body<{ note?: string }>(c);
  return c.json(generateSkills(c.req.param('id'), { note }));
});
app.post('/api/skills/:vid/publish', (c) => {
  const v = mustGet<SkillVersion>('skills', c.req.param('vid'));
  return c.json(publishSkill(v.profileId, v.id));
});
app.get('/api/skills/:vid/files', (c) => {
  const v = mustGet<SkillVersion>('skills', c.req.param('vid'));
  return c.json(walk(v.dir).sort());
});
app.get('/api/skills/:vid/file', (c) => {
  const v = mustGet<SkillVersion>('skills', c.req.param('vid'));
  return c.json({ path: c.req.query('path'), text: safeRead(v.dir, c.req.query('path') ?? '') });
});
app.post('/api/skills/:vid/install', async (c) => {
  const v = mustGet<SkillVersion>('skills', c.req.param('vid'));
  const { target } = await body<{ target: string }>(c);
  if (!target || !existsSync(target) || !statSync(target).isDirectory()) throw new Error(`Folder not found: ${target}`);
  return c.json({ written: installPackage(v.dir, resolve(target), getProfile(v.profileId).slug) });
});

// ── lab setup & experiments ───────────────────────────────────────────
app.get('/api/profiles/:id/setup', (c) => c.json({ setup: getProfile(c.req.param('id')).setup, tasks: TASKS }));
app.put('/api/profiles/:id/setup', async (c) => {
  const profile = getProfile(c.req.param('id'));
  const patch = await body<Partial<Profile['setup']>>(c);
  if (profile.setup.lockedAt && patch.thresholds) throw new Error('Thresholds are locked: they were written down before the first experiment ran.');
  const heldOutChanged = patch.heldOut && JSON.stringify(patch.heldOut.map((h) => h.path)) !== JSON.stringify(profile.setup.heldOut.map((h) => h.path));
  return c.json(touchProfile(profile.id, { setup: { ...profile.setup, ...patch, ...(heldOutChanged ? { heldOutChangedAt: Date.now() } : {}) } }).setup);
});
app.post('/api/profiles/:id/estimate', async (c) => c.json(estimateCost(await body<ExperimentConfig>(c), getProfile(c.req.param('id')))));
app.get('/api/profiles/:id/experiments', (c) => c.json(experimentsOf(c.req.param('id'))));
app.post('/api/profiles/:id/experiments', async (c) => c.json(createExperiment(c.req.param('id'), await body<ExperimentConfig>(c))));
app.get('/api/experiments/:eid', (c) => {
  const experiment = mustGet('experiments', c.req.param('eid'));
  return c.json({ experiment, runs: runsOf(c.req.param('eid')) });
});

app.get('/api/runs/:rid', (c) => c.json(mustGet<Run>('runs', c.req.param('rid'))));
app.get('/api/runs/:rid/file', (c) => {
  const run = mustGet<Run>('runs', c.req.param('rid'));
  return c.json({ path: c.req.query('path'), text: safeRead(run.workspace, c.req.query('path') ?? '') });
});
app.get('/api/runs/:rid/original', (c) => {
  const run = mustGet<Run>('runs', c.req.param('rid'));
  return c.json({ path: run.taskId, text: run.test === 'T1' ? readSource(getProfile(run.profileId), run.taskId) : '' });
});
app.get('/api/runs/:rid/transcript', (c) => {
  const run = mustGet<Run>('runs', c.req.param('rid'));
  if (!existsSync(run.transcriptPath)) return c.json([]);
  const messages = JSON.parse(readFileSync(run.transcriptPath, 'utf8')) as any[];
  const items = messages.flatMap((m) => {
    if (m.type === 'assistant') {
      return (m.message?.content ?? []).map((b: any) =>
        b.type === 'text' ? { kind: 'text', text: b.text } : b.type === 'tool_use' ? { kind: 'tool', name: b.name, input: JSON.stringify(b.input).slice(0, 400) } : null,
      ).filter(Boolean);
    }
    if (m.type === 'result') return [{ kind: 'result', text: `${m.subtype} · ${m.num_turns} turns · $${(m.total_cost_usd ?? 0).toFixed(2)}` }];
    return [];
  });
  return c.json(items.slice(-500));
});

// ── "Which one did I write?" game (feeds T3) ──────────────────────────
const pairs = new Map<string, { realFile: string; runId: string; file: string; realIsA: boolean }>();

app.get('/api/profiles/:id/game', (c) => {
  const profile = getProfile(c.req.param('id'));
  const runs = list<Run>('runs', profile.id).filter((r) => r.result && r.test !== 'playground');
  const generated = runs.flatMap((r) => r.result!.files.filter((f) => /\.tsx?$/.test(f)).map((file) => ({ run: r, file })));
  const analysis = currentAnalysis(profile);
  if (!generated.length || !analysis) return c.json({ pair: null });
  const real = facts(analysis.factsPath).files.filter((f) => ['component', 'hook', 'route'].includes(f.role) && f.lines >= 15 && f.lines <= 180);
  const g = generated[Math.floor(Math.random() * generated.length)];
  const r = real[Math.floor(Math.random() * real.length)];
  const id = crypto.randomUUID();
  const realIsA = Math.random() < 0.5;
  pairs.set(id, { realFile: r.path, runId: g.run.id, file: g.file, realIsA });
  const realText = readSource(profile, r.path);
  const genText = safeRead(g.run.workspace, g.file);
  return c.json({ pair: { id, a: realIsA ? realText : genText, b: realIsA ? genText : realText } });
});

app.post('/api/profiles/:id/game', async (c) => {
  const { pairId, pick } = await body<{ pairId: string; pick: 'A' | 'B' }>(c);
  const pair = pairs.get(pairId);
  if (!pair) throw new Error('This pair expired. Load a new one.');
  pairs.delete(pairId);
  const pickedReal = (pick === 'A') === pair.realIsA;
  put<Vote>('votes', { id: pairId, profileId: c.req.param('id'), realFile: pair.realFile, generatedRunId: pair.runId, generatedFile: pair.file, pickedReal });
  const votes = list<Vote>('votes', c.req.param('id'));
  const accuracy = votes.filter((v) => v.pickedReal).length / votes.length;
  return c.json({ pickedReal, realFile: pair.realFile, generatedFile: pair.file, votes: votes.length, accuracy, indistinguishability: Math.min(1, Math.max(0, 2 * (1 - accuracy))) });
});

app.get('/api/profiles/:id/game/score', (c) => {
  const votes = list<Vote>('votes', c.req.param('id'));
  const accuracy = votes.length ? votes.filter((v) => v.pickedReal).length / votes.length : null;
  return c.json({ votes: votes.length, accuracy, indistinguishability: accuracy === null ? null : Math.min(1, Math.max(0, 2 * (1 - accuracy))) });
});

// ── improve ───────────────────────────────────────────────────────────
app.get('/api/profiles/:id/proposals', (c) => c.json(proposalsOf(c.req.param('id')).map((p) => ({ ...p, changeSummary: describeChange(p.change) }))));
app.post('/api/profiles/:id/diagnose', async (c) => {
  const { experimentId } = await body<{ experimentId: string }>(c);
  return c.json({ jobId: diagnoseExperiment(c.req.param('id'), experimentId).id });
});
app.post('/api/proposals/:pid/gate', (c) => c.json({ jobId: gateProposal(c.req.param('pid')).id }));
app.post('/api/proposals/:pid/promote', (c) => c.json(promoteProposal(c.req.param('pid'))));
app.post('/api/proposals/:pid/dismiss', (c) => c.json(dismissProposal(c.req.param('pid'))));
app.post('/api/proposals/:pid/recategorize', async (c) => {
  const { category } = await body<{ category: any }>(c);
  return c.json(await recategorize(c.req.param('pid'), category));
});

// ── jobs (live progress over server-sent events) ──────────────────────
app.get('/api/jobs', (c) => c.json(listJobs()));
app.get('/api/jobs/:jid', (c) => c.json(getJob(c.req.param('jid')) ?? null));
app.post('/api/jobs/:jid/cancel', (c) => {
  cancelJob(c.req.param('jid'));
  return c.json({ ok: true });
});
app.get('/api/jobs/:jid/stream', (c) =>
  streamSSE(c, async (stream) => {
    const id = c.req.param('jid');
    const send = (job: Job) => stream.writeSSE({ data: JSON.stringify(job), event: 'job' });
    const current = getJob(id);
    if (current) await send(current);
    if (!current || current.status !== 'running') return;
    await new Promise<void>((done) => {
      const off = onJob(id, (job) => {
        void send(job);
        if (job.status !== 'running') {
          off();
          done();
        }
      });
      stream.onAbort(() => {
        off();
        done();
      });
    });
  }),
);
app.get('/api/events', (c) =>
  streamSSE(c, async (stream) => {
    await new Promise<void>((done) => {
      let last = 0;
      const off = onJob('*', (job) => {
        // Throttle the global feed; per-job streams carry every line.
        if (job.status === 'running' && Date.now() - last < 500) return;
        last = Date.now();
        void stream.writeSSE({ data: JSON.stringify({ ...job, log: job.log.slice(-1) }), event: 'job' });
      });
      stream.onAbort(() => {
        off();
        done();
      });
    });
  }),
);

// ── production: serve the built web UI ────────────────────────────────
const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.use('/*', serveStatic({ root: relative(process.cwd(), webDist) }));
  app.get('*', (c) => c.html(readFileSync(join(webDist, 'index.html'), 'utf8')));
}

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`ARS engine API on http://127.0.0.1:${PORT}  (data: ${DATA_DIR}, Claude API: ${llmConfigured() ? 'configured' : 'not configured'})`);
});

