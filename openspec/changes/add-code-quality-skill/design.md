# Design — Code-Quality Skill (Biome ratchet)

## Engine decision: Biome (not ESLint)

| Criterion | Biome | ESLint |
|---|---|---|
| One tool: analyze + fix + format | yes (`check --write`) | needs plugins + Prettier |
| React-hooks correctness | `useExhaustiveDependencies` (recommended) | `eslint-plugin-react-hooks` |
| Machine-readable output for agent/judge | `--reporter=json` / `github` | json formatter |
| Native changed-files scope | `--changed` + `vcs.defaultBranch` | external glue |
| Speed on 1712 files | Rust, fast | slower |
| Config maintenance | single `biome.json` | flat config + plugin matrix |

Biome alone covers the client's React-hooks blind spot, so no ESLint side layer.

## The ratchet mechanism (severity = scope behavior)

Biome exit-code semantics (verified):

- `warn` → diagnostic shown, **CLI exits 0** unless `--error-on-warnings`. Soft.
- `error` → **CLI exits non-zero** always. Hard gate.

One `biome.json` serves three scopes by varying only the invocation flag:

```
SCOPE              COMMAND                                    BLOCKS ON
goal loop          biome check --changed --error-on-warnings  warn + error
  (changed files)    --write                                  (agent fixes all on its files)
CI (soft warn)     biome lint . --reporter=github             error only (warns annotate)
cleanup (explicit) biome lint <path> --only=<group>/<rule>    whatever asked
```

New/touched code is held to the full bar; legacy code only to the graduated bar.
A rule's lifecycle is a one-way pawl: `off → warn → error`.

## Tier ladder

```
TIER A  graduate to `error` first — high signal, low volume, auto-fixable
  suspicious:  noDoubleEquals, noDuplicateCase, noFallthroughSwitchClause,
               useValidTypeof, noSelfCompare
  correctness: noUnreachable, noConstantCondition, noEmptyPattern,
               noUnsafeOptionalChaining, useValidForDirection
  security:    noDangerouslySetInnerHtmlWithChildren

TIER B  stay `warn`, ratchet per-area — real value, high volume
  correctness: useExhaustiveDependencies (React hooks), noUnusedVariables,
               noUnusedImports
  suspicious:  noExplicitAny  (likely hundreds; may stay warn indefinitely)

TIER C  `warn` or off — opinionated style/complexity
  style:       useConst, useImportType, useTemplate (safe autofixes)
  complexity:  useOptionalChain, noExcessiveCognitiveComplexity

a11y  override on packages/client/** — warn first, graduate per-rule

OVERRIDES (relax legitimate noise)
  __tests__/**, *.test.ts  → allow noExplicitAny, noConsole
  packages/server/**       → allow noConsole (real logging)
  scripts/**, *.mjs        → relaxed
```

Rule names are representative and SHALL be reconciled against the installed
Biome version's rule list during Phase 0 (some may live in `nursery`).

## Graduation criterion (objective)

A rule moves `warn → error` when
`biome lint . --only=<group>/<rule> --reporter=json` reports **0 violations**
outside grandfathered overrides. The cleanup PR for that rule lands first; the
severity flip lands second. The ratchet cannot regress because the rule is then
`error` and any new violation fails CI.

## The goal-loop oracle

`quality:changed` is one command whose exit code is the judge's done/continue
signal:

```
biome check --changed --error-on-warnings --write \
  && tsc --noEmit \
  && npm test
```

Exit 0 = Biome clean (warn+error) on changed files AND types clean AND tests
green → judge marks **achieved**. Non-zero → judge says **continue** and the
agent fixes the reported issues. Turn budget exhausted → **paused** with report.

Goal-text templates the user sets via GoalControl:

```
daily driver (changed files):
/goal "Use the code-quality skill in changed-files mode. Done when
       `npm run quality:changed` exits 0. Pause and report if a fix needs a
       non-mechanical judgment call. Never edit files outside the diff."

scoped cleanup (one package, one rule-group per turn):
/goal "Use the code-quality skill, whole-repo mode, scoped to <pkg>. Drive
       `biome lint <pkg> --only=<group>` to 0 while keeping tests green. One
       rule-group per turn; stop after each so I can review the diff."
```

## Guardrails (from AGENTS.md code discipline)

1. **Scope** — goal loop uses `--changed`; never whole-repo autofix in a loop.
2. **Test gate** — after every fix batch run `tsc --noEmit` + `npm test`; if red,
   revert that batch rather than stacking broken autofixes.
3. **Safe-first** — auto-apply Biome safe fixes only; surface unsafe (`--unsafe`)
   and manual fixes as a report for human review, never blind `--unsafe` in a loop.
4. **No scope creep** — forbid "improving" files outside the diff (surgical rule).

## Known rough edge: whole-file linting on touch

Biome lints whole files, not diff lines. Touching one line in a 400-line legacy
file surfaces all its warn-tier issues. Resolution options (project taste,
decided in Phase 0):

- **Grandfather (default):** Tier B kept at `warn` (no `--error-on-warnings`) in
  the first goal-loop variant, so legacy noise informs but does not block; fix
  only the diff; `// biome-ignore` unavoidable legacy lines.
- **Boy-scout:** clean the whole touched file (higher quality, tension with the
  surgical-changes rule).

## Alternatives considered

- **ESLint + Prettier + react-hooks** — richer ecosystem, but heavier config,
  slower, and needs a separate formatter; no advantage here given Biome covers
  the hooks rule.
- **Whole-repo formatter on day 1** — rejected: 1712-file reformat diff buries
  every real fix.
- **Custom git-diff script as primary** — rejected: native `--changed` covers
  branch-vs-main; script kept only as a documented fallback.
