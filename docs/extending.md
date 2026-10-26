# Extending ARS

Common extension points, smallest first. Read [Architecture](architecture.md) first.

## Add a style dimension

A style dimension, such as "how are event handlers named", needs two things:

1. **An observation** emitted by the analyzer.
2. **A feature definition** in the registry.

The miner, checker, skill writer and self-test all read the registry, so you don't touch them.

### 1. Emit the observation

In [analyzers/typescript.ts](../packages/engine/src/analyzers/typescript.ts), push one observation each time the analyzer sees the thing you're measuring:

```ts
if (/^handle[A-Z]/.test(name)) push('naming.handler', 'handleX', line);
else if (/^on[A-Z]/.test(name)) push('naming.handler', 'onX', line);
```

An observation is `{ feature, value, file, line, role }`. The value can be a string (categorical), a number (sizes) or a string array (orders or sets).

### 2. Register the feature

Add one entry to `FEATURES` in [mine/features.ts](../packages/engine/src/mine/features.ts):

```ts
{
  id: 'naming.handler', layer: 'L3', kind: 'categorical', subject: 'event handlers',
  title: 'Handlers are named {v}', say: 'Name event handlers defined in components {v}.',
  labels: { handleX: '`handleX` (e.g. `handleSubmit`)', onX: '`onX` (e.g. `onSubmit`)' },
  plant: (v) => {
    const name = v === 'handleX' ? 'onArsClick' : 'handleArsClick';
    return { append: `\nexport function ArsPlanted() {\n  const ${name} = () => {};\n  return <button onClick={${name}} />;\n}\n` };
  },
},
```

| Field | Purpose |
|---|---|
| `id` | must match the observation's `feature`; the convention id becomes `<layer>.<id>` |
| `layer` | L1–L6; L1–L3 are the enforced tier |
| `kind` | `categorical` (one dominant value), `oneOf` (a set of allowed values), `max` (an upper bound on a number), `order` (a sequence) |
| `title` / `say` | templates where `{v}` becomes the readable value; `say` is the instruction written into the skill |
| `labels` | readable text for each raw value |
| `minTotal` | minimum number of observations before a rule is proposed (default 3) |
| `plant` | returns a **deliberate violation** of the expected value; the self-test uses it to prove the checker works |

A rule is proposed only when enough of your code agrees. The minimum share depends on the kind: 60% for categorical, 85% for one-of, 80% for max and 50% for order ([mine/miner.ts](../packages/engine/src/mine/miner.ts)).

**Always provide `plant`.** Without it the rule shows as *untestable*, and the improvement loop can't tell a broken checker from a bad instruction.

### 3. Check it

```bash
npm run typecheck
npm run ars -- analyze /path/to/a/react/project
```

The new rule should appear in Signature with evidence, and its self-test should pass.

## Add a language analyzer

Today, TypeScript and JavaScript get deep analysis (`DEEP_LANGUAGES` in [analyzers/generic.ts](../packages/engine/src/analyzers/generic.ts)). Other languages get roles from file paths and shallow, pattern-based imports.

To add deep support for a language:

1. Write `analyze<Lang>File(path, text)` returning the same shape as `analyzeTsFile`: `{ role, observations, imports, hasNetwork }`.
2. Call it from `analyzeDirectory()` in [analyzers/index.ts](../packages/engine/src/analyzers/index.ts) for that language, and add the language to `DEEP_LANGUAGES`.
3. Register features for the observations it emits, as above. Reuse existing feature ids where the meaning is the same, such as file naming. Prefix new ones with the language where it differs.

Everything downstream (mining, checking, skills, scoring, the hook) works unchanged, because it only sees observations.

## Add a T2 transfer task

Add a `TaskSpec` to `TASKS` in [bench/tasks.ts](../packages/engine/src/bench/tasks.ts):

```ts
{
  id: 'book-club', split: 'test', title: 'Book club', heading: 'Reading List', resource: 'books', displayField: 'title',
  fixture: [/* 3 sample items returned by GET /api/books */],
  fields: [{ label: 'Title', key: 'title', sample: 'Dune' }, { label: 'Author', key: 'author', sample: 'Frank Herbert' }],
  addButton: 'Add book', searchPlaceholder: 'Search books',
  extra: ['Show "<title> by <author>".'],
}
```

The prompt and the five acceptance tests are generated from these fields, so every task is measured the same way.

- Pick a domain **unrelated** to the projects people are likely to analyze. That makes copy detection meaningful.
- Use `split: 'dev'` for tasks the improvement loop may tune against, and `split: 'test'` for held-out ones. Keep at least one of each.
- If you change the scaffold itself (`SCAFFOLD`), bump `SCAFFOLD_VERSION` in [bench/workspace.ts](../packages/engine/src/bench/workspace.ts) so the cached `node_modules` is rebuilt.

## Add a failure diagnosis

Diagnoses live in [improve/loop.ts](../packages/engine/src/improve/loop.ts):

1. Add the category to `FailureCategory` in [core/entities.ts](../packages/engine/src/core/entities.ts).
2. Add its explanation to `DIAGNOSES`.
3. Decide it in `diagnoseExperiment()`. Use evidence (self-tests, support, loaded skills, counterfactuals), never a model grading itself.
4. Map it to a change in `changeFor()`. If it needs a new change type, add it to `ProposalChange`, `describeChange()` and `applyChange()`.

## Add a Claude-powered step

Use `askJson(schema, system, prompt)` from [llm/claude.ts](../packages/engine/src/llm/claude.ts) with a Zod schema:

- Pass every piece of user code through `redact()` from [ingest/secrets.ts](../packages/engine/src/ingest/secrets.ts) first.
- Let the model *propose*, and let code *count*.
- Guard optional steps with `llmConfigured()` so ARS keeps working without a key.
