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

TS 7 type-check (`node scripts/tsc7.mjs --noEmit`) proves types, not usage. Vitest proves only what it was told. Neither catches a floating promise.

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

## ast-grep — evaluated, rejected

Recorded so it is not re-litigated.

Measured against this repo:

- `client → server` imports: **0** real. 4 matches are comments.
- Raw hex literals in client: **678** total. **451 (66%)** live in
  `lib/theme/themes.ts` (378), `index.css` (47), `lib/theme/monaco-theme.ts`
  (26) — token-definition files, where hex belongs.

Every code-shaped convention already obeyed, or violated by design. Rules that
ARE violated are markdown- and filesystem-shaped. AST engine cannot read those.
New dependency buying zero true positives → not bought. Enforcement lives in
`scripts/check-conventions.mjs` instead.

Caution, generalizable: original figures were 604/447 at `lib/themes.ts` and
`lib/monaco-theme.ts`. Both paths deleted by a client reorg. Ratio survived
re-derivation; paths did not. Same reorg silently broke `i18n-parity.mjs`.
Re-derive counts against the tree before citing them.

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
- `noUndeclaredDependencies` off for non-published trees: `examples/**`, `openspec/changes/**/spike/**`, `openspec/changes/**/mockup/**`, `.pi/flows/**`, `tests/e2e/**`, `qa/scripts/**`, `.pi/skills/**/scripts/**`.

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

## Running tests

`npm test` runs two sequential phases:

```bash
npm run test:parallel && npm run test:real-process
```

### Phase 1 — `test:parallel`

- Runs ~35 root Vitest projects concurrently.
- Excludes real-process test files via `packages/server/vitest.config.ts`.

### Phase 2 — `test:real-process`

- Runs `vitest run --config packages/server/vitest.real-process.config.ts`.
- Vitest project name: `server-real-process`.
- Configuration: `maxWorkers: 2`, `testTimeout: 60_000`, `hookTimeout: 60_000`, `root: __dirname` (pins Vitest root to `packages/server`; `src/**` in `REAL_PROCESS_TESTS` resolves relative to `packages/server`, not repo root; without pin, repo-root invocation resolves against repo root and collects zero files — silently-empty phase).
- Membership: `packages/server/vitest.real-process-files.ts` exports `REAL_PROCESS_TESTS` (10 files). Single source of truth. Real-process config `include`s list; `packages/server/vitest.config.ts` `exclude`s list.
- Isolation rationale: tests spawn real OS processes (keeper, mock-pi, bin wrapper, CLI signal forwarder, full server). Parallel test runner saturates CPU, causing timing false-positives. Config omitted from root `test.projects` — Vitest runs project array concurrently; sequential npm scripts enforce CPU isolation.
- Retries: `retry: process.env.CI ? 1 : 0`, scoped strictly to `server-real-process`. Local runs use 0 retries to surface first failure. CI retry absorbs transient runner stalls; double failure fails run.

### CI artifacts & triage

- Under `CI`, both phases emit Vitest JSON reports: `test-results/vitest.json` and `test-results/vitest-real-process.json`.
- `.github/workflows/ci.yml` uploads `vitest-report` artifact (`if: always()`, `retention-days: 14`).
- Vitest JSON reporter emits no `retryCount` field. Assertions carry `{ancestorTitles, fullName, status, title, duration, failureMessages, meta, tags}`.
- Retried pass signature: `status: "passed"` with non-empty `failureMessages` array (retains failed attempt error).
- Default console reporter hides retried passes; artifact JSON provides only attribution path.
- Query retried passes via `jq`:

```bash
jq -r '.testResults[].assertionResults[] | select(.status=="passed" and (.failureMessages|length)>0) | .fullName' test-results/vitest*.json
```

- Signature verified empirically against Vitest 4.1.11 fail-once fixture. Re-verify after Vitest major upgrade. No automated guard — a nested Vitest run inside `npm test` starves the real-process phase it would protect.

