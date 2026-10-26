# Architecture

How ARS is put together, for people changing it.

## Packages

ARS is an npm workspace with three packages:

```
packages/
  engine/   all logic: analysis, mining, checking, skills, benchmarks, improvement (TypeScript, run with tsx)
  server/   a thin Hono HTTP API + server-sent events over the engine; no business logic
  web/      React UI (TanStack Router and Query, CodeMirror), built with Vite
```

The server and the CLI both use only the engine's public API, [`packages/engine/src/index.ts`](../packages/engine/src/index.ts). There's no build step for the engine: `tsx` runs the TypeScript directly, and `npm run typecheck` checks all three packages.

## Engine layout

```
packages/engine/src/
  core/        types (the shared vocabulary), entities, the document store, the facts store, paths, utils
  ingest/      clone/pull, file filtering, git history, secret detection and redaction
  analyzers/   stack detection (any repo), TS/React AST analyzer, file roles, formatting inference
  mine/        the feature registry, the miner, dependency choices, the Claude deep-read
  check/       the checker, self-tests, the rules.json loader
  skills/      package generator, de-domaining, installer
  bench/       T2 tasks, workspaces, the agent runner, scoring, judges, experiments
  improve/     diagnosis, proposals, the gate, promotion
  llm/         the single entry point for Messages API calls (askJson) and account-error detection
  pipeline.ts  profile lifecycle, review decisions, skill versions, rail status
  jobs.ts      background jobs with live logs and cancellation
  cli.ts       the command line and the Claude Code hook
```

## Data flow

```
source repo
  │  ingest/      list files, skip noise, redact secrets, read git history
  ▼
Analysis        files + roles, observations (feature, value, file, line), import graph, dependencies, stack
  │  mine/        group observations per feature → derive the expected value → support, exceptions, confidence
  │               + dependency choices + (optional) Claude deep-read proposals
  ▼
Conventions     pending → Review → approved / rejected   (check/ self-tests every rule)
  │  skills/      render SKILL.md per skill, pick and de-domain exemplars, write rules.json + hook
  ▼
Skill version   draft → published (or candidate → gate → published)
  │  bench/       isolated workspace per run → Claude Agent SDK → scoring with the same checker
  ▼
Experiment      per-condition summaries, CIs, verdict, baseline
  │  improve/     failing rules → diagnosis → proposed change → candidate version → gate
  ▼
new published version
```

The key design choice is that **a convention is also its own checker**. The miner produces a `Convention` whose `check` field is executable. Evidence counting, self-tests, Lab scoring, the edit hook and gate regressions all call `checkConventions()` on that object. See [Concepts](concepts.md#one-rule-object-used-everywhere).

## Storage

Everything lives under `ARS_DATA` (default `./data`):

```
data/
  ars.db                         the document store (SQLite)
  profiles/<profile>/
    repo/                        clone of a Git source (local folders are read in place)
    analyses/<analysis>/facts.db per-analysis facts (files, observations, imports)
    skills/v<n>-<version>/       generated skill packages
  runs/<run>/
    ws/                          the run's isolated workspace
    transcript.json              the full agent transcript
  cache/scaffold-v1/             the T2 scaffold with node_modules, installed once and cloned per run
```

**The document store** ([core/store.ts](../packages/engine/src/core/store.ts)) is one SQLite table, `docs(collection, id, profile_id, created_at, data)`. Every entity is a JSON document in a named collection: `profiles`, `analyses`, `conventionSets`, `decisions`, `skills`, `experiments`, `runs`, `proposals`, `jobs`, `votes`. Use `put`, `get`, `list`, `update` and `mustGet`; don't add tables.

**Facts** for each analysis go in their own `facts.db` because they're large and read-only once written. They're loaded through a small cache ([core/factsCache.ts](../packages/engine/src/core/factsCache.ts)).

## Jobs

Long work (analysis, experiments, diagnosis, gates) runs as a **job** ([jobs.ts](../packages/engine/src/jobs.ts)):

- `startJob(kind, title, profileId, fn)` runs `fn(ctx)` in the background and returns at once.
- `ctx.log()` and `ctx.progress()` stream to the UI over server-sent events (`/api/jobs/:id/stream`, plus a throttled global feed at `/api/events`).
- `ctx.signal` is an `AbortSignal`. **Cancel** aborts it. Long-running code must pass it on: to the agent runner, and to `runCommand()` ([core/util.ts](../packages/engine/src/core/util.ts)) for subprocesses.
- **Never block the event loop.** Use `runCommand()` rather than `execFileSync` for anything slow. A synchronous call freezes the server, so cancels, logs and every other request wait for it.
- Jobs live in the API process. A restart marks running jobs as "interrupted".

## Agent runs

[bench/agent.ts](../packages/engine/src/bench/agent.ts) runs a headless Claude Code session through the Claude Agent SDK:

- **Isolation:** every run gets a fresh folder under `data/runs/<run>/ws`.
  - T1 runs get a copy of your repo without the held-out files.
  - T2 runs get the neutral scaffold.
  - The condition's skills are installed into the workspace's `.claude/`.
- **Identical options for every condition:** the same model, tools (`Read`, `Write`, `Edit`, `Glob`, `Grep`, `Skill`, plus `Bash` for T2), turn limit and budget cap.
- **Settings:** `settingSources: ['project']`, so only the workspace's own `.claude/` is loaded, never the user's personal configuration.
- **Permissions:** `permissionMode: 'bypassPermissions'`, which is safe because the agent works in a throwaway folder.
- **What it records:** which skills the agent loaded, from `Skill` tool calls and reads of `SKILL.md` files. The improvement loop uses this to tell "not loaded" apart from "ignored".

Scoring ([bench/score.ts](../packages/engine/src/bench/score.ts)) re-analyzes the workspace with the same analyzer and checks the approved conventions. For T2 it also runs the hidden acceptance tests and `tsc`, using the workspace's own binaries.

## Claude calls

There are two clients, used for different things:

| Client | Used for | File |
|---|---|---|
| Messages API (`@anthropic-ai/sdk`) | deep-read, held-out briefs, judges, rewrites; always structured JSON through `askJson()` with a Zod schema | [llm/claude.ts](../packages/engine/src/llm/claude.ts) |
| Claude Agent SDK | agent runs | [bench/agent.ts](../packages/engine/src/bench/agent.ts) |

Everything sent through `askJson()` is redacted first. Account problems (no credit, bad key, not logged in) become `LlmUnavailableError`, which aborts an experiment instead of failing each run.

## Server

[packages/server/src/main.ts](../packages/server/src/main.ts) maps HTTP routes to engine functions and nothing else:

- Errors become `400 { error }`.
- File reads are confined to their root folder.
- In production (`npm start`), the server also serves the built UI from `packages/web/dist`.

## Web

[packages/web/src](../packages/web/src):

- [api.ts](../packages/web/src/api.ts) has one fetch helper and two hooks: `useApi` for queries and `useAction` for mutations, which refreshes every query afterwards.
- [ProfileWorkspace.tsx](../packages/web/src/ProfileWorkspace.tsx) renders the rail from `pipelineStatus()` and one component per stage, from `stages/`.
- [jobs.tsx](../packages/web/src/jobs.tsx) handles the live job log and the global job tray.

The rail order and each stage's state come from the engine's `pipelineStatus()` in [pipeline.ts](../packages/engine/src/pipeline.ts), not from the UI.
