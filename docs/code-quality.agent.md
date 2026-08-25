# code-quality.md — index

Pull-only condensed map. Source: docs/code-quality.md. Rule → severity tier + gate; npm script → command; threshold → enforcement point.

## Engine
- Biome 2.5.1 (`@biomejs/biome`), root devDependency pinned exact. Config `biome.json` repo root. Formatter off (avoids 1712-file reformat). VCS `clientKind: git`, `useIgnoreFile: true`, `defaultBranch: "develop"`. No `main`.
- Ignores — `dist/`, `*.tsbuildinfo`, `**/plugin-registry.generated.*`, `openspec/changes/archive/**`, `**/*.css`, `**/__tests__/fixtures/**`.

## Ratchet — severity = gate strength
- `warn` exits 0 (soft); `error` exits non-zero (hard gate). One-way pawl `off → warn → error`, cannot regress.
- One config, three scopes — goal loop `biome check --changed --error-on-warnings --write`; CI `biome lint .`; cleanup `biome lint <path> --only=<group>/<rule>`.
- `warn` not free — `--error-on-warnings` hard-blocks toucher of flagged file. False-positive-prone candidate → `off`, not `warn` (useExhaustiveSwitchCases: 4 findings, all deliberate).

## Tier ladder
- Tier A `error` — noDoubleEquals, noDuplicateCase, noFallthroughSwitchClause, noSelfCompare, noUnreachable, noConstantCondition, noEmptyPattern, noUnsafeOptionalChaining, useValidForDirection, useValidTypeof (correctness group, not suspicious), noDangerouslySetInnerHtmlWithChildren, noImportCycles, noFloatingPromises, noMisusedPromises, noUndeclaredDependencies. Graduated 0 findings repo-wide; ~2s / 2916 files.
- Tier B `warn` — useExhaustiveDependencies, noUnusedVariables, noUnusedImports, noExplicitAny (765 hits). Tier C `warn` — useConst, useImportType, useTemplate, useOptionalChain, noExcessiveCognitiveComplexity.
- a11y `packages/client/**` `warn` — useAltText, useValidAriaProps, useValidAriaValues, useAriaPropsForRole, useButtonType, useValidAnchor.

## Type-aware + structural rules
- Type inference — noFloatingPromises/noMisusedPromises (promise semantics), noImportCycles/noUndeclaredDependencies (cross-file). `tsc` proves types, Vitest proves tests — neither catches floating promise.
- Rules named individually; NO `linter.domains` (auto-grants future rules, conflicts with deliberate ratchet). Counts depend on deps — `pnpm install` before probing (useAwaitThenable 3 → 285).

## Probe must be non-vacuous
- Zero finding = evidence only if rule CAN fire (misnamed/override-off → silent zero). Plant deliberate violation, confirm probe fires, delete. Group not assumable — noUnnecessaryConditions in `suspicious`, not `nursery`.

## Site-count extraction must reconcile
- `^[a-z]`-anchored regex drops dot-paths — reported 487, extracted 485. Reconcile `comm -23`; find missing site, never explain away.

## Candidate type-aware rules — triaged, all `off`
- useAwaitThenable 285 / noUnnecessaryConditions 487 — ~100% FP: `await fastify.inject(...)` = thenable `LightMyRequest.Chain`, not Promise; false "unreachable case" on live model-proxy SSE path.
- noBaseToString 21 / useExhaustiveSwitchCases 4 — `String(err)` on `unknown` = correct idiom; all deliberate partial switches. None enters at `error`/`warn`.

## ast-grep — evaluated, rejected
- 0 real client→server imports (4 comments); 66% of 678 raw hex in token-definition files where hex belongs. Violated conventions markdown/filesystem-shaped — enforcement in `scripts/check-conventions.mjs`. Re-derive counts before citing (old paths deleted by reorg).

## False positive escape hatch
- `// biome-ignore lint/<group>/<rule>: <reason>` — reason mandatory; shipped suppression needs linked follow-up.
- NEVER downgrade severity for one site — removes gate for all code. Stale suppression surfaces via `suppressions/unused`.