### Repo guards

- `packages/shared/src/__tests__/real-process-project-guard.test.ts`: asserts listed files exist, server config excludes list, server tests matching process-spawn predicate join list or carry `// real-process-exempt: <reason>`, and no other Vitest config sets `retry:`.
- `packages/shared/src/__tests__/ci-vitest-report-artifact.test.ts`: asserts CI workflow uploads `test-results/vitest*.json` with `if: always()`.

## Type-check — TypeScript 7

- CI type-checker = TS 7.0.2 (native Go compiler). Invoke: `node scripts/tsc7.mjs --noEmit`.
- Used by `lint`, `lint:e2e`, `quality:changed`, `packages/team-app` typecheck.
- Wrapper `scripts/tsc7.mjs` resolves npm alias `typescript-7` by path. Forwards argv, stdio, exit code.
- Never call bare `tsc` or `node_modules/.bin/tsc`. Alias bin owns that link → `tsc --version` prints `Version 7.0.2`.
- `typescript` stays 5.x. JS API only: codegen (`bus-client`, `mcp-server-plugin`), 4 tests, `scripts/verify-published-imports.mjs`. TS 7 has no classic JS API.
- Editors: VS Code uses workspace TS 5.9 unless TS 7 selected. Diagnostics can differ slightly. CI authoritative.
- `tsc-rs` 0.3.0 evaluated: matches TS 7 diagnostics, ~2x faster (1.1 s vs 2.3 s). Not adopted: v0.3.0, single maintainer. Switch = one line in `scripts/tsc7.mjs`.
- Rollback: point `pkgName` in `scripts/tsc7.mjs` at `typescript` (5.x).
- See change: migrate-typecheck-to-ts7

## Oracle — `quality:changed`

npm script `quality:changed`:

```
biome check --changed --error-on-warnings --write && node scripts/tsc7.mjs --noEmit && npm test
```

- Single exit code = judge done/continue signal.
- Exit 0 → achieved.
- Non-zero → continue.
- Goal-plugin (`@ricoyudog/pi-goal-hermes`) judge reads it.

`quality:changed` = DEV-LOOP oracle. No automated caller. Absent from
`.github/` workflows, `ship-it`, `ship-change`. Human or `code-quality` skill
invokes it.

## Dead-code oracle — Knip

Whole-graph dead-code detection. Tool = Knip 6.32.2. Config `knip.json` +
`knip-baseline.json` at repo root. Generator `scripts/knip-config.mjs`.
Ratchet `scripts/knip-ratchet.mjs`.

npm scripts:

| Script | Command |
|---|---|
| `knip` | run Knip against generated config |
| `knip:config` | regenerate config from manifests |
| `knip:ratchet` | per-class baseline ratchet |

### Scope split

Per-change checks live in `quality:changed` (Biome, tsc, tests). Whole-graph
checks do NOT. Reachability not decidable from changed-file scope. Dead code
is a property of the whole graph. Split deliberate.

### Baseline

Measured 2026-08-13. Files 10, exports 227, types 189, duplicates 11,
enumMembers 0. Total 437. Runtime ~8s whole-workspace.

### Entry points derived, not declared

`scripts/knip-config.mjs` derives entries from manifests:
`pi-dashboard-plugin.{client,server,bridge}`, `pi.extensions`. Knip reads
`bin`/`main`/`exports` natively. Deliberately not re-declared.

### WHY rooting matters

Unrooted graph does not under-report, it INVERTS. No config → 723 findings /
90 unused files. False-positives: `packages/extension/src/canvas-tool.ts`, which
`bridge.ts` imports directly. Rooted: 437 / 10, all ten exact-verified true
positives.

### Known blind spot — `scripts/**`

`scripts/**` = entry glob. Scripts invoked by shell/CI, edge Knip cannot see
(`node x.mjs` from `.sh` files, `docker cp` + node). Consequence: genuinely dead
script undetectable. Accepted trade-off.

