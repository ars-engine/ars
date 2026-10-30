# ARS — engineering signature engine

ARS reads one of your projects, learns how **you** write code, packages that as [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills), and then **tests** on tasks it has never seen whether a coding agent with those skills writes like you.

Today ARS supports **React projects (TypeScript or JavaScript)** and **Claude Code**. That's the starting point, not the limit: more languages and more coding agents are on the [roadmap](#roadmap), and [collaborators are welcome](#contributing).

The goal is to carry your style into new work. Install the skills into a new or existing project, and Claude Code builds it the way you would: your structure, your idioms, your conventions, from the first file.

## Why ARS

AI coding agents write correct code, but not *your* code, so every new project means correcting the same habits again. Writing skills for your style by hand sounds like the fix, but getting them right is hard:

- **You don't know your own style well enough to write it down.** Most of it is habit: how you name hooks, where files go, how you handle errors. You only notice it when the agent gets it wrong.
- **You can't tell whether a skill works.** The agent reads it, then still does its own thing, and there's no way to measure whether the output improved or you just got lucky.
- **Rules fight with "best practices."** Generic advice wins over your personal choices unless the skill is precise and backed by examples.
- **Skills get long and stale.** Every fix adds another rule, the context fills up, and the code you wrote six months ago no longer matches what the skill says.

ARS does that work for you. It learns the rules from your code instead of your memory, and checks them before you rely on them in new projects: every rule carries evidence from your code, can be checked automatically, is tested on unseen tasks against controls, and is improved only when the data says the change helps.

![The ARS workspace: a profile's pipeline rail and its learned signature](docs/images/signature.png)

```
discover → verify → generate → test → improve
 Ingest    Signature  Skills     Lab    Improve
           + Review   + Playground
```

## Quickstart

Requirements: **Node 22.13+** (ARS uses the built-in `node:sqlite`), git and npm.

```bash
git clone https://github.com/ars-engine/ars.git && cd ars
npm install
npm run dev            # API on :4317, UI on http://localhost:5317
```

Open http://localhost:5317, paste a Git URL or a local folder path, and click **Analyze**. Analysis is local and takes seconds for a typical app.

To run it as one process that serves the built UI on :4317, use `npm start`.

Claude is optional for analysis but required for agent runs and some rules. See [Getting started](docs/getting-started.md) for API keys, credits and what each feature needs.

## What you get

- **A signature in six layers**: formatting, syntax idioms, naming, component anatomy, architecture and "voice". Every rule links to the files it was learned from, along with its counterexamples.
- **A review inbox**: you approve, reject or reword each rule. Your decisions are the ground truth that everything else is measured against.
- **A versioned skill package** that you install into any project. It contains `SKILL.md` files, de-domained exemplar files, a formatter config, and an edit hook that blocks off-style edits while the agent works.
- **A lab** that runs the same agent with no skills, with a length-matched generic guide, and with your skills. It runs reconstruction, transfer and indistinguishability tests, reporting confidence intervals and pass thresholds you set beforehand.
- **An improvement loop** that diagnoses why a rule failed and proposes a fix. The fix is promoted only if it passes a regression gate on held-out tasks.

## Documentation

| Using ARS | Changing ARS |
|---|---|
| [Getting started](docs/getting-started.md): install, Claude access, first profile | [Architecture](docs/architecture.md): packages, data flow, storage, jobs |
| [Concepts](docs/concepts.md): layers, conventions, evidence, tiers | [Extending ARS](docs/extending.md): add a rule, an analyzer, a task |
| [Workflow](docs/workflow.md): every stage of the pipeline, screen by screen | [Contributing](CONTRIBUTING.md) |
| [Reading results](docs/reading-results.md): adherence, CIs, repeats, verdicts | [Security](SECURITY.md): what leaves your machine |
| [Costs](docs/costs.md): what calls Claude and how to cap spend | |
| [CLI and hook](docs/cli.md) | |
| [FAQ and troubleshooting](docs/faq.md) | |

## Scope

- **Supported today: React projects (TypeScript or JavaScript), with Claude Code as the agent.** You can point ARS at other repositories, but it will learn little from them, and the Lab's tasks are React apps. Other languages and agents are on the [roadmap](#roadmap); see [Extending ARS](docs/extending.md) to add a language.
- Private repositories clone with your machine's own git credentials. ARS never stores tokens, keeps all data in `./data`, and sends only redacted excerpts to Claude. See [Security](SECURITY.md).

## Roadmap

- **More languages and frameworks:** deep analysis for Python, Go and others, beyond TypeScript, JavaScript and React.
- **More coding agents:** Codex and others, alongside Claude Code, compared side by side in the same Lab.
- **Context window management:** load only the rules and examples a task needs, so skills stay small as your style grows.
- **Git worktrees for agents:** each agent works in its own worktree, so several can run side by side on a real project.
- **Automated tests and CI.**

Want to work on one of these? See [Contributing](#contributing).

## Contributing

ARS is early, and collaborators are very welcome. Good ways to help:

- **Try it on your own React project** and open an issue where it gets your style wrong. That's the most useful feedback there is.
- **Add a language or a coding agent.** Open an issue first, so we can agree on the approach.
- **Improve the analysis:** new style dimensions, better rules, fewer false positives.
- **Pick up a roadmap item**, or add the automated tests ARS still lacks.

Start with [CONTRIBUTING.md](CONTRIBUTING.md). For security issues, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## License

[Apache-2.0](LICENSE)
