# DOX — scripts/__tests__

Vitest tests for `scripts/*.mjs`. One row per file. Split out of `scripts/AGENTS.md` (byte cap). See change: move-subagents-to-plugin.

| File | Purpose |
|------|---------|
| `anti-slop-suite-contract.test.mjs` | Static L1 contract over `packages/anti-slop` skill suite + dashboard adapter. → see `anti-slop-suite-contract.test.mjs.AGENTS.md` |
| `assert-bundled-plugins-complete.test.mjs` | Vitest unit tests for packages/electron/scripts/assert-bun… → see `assert-bundled-plugins-complete.test.mjs.AGENTS.md` |
| `assert-bundled-server-plugin-load.test.mjs` | Tests for the bundled-server plugin-load gate: |
| `budget-assertions.test.mjs` | Tests for the warn-only budget guard. → see `budget-assertions.test.mjs.AGENTS.md` |
| `budget-lane.test.mjs` | `check-budget-lane.mjs` wrapper + fixtures. → see `budget-lane.test.mjs.AGENTS.md` |
| `build-runtime-canary.test.mjs` | Builds canary + variants via SDK preset; artifact shape (#E95). → see `build-runtime-canary.mjs.AGENTS.md` |
| `check-kb-dist-fresh.test.mjs` | C1 (fix-kb-eval-measurement-integrity): fault-injection vi… → see `check-kb-dist-fresh.test.mjs.AGENTS.md` |
| `check-mockups.test.mjs` | → `__tests__/check-mockups.test.mjs.AGENTS.md` |
| `check-pi-settings-paths.test.mjs` | Drives `absoluteSourceViolations`, `emptyFilterViolations` and `main` directly… → see `check-pi-settings-paths.test.mjs.AGENTS.md` |
| `check-plugin-boundary.test.mjs` | `check-plugin-boundary.mjs` CLI on tmp `packages/*` trees (test-plan #E1–#E8) + r… → see `check-plugin-boundary.test.mjs.AGENTS.md` |
| `check-subagent-boundary.test.mjs` | `check-subagent-boundary.mjs` CLI on tmp trees (#E39: `subagent_*` case, prose, SUBAGENTSTATE, allowlisted… → see `check-subagent-boundary.test.mjs.AGENTS.md` |
| `client-sinks.test.mjs` | `check-client-sinks.mjs` tests. See change: harden-client-sinks. |
| `discord-release-announce.test.mjs` | → see `discord-release-announce.test.mjs.AGENTS.md` |
| `e2e-canary-seed.test.mjs` | → see `e2e-canary-seed.test.mjs.AGENTS.md` |
| `encoded-cwd-oneliner.test.mjs` | #E10 shell one-liner = `encodeFolderPath`. See change: add-session-ui-deep-links-for-agents. |
| `host-api-surface.test.mjs` | Bump-rule table for `host-api-surface.mjs` (#E29), committed snapshot is current, accent-token expansion, unexpanded … |
| `biome-undeclared-dependencies.test.mjs` | Guardrails for the `noUndeclaredDependencies` config in `biome.json`. → see `biome-undeclared-dependencies.test.mjs.AGENTS.md` |
| `claude-plugin-ensure-dashboard.test.mjs` | Behaviour tests for `ensure-dashboard.sh` (test-plan E3–E34, P1, X1–X10): |
| `claude-plugin-publish-contract.test.mjs` | Static contract over `publish.yml`. `publish` preflight re… → see `claude-plugin-publish-contract.test.mjs.AGENTS.md` |
| `claude-plugin-parity.test.mjs` | → see `claude-plugin-parity.test.mjs.AGENTS.md` |
| `claude-plugin-structure.test.mjs` | → see `claude-plugin-structure.test.mjs.AGENTS.md` |
| `claude-plugin-version.test.mjs` | `plugin.json` = root version (E40), `sync-versions.js` stamping idempotent (E41), `release-cut` stages + verifies it (E42). |
| `claude-plugin-zip.test.mjs` | Release zip layout (E44) and version gate (E45) for `build-claude-plugin-zip.mjs`. |
| `codeql-local-cli.test.mjs` | `codeql-local.mjs` end to end against a fake `CODEQL_BIN`… → see `codeql-local-cli.test.mjs.AGENTS.md` |
| `codeql-local-real.test.mjs` | `codeql-local.mjs` against the REAL CodeQL CLI on tiny repos (#E4, #E18, #X6). → see `codeql-local-real.test.mjs.AGENTS.md` |
| `codeql-local-mirror.test.mjs` | → `__tests__/codeql-local-mirror.test.mjs.AGENTS.md` |
| `codeql-local.test.mjs` | Pure decision logic of `codeql-local.mjs` (#E14, #E15, #E17… → see `codeql-local.test.mjs.AGENTS.md` |
| `coverage-config.test.mjs` | Coverage config shape; `coverage-unloaded` fixture stays unloaded (E29-E31). See change: triage-browser-e2e-offbox-poison. |
| `coverage-report.test.mjs` | Live coverage runs; E2 scoped to `fixtures/coverage-unloaded`. See change: triage-browser-e2e-offbox-poison. |
| `client-isolate-gate.test.mjs` | Client isolate gate. Also E22 (keycloak dep dropped) and E… → see `client-isolate-gate.test.mjs.AGENTS.md` |
| `e2e-fixture-import.test.mjs` | Guard tests for `check-e2e-fixture-import.mjs` (E6/E7, trust-write lint E21/E22). See change: triage-browser-e2e-offbox-poison. |
| `e2e-reap-core.test.mjs` | L1 for `tests/e2e/reap-core.ts` (reap, refusal verdict, trust isolation E8-E18, X5-X16). See change: triage-browser-e2e-offbox-poison. |
| `e2e-trust-seed.test.mjs` | Runs the `test-entrypoint.sh` config-seed program verbatim (E23-E25). See change: triage-browser-e2e-offbox-poison. |
| `fixtures/coverage-unloaded/` | Fixture: one source file no test imports + no-op test + pinned config (scoped E2). See change: triage-browser-e2e-offbox-poison. |
| `dependency-declarations.test.mjs` | Set-based manifest guarantees. → see `dependency-declarations.test.mjs.AGENTS.md` |
| `dependency-declarations.budget.test.mjs` | Checker runtime budget. → see `dependency-declarations.budget.test.mjs.AGENTS.md` |
| `fixtures/codeql-harness.mjs` | Test harness for `codeql-local.mjs`: temp git repos, per-ca… → see `fixtures/codeql-harness.mjs.AGENTS.md` |
| `fixtures/codeql-resolve-extensions.json` | → `__tests__/fixtures/codeql-resolve-extensions.json.AGENTS.md` |
| `fixtures/coverage-failing/` | Red coverage fixture. |
| `fixtures/fake-codeql.mjs` | Fake `codeql` (`CODEQL_BIN` seam). Plan from `$FAKE_CODEQL… → see `fixtures/fake-codeql.mjs.AGENTS.md` |
| `fixtures/fake-gh.mjs` | Fake `gh` (`PI_CODEQL_GH_BIN` seam), driven by `$FAKE_GH_PLAN`. See change: codeql-model-pack-and-mirror. |
| `fixtures/gh-code-scanning-alert.json` | Recorded real `gh api …/code-scanning/alerts/464` (trimmed); base of `ghAlert()`. See change: codeql-model-pack-and-mirror. |
| `fixtures/mutation-journal-child.mjs` | Child-process fixture for the mutation-journal crash-safety tests. → see `fixtures/mutation-journal-child.mjs.AGENTS.md` |
| `fixtures/npm-view-stub.mjs` | Gate CLI npm-view stub. → see `fixtures/npm-view-stub.mjs.AGENTS.md` |
| `helpers/ensure-dashboard-harness.mjs` | `makeCtx()` sandbox for the bootstrap tests: temp HOME, logging stub executables, fixture/pid helpers, async `run()`. |
| `helpers/fixture-dashboard-server.mjs` | Standalone fixture `/api/health` server (modes dashboard/wrong-pid/no-pid/recovery/foreign-html/hung). |
| `merge-latest-mac.test.mjs` | Covers test-plan U6 for `merge-latest-mac.py`: the `minimu… → see `merge-latest-mac.test.mjs.AGENTS.md` |
| `qa-pack-fixture-plugin.test.mjs` | Tests `qa/scripts/pack-fixture-plugin.mjs`. |
| `qa-dist-only-scripts.test.mjs` | Guards QA 47–51, #E103. → `__tests__/qa-dist-only-scripts.test.mjs.AGENTS.md` |
| `seed-settings-compaction.test.mjs` | Unit tests for the e2e-only `compaction.keepRecentTokens`… → see `seed-settings-compaction.test.mjs.AGENTS.md` |
| `nightly-report.test.mjs` | Nightly report (X9–X11). → see `nightly-report.test.mjs.AGENTS.md` |
| `shared-heavy-files.test.mjs` | Heavy shared groups. |
| `select-affected-tests.test.mjs` | Selector layers (E1–E27) → see `select-affected-tests.test.mjs.AGENTS.md` |
| `select-affected-tests-cli.test.mjs` | Selector CLI (X2–X8) → see `select-affected-tests-cli.test.mjs.AGENTS.md` |
| `select-affected-tests-graph.test.mjs` | Real-tree graph build (X1, P1). → see `select-affected-tests-graph.test.mjs.AGENTS.md` |
| `test-selection-data.test.mjs` | Selection data contract (E29). → see `test-selection-data.test.mjs.AGENTS.md` |
| `fixed-tick-waits.test.mjs` | Guard tests + vitest wrapper for `check-fixed-tick-waits.m… → see `fixed-tick-waits.test.mjs.AGENTS.md` |
| `jiti-cjs-transpile-safety.test.mjs` | Repo gate: jiti CJS transpile safety. → see `jiti-cjs-transpile-safety.test.mjs.AGENTS.md` |
| `loader-neutral-source.test.mjs` | Loader-neutral gate tests E23–E28 + repo HEAD clean. See change: fix-appimage-cold-boot-latency. |
| `kb-packaging.test.mjs` | C2 (fix-kb-eval-measurement-integrity, ci-level behind RUN_CI_SCENARIOS=1)… → see `kb-packaging.test.mjs.AGENTS.md` |
| `knip-config.test.mjs` | Entry-point rooting for the dead-code oracle (test-plan #G1, #G2, #G4, #D1, #P2). → see `knip-config.test.mjs.AGENTS.md` |
| `knip-harness.test.mjs` | Docker-harness reproducibility for the dead-code oracle (test-plan #H1). → see `knip-harness.test.mjs.AGENTS.md` |
| `lint-harness-scoping.test.mjs` | Guards that repo-wide lint harnesses judge git-tracked SOU… → see `lint-harness-scoping.test.mjs.AGENTS.md` |
| `knip-ratchet.test.mjs` | Per-class dead-code ratchet (test-plan #R1-#R6). Load-beari… → see `knip-ratchet.test.mjs.AGENTS.md` |
| `tsc7-wrapper.test.mjs` | E1–E6, E8, E9, E11, X4: wrapper runs TS 7 from any cwd, fo… → see `tsc7-wrapper.test.mjs.AGENTS.md` |
| `verify-release-deps-keyring-floor.test.mjs` | E87 `@napi-rs/keyring` floor. → see `verify-release-deps-keyring-floor.test.mjs.AGENTS.md` |
| `z-layer-lint.test.mjs` | Overlay z-index ratchet tests (test-plan #E4/#E5): `extractRawZ` matches raw… → see `z-layer-lint.test.mjs.AGENTS.md` |
| `knip-scan.test.mjs` | Live Knip scan assertions. → see `knip-scan.test.mjs.AGENTS.md` |
| `knip-scan.budget.test.mjs` | Knip scan time budget. → see `knip-scan.budget.test.mjs.AGENTS.md` |
| `mutation-journal.test.mjs` | Vitest crash-safety tests for the mutation-harness journal (test-plan #E1-#E8, #X1-#X13). → see `mutation-journal.test.mjs.AGENTS.md` |
| `nightly-verdaccio-publish-standalone.budget.test.mjs` | Real-run test. → see `nightly-verdaccio-publish-standalone.budget.test.mjs.AGENTS.md` |
| `nightly-verdaccio-publish.test.mjs` | Vitest unit tests for scripts/nightly-verdaccio-publish.mj… → see `nightly-verdaccio-publish.test.mjs.AGENTS.md` |
| `qa-smoke-guards.test.mjs` | Fault-injects the clean-prefix QA smoke (`qa/tests/35-plugin-install-load.sh`) by stubbing… → see `qa-smoke-guards.test.mjs.AGENTS.md` |
| `prune-memory-backups.test.mjs` | Pins `planPrune` selection + `prune` IO for the hermes store trim. → see `prune-memory-backups.test.mjs.AGENTS.md` |
| `rebuild-scripts-gate.test.mjs` | X5 fault injection: `rebuild-restart.sh` + `rebuild-and-restart.sh` run the se… → see `rebuild-scripts-gate.test.mjs.AGENTS.md` |
| `repair-meta-source.test.mjs` | Vitest unit tests for repair-meta-source.mjs. Asserts source:"dashboard" → cleaned (o… → see `repair-meta-source.test.mjs.AGENTS.md` |
| `review-changes-parser.test.mjs` | Vitest unit tests for parseFindings + splitFindings (.pi/s… → see `review-changes-parser.test.mjs.AGENTS.md` |
| `settings-kit-guard.test.mjs` | Settings-kit ratchet tests: per-kind counts + negatives (#… → see `settings-kit-guard.test.mjs.AGENTS.md` |
| `severity-literal-guard.test.mjs` | Static guard: no raw `red-<NN(N)>` Tailwind literal (2- or… → see `severity-literal-guard.test.mjs.AGENTS.md` |
| `ship-it-manifest.test.mjs` | Vitest unit tests for ship-it `manifest.ts` (`.pi/skills/ship-it/scripts/`). → see `ship-it-manifest.test.mjs.AGENTS.md` |
| `ship-it-no-weakening.test.mjs` | Vitest unit tests for ship-it `no-weakening.ts` assertNoWeakening. → see `ship-it-no-weakening.test.mjs.AGENTS.md` |
| `skill-frontmatter.test.mjs` | Vitest guard over every repo `**/SKILL.md` (skips node_modules/dist/worktrees). → see `skill-frontmatter.test.mjs.AGENTS.md` |
| `spec-collateral.test.mjs` | L1 for `spec-collateral.mjs` (E1–E26, P1–P2, X1–X5). → see `spec-collateral.test.mjs.AGENTS.md` |
| `sync-served-client.test.mjs` | E15/E16/X3/X4: the `sync-served-client.mjs` outcome table… → see `sync-served-client.test.mjs.AGENTS.md` |
| `verify-release-deps-client-build-deps.test.mjs` | Vitest tests for the E7 client build-dep rules… → see `verify-release-deps-client-build-deps.test.mjs.AGENTS.md` |
| `theme-token-guard.test.mjs` | Scan/ratchet/bootstrap tests for all three guard arms. → see `theme-token-guard.test.mjs.AGENTS.md` |
| `harness-audit-armed.test.mjs` | → `__tests__/harness-audit-armed.test.mjs.AGENTS.md` |
| `harness-recorder-helpers.mjs` | Shared docker stub + sandbox for the harness recorder tests (not a test file). See change: add-missing-ci-legs. |
| `site-drift-decision.test.mjs` | → `__tests__/site-drift-decision.test.mjs.AGENTS.md` |
| `test-down-recorder.test.mjs` | `test-down.sh` teardown marker, ≤10 s destroy wait, dead/absent recorder (stub docker). See change: add-missing-ci-legs. |
| `test-up-recorder.test.mjs` | `test-up.sh` lifecycle recorder: state fields, events path, ordering, re-up idempotence, best-effort faults. See change: add-missing-ci-legs. |
| `test-up-oversubscribe-guard.test.mjs` | Vitest tests for the co-resident harness oversubscription… → see `test-up-oversubscribe-guard.test.mjs.AGENTS.md` |
| `test-up-port-derivation.test.mjs` | Vitest tests for parallel-worktree test-harness port/project derivation. → see `test-up-port-derivation.test.mjs.AGENTS.md` |
| `verify-published-imports.test.mjs` | Tests for `verify-published-imports.mjs`. Fixtures built i… → see `verify-published-imports.test.mjs.AGENTS.md` |
| `patch-vendor-specifiers.test.mjs` | Tests for `patch-vendor-specifiers.mjs` (E6: 4-specifier re… → see `patch-vendor-specifiers.test.mjs.AGENTS.md` |
| `root-packaging.test.mjs` | ci-level root tarball exclusion check (E14/E15). → see `root-packaging.test.mjs.AGENTS.md` |
| `release-lock.test.mjs` | Tests for release-lock rebase/audit/fetch/lint + post-bundle assertion (E1–E12, E18, E19, X1, X2). See change: pin-electron-bundle-dependency-tree. |
| `runtime-release.test.mjs` | Runtime release tests. → see `runtime-release.test.mjs.AGENTS.md` |
| `refresh-vendor.test.mjs` | Tests for `refresh-vendor.mjs` (X3: an unfaithful stubbed… → see `refresh-vendor.test.mjs.AGENTS.md` |
| `vendor-specifiers.test.mjs` | Tests for `check-vendor-specifiers.mjs` (E1/E2/X4: the patched tree passes non-vacuously;… → see `vendor-specifiers.test.mjs.AGENTS.md` |
| `verify-plugin-install-load.test.mjs` | Tests for `verify-plugin-install-load.mjs` (E8 scope filter always; |
| `verify-docker-plugin-load.test.mjs` | Tests for `verify-docker-plugin-load.mjs` (X12): harness-s… → see `verify-docker-plugin-load.test.mjs.AGENTS.md` |
| `vitest-workers.test.mjs` | Guard over the vitest worker consolidation (test-plan E15-… → see `vitest-workers.test.mjs.AGENTS.md` |