### Gate — per-class ratchet, never a scalar total

`scripts/knip-ratchet.mjs` enforces per-class baseline. Deleting one dead file
must not pay for two new dead exports. Baseline = debt ceiling.
`--check-baseline-diff <ref>` rejects raised class. Lowering always allowed.
Missing baseline = hard error. Never implicit adoption of current counts.

### Where it runs

- `ship-it` step 4.4 enforcer = PREVENTION. Blocks before landing.
- `.github/workflows/nightly.yml` knip job = DETECTION. Runs after merge.
- Docker harness `docker/scripts/knip-harness-check.sh` = reproducibility.

### Rule ownership

Dependency classes `off` in `knip.json`: `unlisted`, `binaries`, `dependencies`,
`devDependencies`, `optionalPeerDependencies`, `unresolved`. Owned by
`noUndeclaredDependencies` in `biome.json` at repo-root scope. Currently 0
findings. Its overrides deliberately exempt `**/__tests__/**`,
`**/vitest.config.ts`, `tests/e2e/**`, `qa/scripts/**`,
`.pi/skills/**/scripts/**`. One rule, one owning engine.

### Harness caveat

Harness image carries `knip.json`, `knip-baseline.json`, `playwright.config.ts`,
`.github/`, `tests/`, `qa/`, `public/`, `.pi/skills`. NEVER `.pi/settings.json`
(pins a host absolute path). Host + container agree on unused-FILES set. `types`
count may differ by one (Node 24.15 vs 24.19), not tree. Exact cross-environment
scalar equality not asserted.

## CodeQL ratchet

Blocks NEW code-scanning alerts at ship time. Debt ceiling = root `codeql-baseline.json`.
Accepted debt shrinks only. Growth needs typed reason. See change: add-local-codeql-ratchet.

### Where it runs

