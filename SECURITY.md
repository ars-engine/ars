# Security

ARS reads source code that may be private, so it's built to keep that code on your machine. This page explains what stays local, what can leave, and how to report a vulnerability.

## What stays on your machine

- **All state** lives in `ARS_DATA` (default `./data`, which git ignores): the database, cloned repositories, analysis facts, skill packages, run workspaces and agent transcripts.
- **Analysis is local.** Ingest, AST mining, formatting inference, self-tests, review, skill generation, the edit hook and `ars check` make no network calls.
- **Git credentials are never stored.** Private repositories clone with your machine's own git setup (SSH keys or a credential helper). ARS never asks for or saves tokens, and it refuses URLs with credentials in them.
- **Local folders are read, never written.** Only `ars install` writes into a project, and only the files listed in [CLI and hook](docs/cli.md#ars-install).

## Analyzing code you don't trust

Analysis treats the repository as data:

- **No code from the repository runs.** Prettier configs are read as JSON, YAML or TOML, and only the formatting options ARS learns are kept. JavaScript configs, shared configs and plugins are ignored. ARS never runs the repository's `package.json` scripts.
- **Only regular files inside the repository are read.** Symlinks, FIFOs and devices are skipped, and every file's real path, with symlinked folders resolved, must stay inside the repository.
- **Git never runs inside an analyzed folder.** A repository's `.git/config` can make git run commands (`core.fsmonitor`, `gpg.program` and others). So ARS lists files itself, honouring `.gitignore`, and reads `HEAD` as a file. It reads history through an empty repository that it creates, which borrows only the folder's object store, so the folder's config and hooks are never read. Git itself runs only to clone or pull a Git URL, with the `ext::` transport disabled, and sources starting with `-` are refused.
- **Pattern rules run with a time limit.** Regexes suggested by Claude are vetted, and every match runs under a 50 ms limit; a rule that hits it is dropped.
- **Agent configuration is never copied.** `.claude/`, `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md` and `.mcp.json` are skipped during ingest.

Generated skills still contain text derived from the repository: exemplar files and the Claude-written style dossier. The skills tell the agent to treat both as style references only, but a crafted repository could still try to steer an agent through them. Read a package's exemplars and voice skill before installing it from a repository you don't trust.

## The local API

The API listens on `127.0.0.1` only, and accepts requests only from the ARS UI:

- every request needs a random session token that changes each time the server starts;
- the `Host` header must be `localhost`, `127.0.0.1` or `[::1]`, which blocks DNS rebinding;
- requests from other websites' origins are refused, and writes must be `application/json`.

Any page served from a localhost port is trusted, so don't run untrusted local web apps alongside ARS.

## What can be sent to Anthropic

Only when Claude access is configured, and only for these features:

| Feature | What is sent |
|---|---|
| Deep-read (on analyze) | about 10 representative source files, **redacted** |
| Held-out briefs (T1) | each held-out file, redacted, to produce a behavioural description |
| Rubric judge, T3 judge | generated files and a few of your files, redacted |
| Instruction rewrites | a rule, its violations and short evidence lines, redacted |
| Agent runs | whatever is in the run's isolated workspace: for T1 a copy of your repository **without** the held-out files, for T2 a neutral scaffold, plus the skill package |

Agent runs work like Claude Code itself. The agent can read any file in its workspace, and that content is sent to the model during the run. **Don't run T1 experiments on code you're not allowed to send to Anthropic.**

## Secret redaction

Every file is scanned during ingest ([ingest/secrets.ts](packages/engine/src/ingest/secrets.ts)). The Ingest screen lists the hits, and the same patterns are replaced with `«redacted:<kind>»` before text reaches a Messages API call or a skill package (exemplars included). The patterns cover:

- private keys,
- AWS access keys,
- GitHub, Anthropic, OpenAI-style, Slack and Google API keys,
- JWTs,
- assignments such as `password = "…"` or `api_key: "…"`.

Redaction is pattern-based and can miss things. Agent runs read workspace files directly, so in T1 runs an unmatched secret in your repository can still reach the model. Remove secrets from a repository before analyzing it, as you would before sharing it.

## Agent permissions

Benchmark agents run without permission prompts, and their workspaces contain untrusted text: T1 workspaces are a copy of the analyzed repository, and T2 workspaces contain exemplars from it. To limit what a steered agent can do:

- each run has its own throwaway folder under `data/runs/`;
- agents load only that folder's `.claude/` settings (`settingSources: ['project']`), never your personal Claude Code configuration, and no MCP servers;
- `Read`, `Write`, `Edit`, `Glob` and `Grep` are refused for any path outside the workspace;
- `Bash` (T2 only) runs in Claude Code's OS sandbox, which confines writes to the workspace and temporary folders. If the sandbox can't start (on Linux it needs `bubblewrap` and `socat`), the run fails instead of running Bash unsandboxed;
- agents get a minimal environment: `PATH`, `HOME`, locale, proxy settings and Claude credentials, not the rest of your shell.

What remains:

- **The agent can see your Claude credentials.** It needs them to run. Use a separate API key with a low spend limit for Lab experiments.
- **T2 scoring runs agent-written code outside the sandbox.** ARS runs the workspace's acceptance tests (`vitest`) and `tsc` to score a run, and the tests execute the code the agent wrote.

Run Lab experiments on repositories you don't trust inside a container or VM.

## Installed hooks

`ars install` adds a `PostToolUse` hook to the target project's `.claude/settings.json`. It runs this ARS checkout's CLI after every agent edit, to format the file and check it. Review the hook before committing it to a shared repository.

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report them privately through GitHub's **Security → Report a vulnerability** on this repository. Include steps to reproduce and the impact you expect. You'll get an acknowledgement within a few days.