## Overrides
- `__tests__/**` + `*.test.{ts,tsx}` → noExplicitAny off. noConsole never enabled.
- noUndeclaredDependencies off — tests; build/config (`**/vitest.config.ts`, `**/vite.config.ts`, `**/forge.config.ts`, `packages/*/scripts/**`); non-published (`examples/**`, `openspec/changes/**/spike/**`, `.pi/flows/**`, `tests/e2e/**`, `qa/scripts/**`, `.pi/skills/**/scripts/**`).

## Blind spot — undeclared deps in test files
- Override silences 911 of 965 probe sites (891 `from "vitest"`). Zero under real config ≠ clean tree.

## Graduation criterion
- `warn → error` only after plain lint reports 0 errors. Cleanup first, severity flip second. Non-zero probe blocks that one rule only.
- `--only=<rule>` bypasses overrides (only `files.includes` survives). Oracle: rule `"error"` in config copy, `npx biome lint . --max-diagnostics=20000`. `--only` OK for counting `off` candidates.

## Oracle — `quality:changed`
- `quality:changed` = `biome check --changed --error-on-warnings --write && tsc --noEmit && npm test`. Single exit code → goal-plugin judge (`@ricoyudog/pi-goal-hermes`).
- DEV-LOOP oracle only. No automated caller — absent from `.github/`, `ship-it`, `ship-change`.

## Dead-code oracle — Knip
- Knip 6.32.2; `knip.json` + `knip-baseline.json`; scripts `knip`, `knip:config` (regenerate), `knip:ratchet`. Baseline 2026-08-13: 437 total (files 10, exports 227, types 189), ~8s.
- Whole-graph, NOT in `quality:changed` — reachability not changed-file-scoped. Entries derived from manifests (`pi-dashboard-plugin.{client,server,bridge}`, `pi.extensions`), not re-declared.
- Unrooted INVERTS — 723/90 vs rooted 437/10, all true positives (`canvas-tool.ts` imported by bridge.ts). Blind spot: `scripts/**` edge Knip cannot see.
- Gate = per-class ratchet, never scalar total. `--check-baseline-diff <ref>` rejects raised class; missing baseline = hard error.
- Runs — `ship-it` 4.4 (prevention), `nightly.yml` (detection), `docker/scripts/knip-harness-check.sh`. Dep classes off → owned by noUndeclaredDependencies. Harness never carries `.pi/settings.json`.

## Ship gate — `ship-it` step 4.4
- In order, first non-zero stops ship: `node scripts/check-conventions.mjs --base origin/develop` (4 conventions) → `node scripts/dox-byte-gate.mjs` (byte cap) → `node scripts/i18n-lint.mjs --strict` (exits 0 without `--strict`) → `node scripts/i18n-parity.mjs`.
- `dox-byte-gate.mjs` filters `kb dox lint --json` to `over-threshold`+`bytes` — raw lint exits 1 on any of 7 kinds.

## Semantic layer — `ship-it` step 4.5
- Model review on `@review` role. Deliberately NOT in `quality:changed` — stays deterministic + offline-runnable.

## Safe vs unsafe fixes
- `biome check --write` = SAFE fixes only. Safe: useConst, useImportType, noUnusedImports. Unsafe: useTemplate, useOptionalChain, noUnusedVariables (manual / `--unsafe`, never in loop).

## npm scripts
- `lint:biome` — `biome lint .` · `fix:changed` — `biome check --changed --write` · `quality:report` — `biome lint . --reporter=github` · `lint` — `tsc --noEmit` (unchanged).

## CI
- `ci.yml` — `npx biome lint . --reporter=github` after `npm run lint`, before `npm test`. Triggers `develop`. Tier A error gates; B/C annotate.

## Rollout phases
- 0 all-tiers-warn → 1 graduate Tier A (4 violations: noEmptyPattern×3 `package-queue.test.ts`, noUnreachable×1 `intent-renderer.tsx`, fixed) → 2+ per-area Tier B, a11y per-rule.

## Rough edge — whole-file-on-touch
- Lints whole files, not diff lines. Default: grandfather — fix only diff, `// biome-ignore` unavoidable legacy lines.

## Known quirk — quality:changed empty diff
- Exits 1 "No files were processed in the specified paths" when diff has no lintable file (only `.md` + `biome.json`). Not a violation — run legs directly: `npx biome lint .`, `npx tsc --noEmit`, `npm test`.

## Skill
- `.pi/skills/code-quality/SKILL.md` owns procedure (analyze→fix→test). Goal owns when-to-stop.