- `ship-it` step 4.4: `node scripts/codeql-local.mjs --check-baseline-diff origin/develop`. Static, instant.
- `ship-it` step 4.4b: `npm run codeql -- --json`. Analysis ~1.5 min. No model call.
- Closing `--check-baseline-diff origin/develop` gates step 4.5. Headless adds `--no-growth`.
- CI: `.github/workflows/codeql.yml`. Advanced setup. `push`/`pull_request` to `develop` + weekly cron.
- CI categories: `/language:actions`, `/language:javascript-typescript`, `/language:python`.
- CI `build-mode: none`. No install, no cache step. Not a required check.
- Shared config `.github/codeql/codeql-config.yml`: `paths-ignore`. Read by CI (`config-file:`) and local.
- Local translates each glob → one `exclude:<glob>` line in `LGTM_INDEX_FILTERS`. Trailing `/**` dropped.
- Local analyses `javascript-typescript` + `actions` only. Python CI-only.
- Local `spike/**` (root only): `paths-ignore` entry → extractor `exclude:spike`, root-anchored. Nested `packages/x/spike/` stays analyzed (real-CLI test #E12 + CI spike). Explicit exception to "non-test scripts stay analyzed". See change: codeql-model-pack-and-mirror.
- Local model load: `.github/codeql/extensions/*.model.yml` read from SNAPSHOT bytes. Uncommitted edits included. Git-ignored files excluded.
- Copied as wrapper pack `pi-dashboard/local-models` under `<run>/model-pack/` (manifest + copies). Outside `<run>/src`. Snapshot id unchanged.
- JS analysis only: `--additional-packs=<dir> --model-packs=pi-dashboard/local-models`. Actions get neither. Never `--download`.
- Pre-check `codeql resolve extensions`: summed `rowCount` per copied file == that file's data rows.
- Pre-check non-zero exit, unparsable output, or row mismatch → exit 2. Never skip.
- No model files in snapshot → no flags, no check.
- `--json` `versions.models` = sha256 over copied file bytes, byte-wise sorted path order. `null` without model files.
- Broken model pack → exit 2 → `ship-it` 4.4b retry/abort (headless: `SHIP_IT_BLOCKED.md`).

### Model type strings

- CodeQL models-as-data parse type column with `('[^']+'|[^.]+)(.*)` (`codeql/javascript-all@2.10.3`, `ApiGraphModelsSpecific.qll` `parseTypeString`).
- Package name ends at FIRST dot unless type single-quoted.
- Unquoted `pkg/m.js` → package `pkg/m`, type `js` → matches nothing.
- Pre-fix `.github/codeql/extensions/cwd-guard.model.yml` rows unquoted → model never applied. All production imports use `.js` specifier. Explains old "no observable effect".
- Fix: `"'@blackbelt-technology/pi-dashboard-shared/cwd-guard.js'"`.
- Enforced: `packages/shared/src/__tests__/codeql-model-contract.test.ts` rejects unquoted dotted type.
- Enforced: `extensions/` holds only `*.model.yml` + `AGENTS.md` + `codeql-pack.yml`.
- Re-check regexp on every `javascript-all` upgrade.
- Limitation: namespace import (`import * as G`, `G.isAllowedCwd`) not suppressed with rows tried. No production namespace import exists.
- Pitfall: guard body `known().includes(cwd)` = CodeQL sanitizing guard → hides model in fixtures. Use opaque bodies.
- Pitfall: `database analyze` re-run on SAME db with another model pack reuses cached results. Recreate db per variant.
- Spike (`evidence/spike.md`): local == GitHub on every probe line. Equal `javascript-all` 2.10.3+a7057b83….
- Fixed model suppresses guarded sinks of `isAllowedCwd` + `isPortableProjectName` only.
- `admissionAllows` / `tokenAllows` guarded sinks + `admitCwd` argument already silent without model (native guard inference, unverified) → no model effect.
- Unguarded twins + unchecked-`admitCwd` negative case stay reported.

### Admission guard shapes CodeQL recognises

Probe: `scripts/__tests__/codeql-local-real.test.mjs` `#E16`. Real analysis, packs cached, mini-monorepo.

- Fixture guard bodies opaque (`admitCwd` returns token carrying its arg).
- Every sink = own lib fn (`lib/sinks.ts`).
- Gate: guarded sinks 0 `js/path-injection`; every twin ≥1.

Recognised shapes:

- (a) route branch: `adm.kind !== "admit" || !admissionAllows(adm, cwd)` → return. Sink on raw `cwd` silent. Sink on `adm.token.canonCwd` silent. Twin: raw `cwd` to lib, no branch → reported.
- (b) `isPortableProjectName(change)` before lib `path.join(cwd, "openspec", "changes", change, …)`. Silent. Twin: cwd guarded, `change` not → reported.
- (c) helper `validateCwd` returns `{ok, cwd: token.canonCwd}`; sink in caller. Silent. Twin: caller without helper → reported.
- (c') helper returns guarded RAW cwd (openspec sites). Silent.

Pitfalls:

- `admitCwd` Argument[0] barrier stops taint at call-site argument only.
- Sink inside shared guard module (`packages/shared/src/cwd-guard.ts`) NOT covered.
- `stat` of canonical cwd added to `cwd-guard.ts` = NEW `js/path-injection`. Keep new fs primitives out of guard.
- Guard body `known().includes(cwd)` = native sanitizer → hides twin. Opaque bodies only.

Result: `js/path-injection` 109 → 78, 0 new. See change: core-cwd-admission `evidence/codeql-probe.md`, `evidence/codeql.md`. Residue (lib-owned containment, `git-operations.ts` 13) → `triage-codeql-alert-debt`.

### Containment barrier (async decisions)

- Async decisions CodeQL cannot see through → SYNC path-bound predicate, modelled as barrier guard.
- `containmentAllows(decision, resolved)` (`packages/shared/src/containment-guard.ts`): true iff `decision.allowed && decision.resolved === resolved`.
- Model row: `.github/codeql/extensions/cwd-guard.model.yml`, `Argument[1]`, type single-quoted.
- `ContainmentDecision` = branded `PathDecision`. Only `packages/server/src/access/containment-gate.ts` builds one (`evaluateContainment`, `decidePassive`).
- Contract test: `packages/shared/src/__tests__/containment-guard.test.ts`.
- Sites: `if (!containmentAllows(decision, resolved)) refuse`, then use same `resolved`.
- Passive sites (grep filter, mention resolver, raw pre-check): `decidePassive(resolved, anchors, {allowGrant})`.
- Probes `#R1-#R6` (`scripts/__tests__/codeql-local-real.test.mjs`), CodeQL 2.27.2, javascript-queries 2.4.7:
  - silent: guarded read; filter shape; guarded value returned from helper.
  - reported: unguarded; predicate-on-A/sink-on-B; never-branched; `containmentAllows(..) || <unmodelled admission>`.
- Result: 131 → 117 results, 14 baseline entries closed. Residue: 4 `file-routes.ts` `operator-authz`.
- Limit: CodeQL trusts any call to predicate (blesses `Argument[1]`). Runtime equality + branded type + contract test = guard.
- See change: codeql-file-containment-barrier.

### Commands

| Command | Effect |
|---|---|
| `npm run codeql` | Snapshot + analyse. Exit per verdict. |
| `npm run codeql -- --json` | One JSON object on stdout. Human lines on stderr. |
| `--prune` | Lower or remove stale entries from last run. Never raises. |
| `--accept <rule> <file> <lineHash> --reason <text>` | Set excess key to current count with reason. |
| `--triage <rule> <file> <lineHash> --reason <text>` | Replace `untriaged` reason at same count. No analysis. |
| `--write-baseline` | Seed once. Refuses overwrite. Uses `SEED_PACKS`. |
| `--check-baseline-diff <ref> [--no-growth]` | Static growth check vs `<ref>`. |
| `--mirror-dismissal <ruleId> <file> <lineHash> --alert <n>[,<n>…]` | Copy GitHub dismissal into entry. See [Mirror a GitHub dismissal](#mirror-a-github-dismissal). |

Exit: `0` pass/skipped · `1` new alerts or growth violation · `2` error.
`--prune` / `--accept` exit `1` when new results remain.

### Skip and warn

- No `codeql` binary, or packs not cached and download fails → stderr `CODEQL SKIPPED: <cause>`, exit 0.
- Pack download: 60 s timeout per pack.
- `CODEQL_BIN` set but not executable → exit 2.
- CLI version ≠ baseline header `codeql` → `CODEQL WARNING: version mismatch …`, continue.
- `database create` exit 32 = no source of that language → no results for that language.
- Result without `primaryLocationLineHash` → `CODEQL WARNING:`. Keyed `-@<startLine>`.
- Result in ignored path → exit 2 `exclusion not applied`.
- Extractor crash, unreadable SARIF, invalid baseline → exit 2.
- `--check-baseline-diff` unresolvable ref → exit 2. Never pass.
- Model pack pre-check failure → exit 2. Never skip. See `### Where it runs`.
- Ref has no baseline (introducing change) → growth check passes.

### Baseline

- Shape: `{version, codeql, packs, entries:[{ruleId, file, lineHash, count, reason}]}`.
- Key = `ruleId` + `file` + `primaryLocationLineHash` (`<hex>:<n>`).
- Count excess over baseline = NEW.
- Reasons:
  - `untriaged` — seed default. Never grows per rule+file.
  - `operator-authz: …` — only `js/path-injection`, `js/command-line-injection`, `js/shell-command-constructed-from-input`.
  - `false-positive: …`
  - `accepted-risk: …`
  - `github-dismissed (#<n>[, #<m>…], false positive|won't fix|used in tests): <text>`
- Growth check per `(ruleId, file)`: summed `untriaged` count must not rise.
- Key carries `untriaged` only if same key had `untriaged` at ref, count ≥.
- Growth with real reason allowed. Printed for review.
- `--no-growth` (headless): any new key or raised count fails.
- Seed exactness: introducing change keys + counts = recorded last run.
- Edit flagged line or ~100 chars after → lineHash changes. One new + one stale.
- `--prune` removes stale entry and its reason.
- Edits above or far below flagged line → key stable (probed).

### Mirror a GitHub dismissal

- Form: `--mirror-dismissal <ruleId> <file> <lineHash> --alert <n>[,<n>…]`.
- Refuses (exit 2) combined with `--json --reason --prune --accept --triage --write-baseline --check-baseline-diff --no-growth`.
- `--alert` alone = error.
- Lock required.
- Entry must exist. Reason `operator-authz|false-positive|accepted-risk`. Not `untriaged`. Not `github-dismissed`.
- Alert count == entry count. Positive ints. No dups.
- Recorded run for current snapshot with `baselineHash`. Legacy record (no hash) refuses.
- Recorded run `clean: true` + `headCommit` present.
- Origin = plain github.com remote: `git@github.com:o/r[.git]`, `ssh://git@github.com/o/r`, `https://github.com/o/r[.git][/]`.
- `owner`/`repo` match `^[A-Za-z0-9_.-]+$`, not `.` / `..`. Else refuse.
- Per alert: `gh api repos/<o>/<r>/code-scanning/alerts/<n>` via `execFileSync` (no shell).
- `gh` timeout `PI_CODEQL_GH_TIMEOUT_MS` (positive int, default 15000).
- `gh` binary override `PI_CODEQL_GH_BIN` (must be X_OK).
- Per alert checks:
  - `state == dismissed`.
  - `rule.id` == `<ruleId>`.
  - `most_recent_instance.location.path` == `<file>`.
  - `most_recent_instance.commit_sha` == recorded `headCommit`.
  - One shared `dismissed_reason` in {`false positive`, `won't fix`, `used in tests`}.
  - Multiset `most_recent_instance.location.start_line` == recorded result start lines.
- Missing field → refuse, naming it.
- Writes reason `github-dismissed (#n[, #m…], <reason>): <original reason>`.
- Re-binds run hash only when it matched pre-write baseline. Hand edit never laundered.
- Procedure:
  1. Check out `develop` commit GitHub last analysed. Not PR head.
  2. `npm run codeql`.
  3. `--mirror-dismissal …`.
- Run from UPSTREAM clone. Fork origin → 404 → refuse.
- Residual risk: HAND edit of `github-dismissed (#n, …)` reason passes `--check-baseline-diff` (same-count rewrite allowed). Unchanged. Documented.

### Snapshot

- Content-addressed git tree of tracked + untracked-unignored files.
- Built from temp copy of index (`GIT_INDEX_FILE`): `git add -A`, drop `codeql-baseline.json`, `git write-tree`.
- Real index + worktree untouched. Git-ignored files excluded.
- Snapshot id = tree id. Changes on any content or mode edit.
- Materialized via `git checkout-index -a --prefix=<run>/src/`.
- State: `$TMPDIR/pi-codeql/<sha1 of git rev-parse --show-toplevel>/`.
  - `lock/` — owner PID + start time.
  - `last-run.json` — `{snapshotId, counts, results, baselineHash, headCommit, clean}`.
- `headCommit` = `git rev-parse HEAD`.
- `clean` = true iff `git status --porcelain --untracked-files=all` lists nothing except `codeql-baseline.json`.
  - `baselineHash` = sha256 of `serializeBaseline(parsed baseline)`.
  - Canonical: JSON formatting + entry order do not change it.
  - Any emitted field (entries, counts, reasons, `codeql`, `packs`, `_comment`) changes it.
  - Plain run records hash of baseline its verdict used.
  - `--write-baseline` re-records hash of written baseline.
  - Invalid JSON / schema fails earlier in `readBaseline` (exit 2).
  - `run-<pid>/` — per-run db + SARIF.
- Live lock → second run, `--prune`, `--accept` exit 2.
- `--prune` / `--accept` refuse when snapshot id ≠ last-run id ("re-run first").
- `--prune` / `--accept` refuse (exit 2) when baseline no longer hashes to `baselineHash`: "baseline changed since the recorded run; re-run the analysis first".
- Record without `baselineHash` (legacy) → accepted. stderr `CODEQL NOTE: … baseline binding was not checked`.
- Every `--prune` / `--accept` write re-binds record. Any number of prunes/accepts after one run.
- `--triage` re-binds only when record hash = pre-triage baseline hash. Never launders hand edit. No record → none written.
- Fail-closed: `git pull` / rebase / stash rewriting baseline → next prune/accept asks for re-run.
- Fail-closed: crash between baseline write and record write → next prune/accept asks for re-run.
- Binding guards accidents, not adversaries. Record lives in `$TMPDIR` (same trust).
- Needs ~repo-size temp space.

### Known limitation — local ≠ GitHub

- Pre-switch (history), commit `d739f4bd`: 150/179 matched by (rule, path, start line). Cause then unknown.
- Re-measured post-switch, commit `ce50677ee`, CLI 2.27.2, identical pack shas (`+a7057b836bf2…`).
- Match = exact (rule, file, `primaryLocationLineHash`) multiset equality.
- Shipped local run 179 vs CI 150 (js 124 + actions 26; python excluded).
- Local-only 29, CI-only 0.
- Cause 1 — local-only 29 (client code, all sourced from `fetch(...)` responses):
  - Script passes `--threat-model=remote`; CI passes none.
  - Same db without flag → local == CI exactly (150/150, 0/0).
- Cause 2 — 29 plugin-server results lost at default→advanced switch, missing on BOTH sides:
  - `js/path-injection` 23, `js/missing-rate-limiting` 5, `js/tainted-format-string` 1.
  - Shared `paths-ignore` `**/__tests__/**` excludes only resolvable `Fastify()` → route-registrar call path.
  - Example files: `packages/automation-plugin/src/__tests__/routes-stop.test.ts`, `packages/team-plugin/src/server/__tests__/harness.ts`.
  - Production loads plugins dynamically. `FastifyInstance` is type-only import.
  - No ignores + no flag → local == pre-switch default-setup CI exactly (179/179).
- Ruled out: extractor coverage (identical per file), query suite, alerts API vs SARIF counts, pack/CLI drift, CI `generated/extension-pack` (no effect on results).
- Ruled out `cwd-guard` model: NOT evidence guard irrelevant. Model was dead when measured (unquoted type strings, see [Model type strings](#model-type-strings)). Fixed model applies on both sides.
- Decision (2026-10-17) — align:
  - Follow-up drops `--threat-model=remote`.
  - Follow-up restores server coverage: un-ignore `__tests__` or data-extension model of registrar.
  - Each = own MODIFIED delta.
  - Until then: local gate covers 29 fetch-response client results; neither side covers 29 plugin-server results.
- Evidence: change `harden-codeql-ratchet-followups` `evidence/local-vs-ci.md` (path moves under `openspec/changes/archive/<date>-…` on archive).
- Seed gated: unmatched share > 5 % → stop for decision.
- Parity record:
  - Seed gate governs SEEDING only.
  - After merge: follow-up issue compares first post-merge `develop` analysis with local run at SAME commit SHA.
  - Share = unmatched local ÷ local results. Only when both `javascript-all` versions match.
  - Numbers recorded in this section.
  - Share > 5 points above post-switch value → further issue.

### Rollout

- Default setup must be `not-configured` before first advanced upload.
- `gh api -X PATCH repos/{owner}/{repo}/code-scanning/default-setup -f state=not-configured` (repo admin).
- Export 38 dismissals first: `evidence/dismissed-alerts.json`.
- Reappearing dismissed alerts → re-dismiss via `PATCH …/alerts/<n>`, matched by (rule, path, start line).

### Rollback

1. Delete or disable `.github/workflows/codeql.yml`. FIRST. GitHub refuses default setup while advanced active.
2. Re-enable default setup:
   `gh api -X PATCH repos/{owner}/{repo}/code-scanning/default-setup -f state=configured -f query_suite=default -f threat_model=remote -f 'languages[]=actions' -f 'languages[]=javascript-typescript' -f 'languages[]=python'`
3. Revert `.pi/skills/ship-it/SKILL.md` step 4.4b edit.
4. Alerts in formerly ignored paths reopen.

## Ship gate — `ship-it` step 4.4

Separate from `quality:changed`. Runs in order. First non-zero exit stops ship,
routes to step-4 fix loop.

| # | Command | Owns |
|---|---|---|
| 1 | `node scripts/check-conventions.mjs --base origin/develop` | 4 repo conventions; touched-file scoped (committed diff ∪ working tree) |
| 2 | `node scripts/dox-byte-gate.mjs` | `AGENTS.md` byte cap |
| 3 | `node scripts/i18n-lint.mjs --strict` | hardcoded user-facing strings |
| 4 | `node scripts/i18n-parity.mjs` | catalog key parity |

Gotchas, each load-bearing:

- `i18n-lint.mjs` exits 0 regardless of findings without `--strict`. Pass
  `--strict` or it advises instead of gates.
- `i18n-parity.mjs` compares `union(zhCN, hu)` against each catalog. Read two
  paths deleted by a client reorg → crashed on every run. Repaired.
- `dox-byte-gate.mjs` filters `kb dox lint --json` to `kind="over-threshold"` +
  `arm="bytes"`. Raw `kb dox lint` exits 1 on any of 7 issue kinds; tree carries
  57 non-gating issues. Direct wiring never lands green.
- `check-conventions.mjs` enforces exactly 4 rules. Four is a deliberate ceiling.
  Growth pressure → write a different script.

## Semantic layer — `ship-it` step 4.5

Model review on the `@review` role. Deliberately NOT in `quality:changed`.
`quality:changed` stays deterministic + offline-runnable.

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
| `lint` | `node scripts/tsc7.mjs --noEmit` (TS 7; was 5.9 `tsc`) |
| `test:parallel` | `vitest run` (concurrent root projects) |
| `test:coverage` | `vitest run --coverage` under isolated-HOME wrapper; writes `coverage/coverage-summary.json` (gitignored); full run only for unloaded-file accuracy; not a CI threshold |
| `test:real-process` | `vitest run --config packages/server/vitest.real-process.config.ts` |

## CI

- `.github/workflows/ci.yml` runs `npx biome lint . --reporter=github` after `npm run lint`, before `npm test`.
- Triggers on `develop`.
- Tier A error-tier gates regressions.
- Tier B/C warn annotate without failing.
- Uploads `vitest-report` artifact (`test-results/vitest*.json`, `if: always()`, `retention-days: 14`) exposing retried passes via `status: "passed"` + non-empty `failureMessages`.

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

`npm run quality:changed` exits 1 when diff contains no Biome-lintable file (e.g. only `.md` + `biome.json`): "No files were processed in the specified paths." Not a violation. Run three legs directly to verify: `npx biome lint .`, `node scripts/tsc7.mjs --noEmit`, `npm test`.

## Skill

`.pi/skills/code-quality/SKILL.md` owns procedure (analyze→fix→test, two modes). Goal owns when-to-stop.
