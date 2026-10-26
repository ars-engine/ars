# Security

ARS reads source code that may be private, so it's built to keep that code on your machine. This page explains what stays local, what can leave, and how to report a vulnerability.

## What stays on your machine

- **All state** lives in `ARS_DATA` (default `./data`, which git ignores): the database, cloned repositories, analysis facts, skill packages, run workspaces and agent transcripts.
- **Analysis is local.** Ingest, AST mining, formatting inference, self-tests, review, skill generation, the edit hook and `ars check` make no network calls.
- **Git credentials are never stored.** Private repositories clone with your machine's own git setup (SSH keys or a credential helper). ARS never asks for or saves tokens.
- **Local folders are read, never written.** Only `ars install` writes into a project, and only the files listed in [CLI and hook](docs/cli.md#ars-install).
- The API listens on `127.0.0.1` only.

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

Benchmark agents run with `permissionMode: 'bypassPermissions'` so they can work without prompts. That's acceptable only because:

- each run has its own throwaway folder under `data/runs/`, and
- agents load only that folder's `.claude/` settings (`settingSources: ['project']`), never your personal Claude Code configuration.

Agents in T2 runs have `Bash`, which runs as your user. The working folder is isolated, but this isn't an OS-level sandbox, so a misbehaving agent could still touch files elsewhere. Run benchmarks on a machine where that's acceptable, or inside a container or VM.

## Installed hooks

`ars install` adds a `PostToolUse` hook to the target project's `.claude/settings.json`. It runs this ARS checkout's CLI after every agent edit, to format the file and check it. Review the hook before committing it to a shared repository.

## Reporting a vulnerability

Please **don't** open a public issue for security problems.

Report them privately through GitHub's **Security → Report a vulnerability** on this repository. Include steps to reproduce and the impact you expect. You'll get an acknowledgement within a few days.
