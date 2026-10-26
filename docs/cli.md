# CLI and hook

The command line uses the same engine as the web UI. Run it from the ARS checkout:

```bash
npm run ars -- <command> [args]
```

## `ars analyze`

```bash
npm run ars -- analyze /path/to/project
npm run ars -- analyze https://github.com/you/app.git
```

Creates a profile and runs the analysis, streaming the log to the terminal. The profile then appears in the web UI as well, because they share `ARS_DATA`. Exits non-zero if the analysis fails.

## `ars check`

```bash
npm run ars -- check /path/to/other-project --rules data/profiles/<profile>/skills/<version>/rules.json
```

Scores any folder against a skill package's rules. It lists each applicable rule with its pass rate and up to three violations, then overall adherence:

```
✓ 100%  Components are function declarations
✗  60%  Event handlers are named handleX
        src/components/Form.tsx:14  onSubmit
…
Adherence: 87%
```

Intentional exceptions recorded during review are honoured. The command makes no Claude calls, so it's suitable for CI.

## `ars install`

```bash
npm run ars -- install data/profiles/<profile>/skills/<version> /path/to/project --slug my-style
```

Writes into the target project:

| Path | Contents |
|---|---|
| `.claude/skills/ars-<slug>-<skill>/SKILL.md` | one folder per skill (`code-style`, `architecture`, `voice`); `code-style` also gets `exemplars/` |
| `.ars/<slug>/rules.json` | the executable rules, used by the hook |
| `.claude/settings.json` | a `PostToolUse` hook merged into existing settings (an earlier ARS hook for the same slug is replaced) |
| `.prettierrc.json` | only if the project has no Prettier config of its own |

Commit these files if you want everyone working on that project to get the same skills.

## `ars hook`

```bash
ars hook --rules "$CLAUDE_PROJECT_DIR/.ars/<slug>/rules.json"
```

This is the Claude Code hook that `install` registers, matching `Write|Edit|MultiEdit`. You don't normally run it yourself. After each edit it:

1. **Formats** the edited file with your formatting rule.
2. **Checks** the file against the *enforced* rules (feature and pattern checks; formatting, dependency and judgment rules are skipped here).
3. On a violation, **exits with code 2** and writes the violations to stderr, for example:

   ```
   ARS: src/components/Card.tsx does not match my-style's style yet. Fix these before continuing:
   - Components are function declarations (line 3). Declare React components as function declarations.
   ```

Claude Code shows this to the agent, which fixes the file straight away. Files outside the project, and files in `.claude/`, `.ars/` and `node_modules/`, are ignored.

The hook command points at this ARS checkout (its `tsx` and `cli.ts`). If you move or delete the checkout, reinstall the package.
