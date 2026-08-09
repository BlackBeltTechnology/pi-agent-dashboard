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

### `warn` not free

- `quality:changed` = `biome check --changed --error-on-warnings --write`. Flag escalates `warn` → hard failure on changed files.
- CI `biome lint . --reporter=github` omits the flag. `warn` annotates, does not fail.
- Consequence: `off → warn` promotion hard-blocks the local oracle for anyone touching a flagged file. Costs the toucher, not the author.
- Candidate rule with material false-positive rate goes to `off`, not `warn`. Parking a rule at `warn` not a neutral hedge.
- Decisive for `useExhaustiveSwitchCases`: only 4 findings, all 4 deliberate partial switches. At `warn` they block `quality:changed` for every future edit of `directory-handler.ts` and `git-link-builder.ts`, permanently, no fix available.

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
| noImportCycles | suspicious |
| noFloatingPromises | nursery |
| noMisusedPromises | nursery |
| noUndeclaredDependencies | correctness |

NOTE: `useValidTypeof` lives in `correctness` group in Biome 2.5.1. design.md originally mislabeled it `suspicious`.

NOTE: type-aware + structural rules graduated with 0 findings repo-wide. Cost ~2s over 2916 files.

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

## Type-aware + structural rules

Biome 2.5.1 ships type-aware inference. `noFloatingPromises`/`noMisusedPromises` reason about promise semantics. `noImportCycles`/`noUndeclaredDependencies` reason across files.

`tsc --noEmit` proves types, not usage. Vitest proves only what it was told. Neither catches a floating promise.

Rules named individually in `biome.json`. NO `linter.domains` block. Domains grant future Biome rules automatically on upgrade — conflicts with one-way ratchet where every graduation is deliberate.

Type-aware finding counts DEPEND on installed deps. Measured before `pnpm install` vs after: useAwaitThenable 3 → 285, noUnnecessaryConditions 601 → 487, noBaseToString 47 → 21, useExhaustiveSwitchCases 2 → 4. Always run `pnpm install` before probing.

## Probe must be non-vacuous

Zero finding = evidence only if rule CAN fire. Misnamed rule reports silent zero. Rule resolved `off` by override reports silent zero.

Before trusting a zero, plant a deliberate violation, confirm probe reports it, delete planted file.

Verified this way at graduation: planted `async f(){}` + bare `f()` → noFloatingPromises fired. Planted async callback into sync-callback param → noMisusedPromises fired. Planted 2-module import loop → noImportCycles fired (2 errors).

Rule group not assumable. `noUnnecessaryConditions` lives in `suspicious`, not `nursery`. Verify identifier against installed Biome version.

## Site-count extraction must reconcile

Site counts come from Biome's reported diagnostic total. Extracted site lists MUST reconcile against it.

Extraction regex anchored `^[a-z]` drops dot-paths. Cost 2 sites: `.pi/skills/implement/scripts/restart-server.ts:35,38`. Reported 487, extracted 485.

Same trap class as dropping `.cjs`/`.mjs`/`.cts` extensions.

Discrepancy resolved by FINDING the missing site. Never explained away as duplicate diagnostic.

Reconcile with: `comm -23 <(full-extract | sort) <(your-extract | sort)`.

## Candidate type-aware rules — triaged, all `off`

| Rule | Group | Findings | Sampled | Verdict |
|---|---|---|---|---|
| useAwaitThenable | nursery | 285 | 13 | off |
| noUnnecessaryConditions | suspicious | 487 | 15 | off |
| noBaseToString | nursery | 21 | 6 | off |
| useExhaustiveSwitchCases | nursery | 4 | 4 | off |

