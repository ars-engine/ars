# Costs

ARS is free to run locally. Spending happens only when it calls Claude.

## Subscription vs API credit

| | Claude Code (Pro / Max) | ARS with `ANTHROPIC_API_KEY` |
|---|---|---|
| Account | your claude.ai login | the Claude Console (console.anthropic.com) |
| Paid by | the subscription | prepaid API credit, per token |

They're separate. Claude Code can work while ARS fails with *"Your credit balance is too low"*. Add credit under **Console → Settings → Billing**.

While `ANTHROPIC_API_KEY` is set, agent runs use the key, not your Claude Code login. Without a key, agent runs fall back to a Claude Code login through the Agent SDK. Features that call the Messages API (deep-read and the judges) always need a key.

## What calls Claude

| Action | Calls | Rough size |
|---|---|---|
| Analyze (with a key) | one deep-read over about 10 representative files | one large request |
| Held-out briefs (first T1 run) | one short request per held-out file | small |
| Playground | 2 agent runs (no skills and with skills) | about 2 × a T2 run |
| Lab experiment | tasks × conditions × repeats agent runs, plus judge calls | shown before you start |
| Baseline probe | 1 agent run | cheapest experiment |
| Diagnose | up to 2 counterfactual agent runs, plus instruction rewrites | small to medium |
| Gate | candidate vs current on all tasks, at least 2 repeats each | similar to an experiment |

## Controlling spend

- **Estimate first.** The Lab shows "≈ N agent runs · rough estimate $X" for the current settings before you click **Run experiment**. It assumes typical token use per run and prompt-cache pricing.
- **Budget cap per run.** Each agent run stops when it reaches this cap (default $5 in the Lab, $2 in the Playground).
- **Repeats and conditions multiply.** For example, 4 held-out files + 2 test tasks, with 3 conditions and 2 repeats, is 36 runs. Going to 3 repeats makes it 54.
- **Choose the model per experiment.** Every condition uses the same model, so a cheaper model keeps the comparison fair.
- **Cancel** stops an experiment within about a second, including any test process it started.
- **Account errors abort.** If a run fails because of credit, the key or the login, the experiment stops instead of trying every remaining run.
- **Set a monthly limit** in the Console. It's the only hard cap.

## Free features

Ingest, mining, self-tests, review, generating and installing skills, the edit hook and `ars check` never call Claude.
