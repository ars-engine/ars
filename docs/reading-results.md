# Reading results

What the Lab's numbers mean, and what they don't.

## Per-run scores

| Score | Meaning | Applies to |
|---|---|---|
| **Adherence** | share of applicable checks passed, across all approved, non-judgment rules | every run |
| **By layer** | adherence split by L1–L6 | every run |
| **Functional** | acceptance tests passed (out of 5) and whether `tsc` typechecks | T2 |
| **Copy detection** | 4-line blocks shared with your source, and business terms from your project that leaked into the output | T2, Playground |
| **Similarity** | style similarity (overlap of measured features) and AST similarity (syntax shape) between the reconstruction and your original | T1 |
| **Judge scores** | pass/fail per judgment rule, from the rubric judge | runs with "Judge rubric rules" on, when judgment rules are approved |

A rule is **applicable** to a run only if the run produced code the rule can check. A props-typing rule doesn't apply to a run that wrote no components with props. The run detail shows which rules applied.

## The T2 tasks

T2 asks the agent to build a small React + TypeScript app from the same template each time. It loads items from an API, shows "Loading…" and an error message, filters with a search box, and adds items with a form. Each task adds a few display rules of its own:

| Task | Split | Specifics |
|---|---|---|
| Recipe box | dev | "title · N min", tag badges, "slow" marker over 60 minutes |
| Event booking | test | date and "N seats left" / "Sold out", sorted by date |
| Inventory tracker | test | SKU and stock, "Low stock" under 5, total count in the header |

- **Dev** tasks may be used by the baseline probe and the improvement loop.
- **Test** tasks are held out: the improvement loop never tunes against them. That keeps the skills from being fitted to the test.
- The acceptance tests (Vitest, Testing Library and a mocked API) are copied in **after** the agent finishes, so the agent never sees them.

## Why repeats matter

Agents don't give the same answer twice. The same prompt with the same skills can produce two quite different apps. Example from a real experiment, with two runs of the event-booking task using the skills:

| | Run 1 | Run 2 |
|---|---|---|
| Adherence | 100% | 100% |
| Acceptance tests | 5/5 | 5/5 |
| Structure | the whole store in one file; list and search inline in the page | separate store setup, typed hooks, selectors, an API error module, `EventList` and `EventSearch` components |

Both scored the same because the rules that would separate them (store layout, component split) were still pending review. And with only one run, you could have seen either version.

**Repeats per task** runs each task several times per condition:

- The condition's adherence is the **mean** over its runs, so one lucky or unlucky run counts for less.
- The scorecard shows a **95% bootstrap confidence interval**. Read it as "the true average is probably in this range". With 1 repeat there's nothing to bootstrap, so the interval collapses to a single point and tells you nothing.
- In Improve, a rule failing in 3 of 3 runs is a real weakness. Failing in 1 of 1 might be noise.

| Repeats | Use for |
|---|---|
| 1 | checking that the pipeline works; don't trust the verdict |
| 2 (default) | a first look; the minimum for a CI |
| 3–5 | decisions you'll act on, such as publishing or claiming "writes like me" |

Total runs = tasks × conditions × repeats, so cost grows linearly with repeats.

**When to trust a difference:** if the ARS and best-control intervals overlap a lot, the difference isn't proven yet. Add repeats before acting on it.

## The verdict

| Check | Passes when |
|---|---|
| Convention lift | ARS adherence − best control's adherence ≥ minimum lift (default 15 points) |
| Functional correctness | ARS functional ≥ best control's functional − maximum drop (default 5 points) |
| Indistinguishability | T3 score ≥ minimum (default 50%) |

"Best control" is whichever of *No skills* and *Generic guide* scored higher. ARS has to beat the stronger one.

> The verdict currently compares **averages**, not confidence intervals. With few repeats it can pass even when the intervals overlap. Check the CIs yourself.

## T3 indistinguishability

A blind judge sees two of your real files as references, then a pair of files: one generated, one real (not one of the references). It guesses which one is generated.

- Judge accuracy 50% means it's guessing, so indistinguishability is **100%**.
- Judge accuracy 100% means it always spots the agent, so indistinguishability is **0%**.

The formula is `indistinguishability = 2 × (1 − accuracy)`, capped to the range 0–1. The **Which one did I write?** tab runs the same test with you as the judge.

## The ceiling effect

If every condition, or just ARS, scores close to 100% with a CI of [100%, 100%], the test may be too easy rather than the skills perfect. Usual causes:

- **Most conventions are still pending.** Runs are scored only on approved rules. If those are a handful of easy L1–L3 rules, any competent agent passes them. Finish Review, generate a new version and rerun.
- **No architecture or voice rules are approved.** The structural differences you can see in the code aren't being measured.
- **No baseline yet.** Without one you can't tell distinctive rules from habits any agent already has.

## Per-convention results

The scorecard's per-convention table shows each rule's adherence for each condition. Look for:

- rules where **ARS ≫ No skills**: the skills are teaching something real,
- rules where **every condition is high**: generic habits; let the baseline demote them,
- rules where **ARS is low**: candidates for Improve.
