# Tasks — cleanup-undeclared-dependencies

Test tasks are folded from `test-plan.md`; that manifest is the source of truth
for automated-vs-manual. All 32 manifest rows are `automated`; there are no
`manual-only` rows to defer.

## 1. Re-derive the baseline

- [x] 1.1 Run `npx biome lint --only=correctness/noUndeclaredDependencies . --max-diagnostics=20000` at repo root and record the current total; the 1398 figure in the proposal is a snapshot and the tree moves — **measured 1411**
- [x] 1.2 Bucket the findings into test-file / build-config / runtime-in-package-source / outside-packages, and confirm the four groups still sum to the total — **test 1303 · build-config 40 · runtime-in-package-src 46 · ignore-tree 22 = 1411 ✓**
- [x] 1.3 Produce the per-finding declare-vs-override mapping for the in-`packages/` non-test findings, so the manifest edit set is derivable rather than guessed — **50 declarations derived, matching tasks 3.1–3.10 exactly**

- [x] 1.4 **Oracle correction (design defect found during 1.1).** Biome 2.5.1's `--only=<rule>` force-enables the rule and bypasses `overrides` severity, so the `--only` probe can never reach zero while tasks 2.1/2.2 resolve findings by override. Only `files.includes` exclusions survive `--only`. Resolution: enable `correctness.noUndeclaredDependencies: "error"` in the base `biome.json` rule set and make the oracle a plain `biome lint .` filtered to that category. Spec delta updated in `specs/code-quality-loop/spec.md`.

## 2. Biome overrides and ignores

