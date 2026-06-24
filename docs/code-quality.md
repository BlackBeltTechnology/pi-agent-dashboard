# Code Quality — Biome Ratchet System

Static-analysis code quality via Biome. Ratchet model: rules graduate `off → warn → error`, one-way. Cleanup lands first, severity flip second. Once `error`, new violation fails CI.

## Engine

- Engine: Biome 2.5.1 (`@biomejs/biome`), root devDependency, pinned exact.
- Config: `biome.json` at repo root.
- Formatter: disabled. Avoids reformatting 1712 files. `indentStyle: "space"` set for when enabled.
- VCS integration: `clientKind: git`, `useIgnoreFile: true`, `defaultBranch: "develop"`.
- `develop` = repo integration branch. No `main` exists.

### Ignores

| Pattern | Reason |
|---|---|
| `dist/`, `**/dist/` | Build output |
| `*.tsbuildinfo` | TS build cache |
| `**/plugin-registry.generated.*` | Generated |
| `openspec/changes/archive/**` | Archived specs |
| `**/*.css` | Tailwind at-rules parse-error |
| `**/__tests__/fixtures/**` | Test fixtures |

## Ratchet — severity = gate strength

- `warn` shows but exits 0. Soft.
- `error` exits non-zero. Hard gate.
- One `biome.json` serves three scopes. Vary only invocation flag.

| Scope | Invocation | Effect |
|---|---|---|
| Goal loop | `biome check --changed --error-on-warnings --write` | warn+error both block on touched files |
| CI | `biome lint .` | only error-tier fails; warns annotate |
| Cleanup | `biome lint <path> --only=<group>/<rule>` | scoped rule sweep |

Rule lifecycle one-way pawl: `off → warn → error`. Cannot regress.

## Tier ladder

Rule → group, as configured in `biome.json`.

### Tier A — graduated to `error`

| Rule | Group |
|---|---|
| noDoubleEquals | suspicious |
| noDuplicateCase | suspicious |
| noFallthroughSwitchClause | suspicious |
| noSelfCompare | suspicious |
| noUnreachable | correctness |
| noConstantCondition | correctness |
| noEmptyPattern | correctness |
| noUnsafeOptionalChaining | correctness |
| useValidForDirection | correctness |
| useValidTypeof | correctness |
| noDangerouslySetInnerHtmlWithChildren | security |

NOTE: `useValidTypeof` lives in `correctness` group in Biome 2.5.1. design.md originally mislabeled it `suspicious`.

### Tier B — `warn`, ratchet per-area

| Rule | Group | Note |
|---|---|---|
| useExhaustiveDependencies | correctness | React hooks |
| noUnusedVariables | correctness | |
| noUnusedImports | correctness | |
| noExplicitAny | suspicious | 765 hits; may stay warn indefinitely |

### Tier C — `warn`

| Rule | Group |
|---|---|
| useConst | style |
| useImportType | style |
| useTemplate | style |
| useOptionalChain | complexity |
| noExcessiveCognitiveComplexity | complexity |

### a11y — override scoped to `packages/client/**`, `warn`

useAltText, useValidAriaProps, useValidAriaValues, useAriaPropsForRole, useButtonType, useValidAnchor.

## Overrides

- `__tests__/**` + `*.test.ts` + `*.test.tsx` → noExplicitAny off.
- noConsole never enabled. No server/scripts override needed.

## Graduation criterion

Rule moves `warn → error` only after `biome lint . --only=<group>/<rule> --reporter=json` reports 0 violations outside grandfathered overrides.

- Cleanup lands first. Severity flip second.
- After flip, rule = `error`. New violation fails CI. Cannot regress.

## Oracle — `quality:changed`

npm script `quality:changed`:

```
biome check --changed --error-on-warnings --write && tsc --noEmit && npm test
```

- Single exit code = judge done/continue signal.
- Exit 0 → achieved.
- Non-zero → continue.
- Goal-plugin (`@ricoyudog/pi-goal-hermes`) judge reads it.

## Safe vs unsafe fixes

`biome check --write` applies SAFE fixes only.

| Class | Rules | Application |
|---|---|---|
| Safe | useConst, useImportType, noUnusedImports | auto via `--write` |
| Unsafe | useTemplate, useOptionalChain, noUnusedVariables | manual / `--unsafe`, never in loop |

If `--write` marks rule FIXABLE but leaves it, fix unsafe.

## npm scripts

| Script | Command |
|---|---|
| `lint:biome` | `biome lint .` |
| `fix:changed` | `biome check --changed --write` |
| `quality:changed` | oracle above |
| `quality:report` | `biome lint . --reporter=github` |
| `lint` | `tsc --noEmit` (unchanged) |

## CI

- `.github/workflows/ci.yml` runs `npx biome lint . --reporter=github` after `npm run lint`, before `npm test`.
- Triggers on `develop`.
- Tier A error-tier gates regressions.
- Tier B/C warn annotate without failing.

## Rollout phases

| Phase | Action |
|---|---|
| 0 bootstrap | config in, all tiers warn, CI annotates only. Goal loop usable on changed files immediately. |
| 1 graduate Tier A | clear Tier A violations, flip Tier A → error. CI hard-gates Tier A. |
| 2+ per-area Tier B | lowest-count package first, drive rule to 0, graduate warn→error. a11y per-rule on client. |

Phase 1 violations found: 4. noEmptyPattern×3 in `package-queue.test.ts`, noUnreachable×1 in `intent-renderer.tsx`. Both fixed.

## Rough edge — whole-file-on-touch

Biome lints whole files, not diff lines. Touch one line in 400-line legacy file → all its warn-tier issues surface.

- Default policy: grandfather. Fix only diff, `// biome-ignore` unavoidable legacy lines, leave rest.
- Boy-scout alternative (clean whole touched file) tension with surgical-changes rule.

## Skill

`.pi/skills/code-quality/SKILL.md` owns procedure (analyze→fix→test, two modes). Goal owns when-to-stop.