- useAwaitThenable: 284/285 sites are `await fastify.inject(...)` in `__tests__`. Fastify `inject` returns `LightMyRequest.Chain` — thenable, not Promise. 1 non-test site = `await fastify.register(cookie)`, same class. ~100% false positive.
- noUnnecessaryConditions: emits "This case is unreachable" on live code. Example `packages/server/src/model-proxy/convert/anthropic-out.ts:35` `case "start"` and `:51` `case "text_delta"` — both on the working model-proxy SSE conversion path. Acting on findings deletes working code. 63/487 in test files. Rest split between defensive `?.`/`??` on JSON-parsed data and false unreachable-case claims.
- noBaseToString: dominated by `String(err)` and `err instanceof Error ? err.message : String(err)` on `unknown`. That is the CORRECT idiom. 5 of 21 sites in `packages/server/src/package/package-manager-wrapper.ts` alone.
- useExhaustiveSwitchCases: all 4 are deliberate partial switches over wide unions — `packages/server/src/browser-handlers/directory-handler.ts:290` forwards a subset of `BrowserToServerMessage`; `packages/extension/src/git-link-builder.ts:72,91` omits platforms by design. Rule cannot distinguish deliberately-partial from accidentally-incomplete.

Evidence: Biome type inference approximate relative to `tsc`. No candidate enters at `error`. None enters at `warn`.

## False positive escape hatch

`error`-tier type-aware rule can false-positive on new code. Hard-stops unattended `ship-it`.

Escape = `// biome-ignore lint/<group>/<rule>: <reason>`. Reason mandatory, must state why finding is incorrect.

Suppression in shipped code needs a linked follow-up.

NEVER downgrade rule severity to clear one site. Downgrade removes gate for all code.

Biome reports `suppressions/unused`. Stale suppression surfaces on its own.

## Overrides

- `__tests__/**` + `*.test.ts` + `*.test.tsx` → noExplicitAny off.
- noConsole never enabled. No server/scripts override needed.
- `noUndeclaredDependencies` off for test files: `**/__tests__/**`, `**/*.test.ts`, `**/*.test.tsx`.
- `noUndeclaredDependencies` off for build/config globs: `**/vitest.config.ts`, `**/vite.config.ts`, `**/vite.*.config.ts`, `**/forge.config.ts`, `packages/*/scripts/**`.
- `noUndeclaredDependencies` off for non-published trees: `examples/**`, `openspec/changes/**/spike/**`, `.pi/flows/**`, `tests/e2e/**`, `qa/scripts/**`, `.pi/skills/**/scripts/**`.

## Blind spot — undeclared deps in test files

`__tests__` override silences 911 `noUndeclaredDependencies` sites. 891 `from "vitest"`.

Whole-repo `--only` probe reports 965 sites total. 911 in test files.

Next most common silenced imports: `@testing-library/react` 72, `react` 65, `vitest/config` 32.

Test files accumulate undeclared imports with NO signal while rule sits at `error`.

Rule reports zero under real config. Zero does NOT mean clean tree. Names the exclusion.

Figures re-derived at graduation. Planning-time figures (1288 / 1030) wrong.

## Graduation criterion

Rule moves `warn → error` only after plain lint reports 0 errors.

- `--only=<rule>` force-enables the rule. BYPASSES `overrides` severity entirely. Only `files.includes` exclusions survive it. Rule resolved by override can never report zero under `--only`.
- Correct oracle: set rule to `"error"` in a copy of `biome.json`, run plain `npx biome lint . --max-diagnostics=20000`. Count errors. No `--only`.
- `--only` still OK for COUNTING an `off` candidate rule during triage — no override interaction exists yet.

- Cleanup lands first. Severity flip second.
- After flip, rule = `error`. New violation fails CI. Cannot regress.
- Each rule verified + flipped independently. Non-zero probe blocks that one rule only, not the set.
- Graduation flips switches, does not fix violations. Non-zero probe → route sites to a cleanup change.

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

## Known quirk — quality:changed empty diff

`npm run quality:changed` exits 1 when diff contains no Biome-lintable file (e.g. only `.md` + `biome.json`): "No files were processed in the specified paths." Not a violation. Run three legs directly to verify: `npx biome lint .`, `npx tsc --noEmit`, `npm test`.

## Skill

`.pi/skills/code-quality/SKILL.md` owns procedure (analyze→fix→test, two modes). Goal owns when-to-stop.
