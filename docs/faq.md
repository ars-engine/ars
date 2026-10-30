# FAQ and troubleshooting

## Startup shows `ECONNREFUSED 127.0.0.1:4317`

```
[vite] http proxy error: /api/events
Error: connect ECONNREFUSED 127.0.0.1:4317
```

`npm run dev` starts the UI and the API together. The UI is ready in milliseconds, but the API takes a second or two. If a browser tab was already open, its live-update connection retries during that gap. The errors stop once the API prints `ARS engine API on http://127.0.0.1:4317`.

## `ExperimentalWarning: SQLite is an experimental feature`

Node still marks its built-in `node:sqlite` module as experimental. ARS uses it so there is no native module to compile. The warning is harmless.

## "Your credit balance is too low to access the Anthropic API"

Your API key works, but its Console account has no credit. A Claude Pro or Max subscription doesn't cover API usage. Add credit under **Console → Settings → Billing**; you don't need to restart ARS. See [Costs](costs.md).

## The Claude status says "not configured"

Set `ANTHROPIC_API_KEY` in the terminal you start ARS from, then restart it. The API's startup line shows `Claude API: configured` when the key is visible.

## My experiment says "interrupted (server restarted)"

Jobs run inside the API process. If it restarts, running jobs stop. Restarts happen when you stop `npm run dev`, or when `tsx watch` reloads after an engine source file changes. Start the experiment again. Avoid editing engine code while an experiment runs.

## Cancel doesn't seem to do anything

An experiment stops within about a second of **Cancel**, including any `vitest` or `tsc` process it started. If it keeps going, make sure you're on a current version. Older versions ran tests synchronously and could miss a cancel.

## "Compare with…" is disabled

You need at least two skill versions to compare. Generate another version first.

## ARS scores 100% on everything

Probably a ceiling effect: only a few easy rules are approved, so every run passes them. Finish Review, generate a new version, run a **Baseline probe** and rerun. See [Reading results](reading-results.md#the-ceiling-effect).

## The agent run "wrote no code files"

Open the run and read its error. Common causes:

- an account problem (credit, key or login), which aborts the whole experiment,
- the run's budget cap or turn limit was reached before it wrote anything,
- the agent misunderstood the task. The transcript shows what it did.

## Can I analyze a private repository?

Yes. ARS clones with your machine's own git credentials (SSH keys or a credential helper) and never stores tokens. Local folders are read in place and never modified.

## Which languages are supported?

React projects only, for now, written in TypeScript or JavaScript. Other stacks, such as Python or Go, aren't supported yet.

ARS will still read other repositories, but it only takes an inventory of their languages, manifests, frameworks and imports, marked as shallow coverage. It learns few or no rules from them, and the Lab's tasks are React apps. More languages, and coding agents beyond Claude Code, are on the [roadmap](../README.md#roadmap). To add a language, see [Extending ARS](extending.md#add-a-language-analyzer), and open an issue first so we can agree on the approach.

## How do I start over?

Stop ARS and delete the data folder (`./data`, or wherever `ARS_DATA` points). Everything ARS knows lives there.

## Does ARS change my project?

No. Analysis is read-only, and agent runs happen in isolated copies under `data/runs/`. Only `ars install` writes into a project, and only the files listed in [CLI and hook](cli.md#ars-install).