- [x] 2.1 Add `correctness.noUndeclaredDependencies: "off"` to the existing `__tests__/**` override in `biome.json`
- [x] 2.2 Derive the build/config override glob set from probe output, including `packages/electron/vite.main.config.ts`, `packages/electron/vite.preload.config.ts`, `packages/client/scripts/vite-build.mjs`, `packages/electron/scripts/download-git-windows.mjs` — derived set: `**/vitest.config.ts`, `**/vite.config.ts`, `**/vite.*.config.ts`, `**/forge.config.ts`, `packages/*/scripts/**`
- [x] 2.3 Add Biome ignores for the non-published trees: `examples/`, `openspec/changes/**/spike/`, `.pi/flows/**`, `tests/e2e/`, `qa/scripts/`, `.pi/skills/**/scripts/` — implemented as a rule-scoped **override** rather than a `files.includes` exclusion, which the spec permits ("a Biome ignore or override") and which preserves every other lint rule's coverage over those trees
- [x] 2.4 Author the override-guardrail test: enumerate every file matched by the build/config override, assert none lies under any `src/` directory, see scripts/__tests__/skill-frontmatter.test.mjs for the scripts-level vitest harness glue. Triple: the biome.json build/config override block · enumerate every matched file · none lies under any `src/` directory (test-plan #E16)
- [x] 2.5 Author the override-coverage test: assert the override matches the four non-obvious build entry points, see scripts/__tests__/skill-frontmatter.test.mjs. Triple: `vite.main.config.ts`, `vite.preload.config.ts`, `scripts/vite-build.mjs`, `scripts/download-git-windows.mjs` · apply the override · all four are matched (test-plan #E17)
- [x] 2.6 Author the spec-vs-config drift test: assert every override this change's spec asserts exists in `biome.json`, catching the pre-existing `packages/server/**` and `scripts/**` divergence, see scripts/__tests__/skill-frontmatter.test.mjs. Triple: the asserted override set vs biome.json · compare · every asserted override exists in biome.json (test-plan #E18)

## 3. Dependency declarations

- [x] 3.1 Declare `@mdi/js` at `^7.4.47` and `@mdi/react` at `^1.6.1` in `flows-plugin` and `automation-plugin`, and `@mdi/react` in `dashboard-plugin-runtime`
- [x] 3.2 Declare `dagre-d3-es` at `^7.0.14` in `flows-plugin`
- [x] 3.3 Declare `fastify` at `^5.0.0` in `automation-plugin`, `dashboard-plugin-runtime`, `hermes-memory-plugin`, `subagents-plugin` — as `peerDependencies`; every import is `import type { FastifyInstance }` and the dashboard host supplies the instance
- [x] 3.4 Declare `wouter` at `^3.9.0` in `automation-plugin`, applying the highest-lower-bound rule against the three existing sibling ranges
- [x] 3.5 Declare `typebox` at `^1.3.6` in `kb-extension`, NOT reusing the unsatisfiable `^1.3.7` that `packages/extension` currently declares
- [x] 3.6 Declare `react` in `shared` and `demo-plugin` as an optional peer or devDependency, never as `dependencies`, because `shared` is published and `ui-primitives.ts` guarantees no React runtime cost for non-renderer consumers
- [x] 3.7 Declare `@earendil-works/pi-ai` in `extension` as `peerDependencies` at `^0.75.5` with `peerDependenciesMeta["@earendil-works/pi-ai"].optional: true`, replacing the root-only `"*"` declaration
- [x] 3.8 Declare `@blackbelt-technology/pi-anthropic-messages` in `flows-anthropic-bridge-plugin` as an optional peer (`>=0.3.4`; registry confirms 0.3.4), and do NOT declare `@pi/anthropic-messages`, which returns E404 on the registry
- [x] 3.9 Declare `vite` in `electron` and `vitest` in `client` as devDependencies
- [x] 3.10 Declare `jiti` at `^2.7.0` and `yaml` at `^2.9.0` in the ROOT `devDependencies`, not `dependencies`, because the root is a published metapackage whose `files` array excludes the importing scripts

- [x] 3.17 **De-wildcard every non-private workspace (scope expansion forced by 3.14).** 35 pre-existing `"*"` ranges across the root and 7 workspaces (`extension`, `image-fit-extension`, `kb-extension`, `mockup-loop`, `nano-banana`, `video-production`, `video-transcription`) would fail the set-based no-wildcard test. Replaced with **lower-bound** ranges (`>=0.80.10` pi-coding-agent/pi-tui, `>=0.75.5` pi-ai, `>=0.73.1` `@mariozechner/*`, `>=1.3.6` typebox), not carets, so already-published consumers on older hosts are not excluded. Spec delta updated in `specs/workspace-publishing/spec.md`.
- [x] 3.18 **Suppress the one undeclarable specifier.** `@pi/anthropic-messages` cannot be declared (E404 would write an unresolvable dependency into a published manifest) and cannot be overridden (it sits in shipped runtime source). Added a single `biome-ignore` carrying the E404 reason, mirroring the checker's reasoned allowlist. This is the sole suppression in the runtime group and is forced by registry reality, not convenience.
- [x] 3.11 Author the range-reuse test, see scripts/__tests__/verify-release-deps-openspec-floor.test.mjs for the manifest-assertion harness. Triple: a dep already declared elsewhere whose resolving version satisfies that range · apply the range-selection rule · the reused range is chosen (test-plan #E19)
- [x] 3.12 Author the unsatisfiable-range test. Triple: `typebox` existing `^1.3.7` with `1.3.6` resolving, and `vitest` existing `^2.1.8` with `4.1.10` resolving · apply the rule · the unsatisfiable range is rejected and a caret on the resolving version is chosen (test-plan #E20)
- [x] 3.13 Author the sibling-disagreement test. Triple: `wouter` siblings `>=3.0.0`, `^3.0.0`, `^3.9.0` with `3.10.0` resolving · apply the rule · `^3.9.0` is chosen (test-plan #E21)
- [x] 3.14 Author the no-wildcard test. Triple: all four dependency fields of every non-private workspace · scan after the change · no declared range equals `"*"` (test-plan #E22)
- [x] 3.15 Author the optional-peer shape test. Triple: `packages/extension` after the change · read the manifest · `@earendil-works/pi-ai` sits in `peerDependencies` at a concrete range with `peerDependenciesMeta` optional true (test-plan #E23)
- [x] 3.16 Author the root-tooling-field test. Triple: root `package.json` after declaring `jiti` and `yaml` · read the manifest · both in `devDependencies`, neither in `dependencies` (test-plan #E25)

## 4. The bus-client public-access fix

- [x] 4.1 Add `"publishConfig": { "access": "public" }` to `packages/bus-client/package.json`, the single adjacent finding this change repairs because it is the same requirement the change modifies
- [x] 4.2 Author the set-based public-access test, see scripts/__tests__/verify-release-deps-openspec-floor.test.mjs. Triple: every `packages/*/package.json` without `"private": true` · read each · each declares `publishConfig.access` equal to `"public"` (test-plan #E24)

## 5. The publish-correctness checker

- [x] 5.1 Write `scripts/verify-published-imports.mjs`, exporting its analysis as a library AND exposing a CLI, mirroring the dual shape of `scripts/check-skill-frontmatter.mjs`
- [x] 5.2 Derive the shipped file set per workspace from `npm pack` dry-run output rather than a glob, so `files` and `.npmignore` semantics match the registry exactly
- [x] 5.3 Implement specifier normalization for all four shapes: bare, scoped two-segment, deep subpath, and relative
- [x] 5.4 Implement the acceptance rule: for a shipped file only `dependencies`, `peerDependencies`, and `optionalDependencies` satisfy an import; `devDependencies` do NOT, because they are not installed for a consumer
- [x] 5.5 Implement the reasoned allowlist, seeded with `@pi/anthropic-messages` for `flows-anthropic-bridge-plugin`, rejecting any entry that lacks a reason string
- [x] 5.6 Run the checker against the real repository early, before the declarations are considered complete, because it is stricter than Biome and may surface shipped-file-imports-devDependency findings invisible to the Biome baseline
- [x] 5.7 Author the undeclared-import test, see scripts/__tests__/skill-frontmatter.test.mjs for building a temp fixture and invoking the subject as a library. Triple: temp fixture whose shipped `index.js` imports `left-pad` with an empty manifest · run the checker as a library · exits non-zero naming the workspace, the file, and `left-pad` (test-plan #E1)
- [x] 5.8 Author the declared-runtime-dep test. Triple: temp fixture shipping `index.js` importing `fastify` with `dependencies.fastify` declared · run the checker · exits zero with no findings (test-plan #E2)
- [x] 5.9 Author the devDependency-in-shipped-file test. Triple: temp fixture shipping `index.js` importing `vitest` declared only in `devDependencies` · run the checker · exits non-zero stating the dep is dev-only and will not install for a consumer (test-plan #E3)
- [x] 5.10 Author the devDependency-outside-shipped-set test. Triple: temp fixture with `files: ["dist/"]` and `src/test-support/h.ts` importing `vitest` from `devDependencies` · run the checker · exits zero because the importing file is outside the packed set (test-plan #E4)
- [x] 5.11 Author the peer and optional-peer acceptance test. Triple: temp fixture shipping code importing `pi-ai` declared as an optional peer at `^0.75.5` · run the checker · exits zero (test-plan #E5)
- [x] 5.12 Author the deep-subpath test. Triple: shipped file importing `dagre-d3-es/src/dagre/index.js` with `dagre-d3-es` declared · run the checker · exits zero and reports no finding named for the subpath (test-plan #E6)
- [x] 5.13 Author the scoped-package test. Triple: shipped file importing `@mdi/react` with `@mdi/react` declared · run the checker · exits zero (test-plan #E7)
- [x] 5.14 Author the scoped-deep-subpath test. Triple: shipped file importing `@scope/pkg/sub/path.js` with `@scope/pkg` declared · run the checker · exits zero (test-plan #E8)
- [x] 5.15 Author the Node-builtin test. Triple: shipped file importing `node:path`, `path`, and `node:fs` with none declared · run the checker · exits zero (test-plan #E9)
- [x] 5.16 Author the dangling-relative-import test. Triple: shipped `index.js` importing `./missing.js` absent from the packed list · run the checker · exits non-zero naming the dangling import (test-plan #E10)
- [x] 5.17 Author the private-workspace-skip test. Triple: fixture with `"private": true` and an undeclared shipped import · run the checker · the workspace is skipped and the run exits zero (test-plan #E11)
- [x] 5.18 Author the allowlist-honoured test. Triple: fixture importing `@pi/anthropic-messages` with an allowlist entry carrying a reason · run the checker · exits zero and does not report the specifier (test-plan #E12)
- [x] 5.19 Author the allowlist-needs-a-reason test. Triple: an allowlist entry lacking a reason field · run the checker · exits non-zero so exceptions cannot accumulate silently (test-plan #E13)
- [x] 5.20 Author the fixture-cleanliness test. Triple: the fixture suite · suite completes · no fixture directory remains under `packages/` and the repo-wide run is unaffected (test-plan #E14)
- [x] 5.21 Author the pack-failure fault test. Triple: a workspace whose `npm pack --dry-run` exits non-zero · run the checker across the set · that workspace is reported as an error and the run exits non-zero rather than silently skipping it (test-plan #X1)
- [x] 5.22 Author the unparseable-source fault test. Triple: a shipped file containing a syntax error · run the checker · the file is reported as unparseable and the run exits non-zero, rather than treating zero specifiers as a pass (test-plan #X2)
- [x] 5.23 Author the uninstalled-dependency fault test. Triple: a dep declared but absent from `node_modules`, as `@blackbelt-technology/pi-anthropic-messages` is today · run range verification · the range is reported unverifiable rather than crashing or silently passing (test-plan #X3)

## 6. CI wiring

- [x] 6.1 Add the checker to `.github/workflows/ci.yml` alongside the existing `Verify release dependency shape` and `Skill frontmatter guard` steps
- [x] 6.2 Author the repo-root zero-findings assertion, see the ci.yml step at `Biome static analysis` for the workflow-level pattern. Triple: the repository after declarations, overrides and ignores land · run a plain repo-root `biome lint .` and filter to the `lint/correctness/noUndeclaredDependencies` category (NOT an `--only` probe — see 1.4) · reports zero findings (test-plan #E15)
- [x] 6.3 Author the publish dry-run set assertion. Triple: the workspace set · `npm publish --workspaces --include-workspace-root --dry-run` · one entry per non-private workspace and no entry for any private workspace (test-plan #E26)
- [x] 6.4 Author the probe-invocation guard. Triple: the rule name asserted by the oracle · confirm `biome.json` enables `correctness.noUndeclaredDependencies` at `error` and that an unknown rule name is rejected · non-zero exit, guarding against an oracle that reports zero because it ran nothing (test-plan #X4)
- [x] 6.5 Author the checker runtime budget assertion. Triple: all non-private workspaces with full pack and parse · single CI run · total wall-clock under 60 seconds (test-plan #P1)
- [x] 6.6 Add the post-release registry assertion to `.github/workflows/publish.yml`, alongside the `Verify lockfile matches workspace versions` step. Triple: every `packages/*/package.json` without `"private": true` · after a tagged release publishes `<version>` · `npm view <name> version` returns `<version>` for each (test-plan #R1)

## 7. Verify

- [x] 7.1 Re-run the repo-root probe and confirm zero findings for `noUndeclaredDependencies` — **0 findings** via plain `biome lint .` (1411 → 0)
- [x] 7.2 Run `npm run quality:changed` and confirm it passes
- [x] 7.3 Run the new checker across the real repository and confirm zero findings
- [x] 7.4 Confirm all 32 non-private workspaces are enumerated and verified, not just the 6 sampled during planning

## 8. Defects surfaced by the checker (task 5.6 predicted these)

Running the checker against the real repository before declaring the work
complete — as 5.6 required — surfaced two classes Biome's baseline cannot see.
Both are resolved; neither was budgeted by the proposal.

- [x] 8.1 **17 workspaces shipped their `__tests__/` to npm** (862 of 867 errors). `files: ["src/"]` swept `src/__tests__/` into the tarball; those shipped tests import `vitest`/`@testing-library/react` (devDeps, never installed for a consumer) and reach across the monorepo via relative paths absent from the tarball (11 dangling imports). Added `!**/__tests__`, `!**/*.test.ts`, `!**/*.test.tsx` to all 17. Nested `__tests__` dirs exist (e.g. `server/src/attachments/__tests__`), so `**/` is required, not `src/__tests__`. Also shrinks tarballs — `bus-client` shipped 16 of 25 files as tests, 28KB of 62KB.
- [x] 8.2 **4 genuine dev-only imports in shipped runtime code.** `dashboard-plugin-runtime/src/server/config-validator.ts` → `ajv` moved to `dependencies` (runtime; would have thrown for a consumer); `dashboard-plugin-runtime/src/vite-plugin/index.ts` → `vite` to `peerDependencies`; `kb-plugin/src/server/kb-routes.ts` → `fastify` to `peerDependencies` (same fix as the 4 siblings in 3.3); `bus-client/src/codegen/` excluded from the tarball (`typescript` is dev tooling, not an export).
- [x] 8.3 Fixed a checker bug found by the real run: `packages/client`'s `prepack` prints build output on stdout, breaking `JSON.parse`. `parsePackOutput` now scans for the payload from the right, and returns `null` — never a guess — so an unreadable pack stays a reportable error rather than an empty, silently-passing file set.
- [x] 8.4 Declared `semver` in root `devDependencies` — needed to make the range-selection rule executable (`selectRange`) instead of prose, and declared per the same rule this change enforces.
