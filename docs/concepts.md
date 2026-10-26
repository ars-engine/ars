# Concepts

The ideas the rest of the documentation relies on.

## Profile

A **profile** is one reference project plus everything learned from it. Every analysis records the commit it read (`@ a1b2c3d` in the sidebar). **Re-analyze** learns again from the project's current state: for a Git URL it pulls the latest commit first, and a local folder is read as it is now. Your earlier review decisions carry over.

Pick a project you consider representative. ARS learns what it sees, including habits you'd rather not pass on. You can mark those as legacy during review.

## The signature: six layers

| Layer | What it captures | Learned from | Enforced by | Tier |
|---|---|---|---|---|
| **L1** Formatting | quotes, semicolons, width, trailing commas… | the repo's Prettier config, or inferred by searching formatter settings that reproduce your files | formatter config + edit hook | enforced |
| **L2** Syntax idioms | function vs arrow components, named vs default exports, props typing, imports, async style, enums… | AST statistics | checker in the edit hook | enforced |
| **L3** Naming | file, folder, handler, boolean and type names | identifier and file-name mining | checker in the edit hook | enforced |
| **L4** Component anatomy | statement order inside components, size, where logic lives | statement sequences, size distribution, hook extraction | skill + exemplars | learned |
| **L5** Architecture | folder placement, data access, API layer, library choices | import graph, placement, dependencies, Claude deep-read | skill + exemplars + checks | learned |
| **L6** Voice | comments, error handling, problem-solving style | comment and error statistics, Claude deep-read + style dossier | skill prose + exemplars, rubric judge | learned |

The skill package groups the layers into three Claude Code skills:

| Skill | Layers |
|---|---|
| `code-style` | L1–L4, plus the exemplar list |
| `architecture` | L5 |
| `voice` | L6, plus the style dossier |

`code-style` is always generated, because it carries the exemplars, and `voice` is generated when there's a style dossier. `architecture` exists only once you approve at least one L5 rule.

## Conventions

A **convention** is a learned rule. Each one stores:

- **Instruction**: the imperative sentence that goes into the skill ("Declare React components as function declarations").
- **Evidence**: file and line references where your code follows it. Click any rule in the UI to see them.
- **Exceptions**: places where your code breaks it, each with a hint (likely legacy, likely intentional) and the file's age.
- **Support**: matched / total occurrences, and the ratio between them.
- **Confidence**: how sure ARS is that this is a real habit and not noise.
- **Trend**: rising, stable or falling, from git history. This tells you whether you're moving toward or away from the habit.
- **Source**: `miner` (counted deterministically) or `llm` (proposed by the deep-read, with support still counted by code wherever possible).
- **Status**: `pending`, `approved` or `rejected`.

**The LLM never counts.** Claude may *propose* an architecture or voice rule, but how often your code follows it is measured by code.

### Tiers and auto-approval

- **Enforced** rules (L1–L3) are objective and machine-checkable. One is approved automatically when its confidence is at least 85% and it has no exceptions.
- **Learned** rules (L4–L6) involve judgment. They always wait for your review.

### Check types

Every convention is also executable. Its `check` is one of:

| Check | Example |
|---|---|
| `feature` | a measured value: categorical (function vs arrow), one-of, a maximum (component size) or an order (anatomy) |
| `formatting` | a Prettier options object |
| `dependency` | "use library X for category Y, not its alternatives" |
| `pattern` | a regex that must be present or absent in files of a given role |
| `judgment` | a rubric scored by the Claude judge (used for rules no code check can express) |

## One rule object, used everywhere

The same convention object:

1. counts **evidence and exceptions** in your repo,
2. **self-tests** itself: ARS plants a deliberate violation and checks that the checker catches it. A rule whose checker can't catch its own violation would pass everything silently.
3. scores agent output in the **Lab**,
4. blocks off-style edits in the **Claude Code hook**,
5. powers **regression** checks in the promotion gate.

So "what ARS learned", "what the agent is told", "what gets measured" and "what gets enforced" can't drift apart.

## Your decisions are the ground truth

Only **approved** conventions:

- appear in the generated skills,
- are scored in the Lab and the Playground,
- are enforced by the hook.

When most rules are still pending, a run can score 100% on the few that are approved while missing everything else. See [Reading results](reading-results.md#the-ceiling-effect).

## Distinctive vs generic habits

A **baseline** measures how often a plain agent, with no skills, already follows each rule. You get one from the Lab's **Baseline probe**, or from any experiment that includes the "No skills" condition.

- Followed less than 90% of the time → **distinctive**. It's personal to you and leads the skill.
- Followed 90% or more → **generic habit**. It moves to a short "Also keep doing" list at the end of the skill.

That keeps the skills short and focused on what a generic agent would get wrong.

## Held-out files

When a profile is created, ARS sets aside a few real files: up to 3 components, 1 hook and 1 API module, each 30–150 lines long. They're **hidden from learning**. Later, the T1 reconstruction test asks the agent to rewrite them from a behavioural description and compares the result with your originals. You can change the selection under **Lab → Setup**. Doing so marks the signature as stale until you re-learn.

## Skill versions

Every **Generate** creates a new, immutable version (v1, v2…) with a status:

| Status | Meaning |
|---|---|
| `draft` | generated, not yet published |
| `candidate` | created by the improvement loop, waiting for its gate |
| `published` | the version you stand behind; the Lab and Playground prefer it |
| `superseded` | replaced by a later published version |
| `rejected` | a candidate that failed its gate, or was dismissed |
