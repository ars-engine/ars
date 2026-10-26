# Contributing to ARS

Thanks for helping. This page covers setting up, making a change and opening a pull request.

## Set up

```bash
git clone <your fork> ars && cd ars
npm install
npm run dev        # API on :4317 (restarts on engine/server changes), UI on :5317 (hot reload)
```

You need Node 22.13+, git and npm. You don't need a Claude API key for most work. See [Getting started](docs/getting-started.md#2-give-ars-access-to-claude-optional-at-first) for what needs one.

Read [Architecture](docs/architecture.md) before your first change, and [Extending ARS](docs/extending.md) if you're adding a rule, an analyzer or a task.

## Make a change

- **Keep it simple.** Prefer one small, reusable function to a new module. Prefer an entry in a registry (`FEATURES`, `TASKS`) to new code paths.
- **Match the surrounding code**: naming, comment density and idioms. Each module opens with a short doc comment explaining *why* it exists; keep that up to date.
- **Logic goes in the engine.** The server only maps routes to engine functions, and the UI only renders engine state.
- **Use the store helpers** (`put`, `get`, `list`, `update`) for new entities. Don't add tables.
- **Never block the event loop.** Use `runCommand()` for subprocesses, and pass `ctx.signal` through anything long-running so Cancel works.
- **The model proposes, code counts.** Anything sent to Claude goes through `redact()` first, and features that use Claude must degrade gracefully without a key.
- **Every rule needs a self-test.** Give each new feature a `plant`.

## Check your change

```bash
npm run typecheck
```

There's no automated test suite yet. Check behaviour by hand:

- **Analysis and rules:** `npm run ars -- analyze <a React project>`, then confirm the result in Signature, including that self-tests pass.
- **Checker:** `npm run ars -- check <folder> --rules <rules.json>`.
- **UI:** click through the stages you touched.
- **Benchmarks:** prefer the **Baseline probe** or a 1-repeat experiment, which are the cheapest runs. Note the cost in your PR.

`npm run dev` restarts the API whenever an engine or server file changes, which **interrupts running jobs**. Don't run experiments while editing engine code.

Unit tests are very welcome, especially for the miner, checker, self-tests and scoring.

## Pull requests

- Keep each PR to one focused change, and explain the *why* in the description.
- Include screenshots for UI changes.
- Update the docs in `docs/` when behaviour, commands or numbers change.
- Never commit `data/`, `.env` or anything from a profile. They can contain other people's code.
- Confirm that `npm run typecheck` passes.

## Reporting bugs

Open an issue with:

- what you did,
- what you expected,
- what happened, including the job log from the UI if a job failed,
- your Node version.

**Don't paste code or logs from private repositories.** For security issues, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
