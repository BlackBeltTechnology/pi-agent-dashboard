# Tasks — cleanup-undeclared-dependencies

Test tasks are folded from `test-plan.md`; that manifest is the source of truth
for automated-vs-manual. All 32 manifest rows are `automated`; there are no
`manual-only` rows to defer.

## 1. Re-derive the baseline

- [ ] 1.1 Run `npx biome lint --only=correctness/noUndeclaredDependencies . --max-diagnostics=20000` at repo root and record the current total; the 1398 figure in the proposal is a snapshot and the tree moves
- [ ] 1.2 Bucket the findings into test-file / build-config / runtime-in-package-source / outside-packages, and confirm the four groups still sum to the total
- [ ] 1.3 Produce the per-finding declare-vs-override mapping for the in-`packages/` non-test findings, so the manifest edit set is derivable rather than guessed

## 2. Biome overrides and ignores

- [ ] 2.1 Add `correctness.noUndeclaredDependencies: "off"` to the existing `__tests__/**` override in `biome.json`
- [ ] 2.2 Derive the build/config override glob set from probe output, including `packages/electron/vite.main.config.ts`, `packages/electron/vite.preload.config.ts`, `packages/client/scripts/vite-build.mjs`, `packages/electron/scripts/download-git-windows.mjs`
- [ ] 2.3 Add Biome ignores for the non-published trees: `examples/`, `openspec/changes/**/spike/`, `.pi/flows/**`, `tests/e2e/`, `qa/scripts/`, `.pi/skills/**/scripts/`
- [ ] 2.4 Author the override-guardrail test: enumerate every file matched by the build/config override, assert none lies under any `src/` directory, see scripts/__tests__/skill-frontmatter.test.mjs for the scripts-level vitest harness glue. Triple: the biome.json build/config override block · enumerate every matched file · none lies under any `src/` directory (test-plan #E16)
- [ ] 2.5 Author the override-coverage test: assert the override matches the four non-obvious build entry points, see scripts/__tests__/skill-frontmatter.test.mjs. Triple: `vite.main.config.ts`, `vite.preload.config.ts`, `scripts/vite-build.mjs`, `scripts/download-git-windows.mjs` · apply the override · all four are matched (test-plan #E17)
- [ ] 2.6 Author the spec-vs-config drift test: assert every override this change's spec asserts exists in `biome.json`, catching the pre-existing `packages/server/**` and `scripts/**` divergence, see scripts/__tests__/skill-frontmatter.test.mjs. Triple: the asserted override set vs biome.json · compare · every asserted override exists in biome.json (test-plan #E18)

## 3. Dependency declarations

- [ ] 3.1 Declare `@mdi/js` at `^7.4.47` and `@mdi/react` at `^1.6.1` in `flows-plugin` and `automation-plugin`, and `@mdi/react` in `dashboard-plugin-runtime`
- [ ] 3.2 Declare `dagre-d3-es` at `^7.0.14` in `flows-plugin`
- [ ] 3.3 Declare `fastify` at `^5.0.0` in `automation-plugin`, `dashboard-plugin-runtime`, `hermes-memory-plugin`, `subagents-plugin`
- [ ] 3.4 Declare `wouter` at `^3.9.0` in `automation-plugin`, applying the highest-lower-bound rule against the three existing sibling ranges
- [ ] 3.5 Declare `typebox` at `^1.3.6` in `kb-extension`, NOT reusing the unsatisfiable `^1.3.7` that `packages/extension` currently declares
- [ ] 3.6 Declare `react` in `shared` and `demo-plugin` as an optional peer or devDependency, never as `dependencies`, because `shared` is published and `ui-primitives.ts` guarantees no React runtime cost for non-renderer consumers
- [ ] 3.7 Declare `@earendil-works/pi-ai` in `extension` as `peerDependencies` at `^0.75.5` with `peerDependenciesMeta["@earendil-works/pi-ai"].optional: true`, replacing the root-only `"*"` declaration
- [ ] 3.8 Declare `@blackbelt-technology/pi-anthropic-messages` in `flows-anthropic-bridge-plugin` as an optional peer, and do NOT declare `@pi/anthropic-messages`, which returns E404 on the registry
- [ ] 3.9 Declare `vite` in `electron` and `vitest` in `client` as devDependencies
- [ ] 3.10 Declare `jiti` at `^2.7.0` and `yaml` at `^2.9.0` in the ROOT `devDependencies`, not `dependencies`, because the root is a published metapackage whose `files` array excludes the importing scripts
- [ ] 3.11 Author the range-reuse test, see scripts/__tests__/verify-release-deps-openspec-floor.test.mjs for the manifest-assertion harness. Triple: a dep already declared elsewhere whose resolving version satisfies that range · apply the range-selection rule · the reused range is chosen (test-plan #E19)
- [ ] 3.12 Author the unsatisfiable-range test. Triple: `typebox` existing `^1.3.7` with `1.3.6` resolving, and `vitest` existing `^2.1.8` with `4.1.10` resolving · apply the rule · the unsatisfiable range is rejected and a caret on the resolving version is chosen (test-plan #E20)
- [ ] 3.13 Author the sibling-disagreement test. Triple: `wouter` siblings `>=3.0.0`, `^3.0.0`, `^3.9.0` with `3.10.0` resolving · apply the rule · `^3.9.0` is chosen (test-plan #E21)
- [ ] 3.14 Author the no-wildcard test. Triple: all four dependency fields of every non-private workspace · scan after the change · no declared range equals `"*"` (test-plan #E22)
- [ ] 3.15 Author the optional-peer shape test. Triple: `packages/extension` after the change · read the manifest · `@earendil-works/pi-ai` sits in `peerDependencies` at a concrete range with `peerDependenciesMeta` optional true (test-plan #E23)
- [ ] 3.16 Author the root-tooling-field test. Triple: root `package.json` after declaring `jiti` and `yaml` · read the manifest · both in `devDependencies`, neither in `dependencies` (test-plan #E25)

## 4. The bus-client public-access fix

- [ ] 4.1 Add `"publishConfig": { "access": "public" }` to `packages/bus-client/package.json`, the single adjacent finding this change repairs because it is the same requirement the change modifies
- [ ] 4.2 Author the set-based public-access test, see scripts/__tests__/verify-release-deps-openspec-floor.test.mjs. Triple: every `packages/*/package.json` without `"private": true` · read each · each declares `publishConfig.access` equal to `"public"` (test-plan #E24)

## 5. The publish-correctness checker

- [ ] 5.1 Write `scripts/verify-published-imports.mjs`, exporting its analysis as a library AND exposing a CLI, mirroring the dual shape of `scripts/check-skill-frontmatter.mjs`
- [ ] 5.2 Derive the shipped file set per workspace from `npm pack` dry-run output rather than a glob, so `files` and `.npmignore` semantics match the registry exactly
- [ ] 5.3 Implement specifier normalization for all four shapes: bare, scoped two-segment, deep subpath, and relative
- [ ] 5.4 Implement the acceptance rule: for a shipped file only `dependencies`, `peerDependencies`, and `optionalDependencies` satisfy an import; `devDependencies` do NOT, because they are not installed for a consumer
- [ ] 5.5 Implement the reasoned allowlist, seeded with `@pi/anthropic-messages` for `flows-anthropic-bridge-plugin`, rejecting any entry that lacks a reason string
- [ ] 5.6 Run the checker against the real repository early, before the declarations are considered complete, because it is stricter than Biome and may surface shipped-file-imports-devDependency findings invisible to the Biome baseline
- [ ] 5.7 Author the undeclared-import test, see scripts/__tests__/skill-frontmatter.test.mjs for building a temp fixture and invoking the subject as a library. Triple: temp fixture whose shipped `index.js` imports `left-pad` with an empty manifest · run the checker as a library · exits non-zero naming the workspace, the file, and `left-pad` (test-plan #E1)
- [ ] 5.8 Author the declared-runtime-dep test. Triple: temp fixture shipping `index.js` importing `fastify` with `dependencies.fastify` declared · run the checker · exits zero with no findings (test-plan #E2)
- [ ] 5.9 Author the devDependency-in-shipped-file test. Triple: temp fixture shipping `index.js` importing `vitest` declared only in `devDependencies` · run the checker · exits non-zero stating the dep is dev-only and will not install for a consumer (test-plan #E3)
- [ ] 5.10 Author the devDependency-outside-shipped-set test. Triple: temp fixture with `files: ["dist/"]` and `src/test-support/h.ts` importing `vitest` from `devDependencies` · run the checker · exits zero because the importing file is outside the packed set (test-plan #E4)
- [ ] 5.11 Author the peer and optional-peer acceptance test. Triple: temp fixture shipping code importing `pi-ai` declared as an optional peer at `^0.75.5` · run the checker · exits zero (test-plan #E5)
- [ ] 5.12 Author the deep-subpath test. Triple: shipped file importing `dagre-d3-es/src/dagre/index.js` with `dagre-d3-es` declared · run the checker · exits zero and reports no finding named for the subpath (test-plan #E6)
- [ ] 5.13 Author the scoped-package test. Triple: shipped file importing `@mdi/react` with `@mdi/react` declared · run the checker · exits zero (test-plan #E7)
- [ ] 5.14 Author the scoped-deep-subpath test. Triple: shipped file importing `@scope/pkg/sub/path.js` with `@scope/pkg` declared · run the checker · exits zero (test-plan #E8)
- [ ] 5.15 Author the Node-builtin test. Triple: shipped file importing `node:path`, `path`, and `node:fs` with none declared · run the checker · exits zero (test-plan #E9)
- [ ] 5.16 Author the dangling-relative-import test. Triple: shipped `index.js` importing `./missing.js` absent from the packed list · run the checker · exits non-zero naming the dangling import (test-plan #E10)
- [ ] 5.17 Author the private-workspace-skip test. Triple: fixture with `"private": true` and an undeclared shipped import · run the checker · the workspace is skipped and the run exits zero (test-plan #E11)
- [ ] 5.18 Author the allowlist-honoured test. Triple: fixture importing `@pi/anthropic-messages` with an allowlist entry carrying a reason · run the checker · exits zero and does not report the specifier (test-plan #E12)
- [ ] 5.19 Author the allowlist-needs-a-reason test. Triple: an allowlist entry lacking a reason field · run the checker · exits non-zero so exceptions cannot accumulate silently (test-plan #E13)
- [ ] 5.20 Author the fixture-cleanliness test. Triple: the fixture suite · suite completes · no fixture directory remains under `packages/` and the repo-wide run is unaffected (test-plan #E14)
- [ ] 5.21 Author the pack-failure fault test. Triple: a workspace whose `npm pack --dry-run` exits non-zero · run the checker across the set · that workspace is reported as an error and the run exits non-zero rather than silently skipping it (test-plan #X1)
- [ ] 5.22 Author the unparseable-source fault test. Triple: a shipped file containing a syntax error · run the checker · the file is reported as unparseable and the run exits non-zero, rather than treating zero specifiers as a pass (test-plan #X2)
- [ ] 5.23 Author the uninstalled-dependency fault test. Triple: a dep declared but absent from `node_modules`, as `@blackbelt-technology/pi-anthropic-messages` is today · run range verification · the range is reported unverifiable rather than crashing or silently passing (test-plan #X3)

## 6. CI wiring

- [ ] 6.1 Add the checker to `.github/workflows/ci.yml` alongside the existing `Verify release dependency shape` and `Skill frontmatter guard` steps
- [ ] 6.2 Author the repo-root zero-findings assertion, see the ci.yml step at `Biome static analysis` for the workflow-level pattern. Triple: the repository after declarations, overrides and ignores land · run the repo-root `--only` probe · reports zero findings (test-plan #E15)
- [ ] 6.3 Author the publish dry-run set assertion. Triple: the workspace set · `npm publish --workspaces --include-workspace-root --dry-run` · one entry per non-private workspace and no entry for any private workspace (test-plan #E26)
- [ ] 6.4 Author the probe-invocation guard. Triple: `--only=correctness/noSuchRule` · run the probe · non-zero exit, guarding against a probe that reports zero because it ran nothing (test-plan #X4)
- [ ] 6.5 Author the checker runtime budget assertion. Triple: all non-private workspaces with full pack and parse · single CI run · total wall-clock under 60 seconds (test-plan #P1)
- [ ] 6.6 Add the post-release registry assertion to `.github/workflows/publish.yml`, alongside the `Verify lockfile matches workspace versions` step. Triple: every `packages/*/package.json` without `"private": true` · after a tagged release publishes `<version>` · `npm view <name> version` returns `<version>` for each (test-plan #R1)

## 7. Verify

- [ ] 7.1 Re-run the repo-root probe and confirm zero findings for `noUndeclaredDependencies`
- [ ] 7.2 Run `npm run quality:changed` and confirm it passes
- [ ] 7.3 Run the new checker across the real repository and confirm zero findings
- [ ] 7.4 Confirm all 32 non-private workspaces are enumerated and verified, not just the 6 sampled during planning
