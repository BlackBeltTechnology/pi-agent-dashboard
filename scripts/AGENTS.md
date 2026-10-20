# DOX — scripts

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `__tests__/anti-slop-suite-contract.test.mjs` | Static L1 contract over `packages/anti-slop` skill suite + dashboard adapter. → see `__tests__/anti-slop-suite-contract.test.mjs.AGENTS.md` |
| `__tests__/assert-bundled-plugins-complete.test.mjs` | Vitest unit tests for packages/electron/scripts/assert-bundled-plugins-complete.mjs (subprocess-driven with… → see `__tests__/assert-bundled-plugins-complete.test.mjs.AGENTS.md` |
| `__tests__/assert-bundled-server-plugin-load.test.mjs` | Tests for the bundled-server plugin-load gate: layout, verdicts, selected loader, all-plugins gate. → see `__tests__/assert-bundled-server-plugin-load.test.mjs.AGENTS.md` |
| `__tests__/check-kb-dist-fresh.test.mjs` | C1 (fix-kb-eval-measurement-integrity): fault-injection via `--pkg` sandbox — clean fingerprint → exit 0;… → see `__tests__/check-kb-dist-fresh.test.mjs.AGENTS.md` |
| `__tests__/check-pi-settings-paths.test.mjs` | Drives `absoluteSourceViolations` directly (12 cases) so detection is pinned independently of what… → see `__tests__/check-pi-settings-paths.test.mjs.AGENTS.md` |
| `__tests__/biome-undeclared-dependencies.test.mjs` | Guardrails for the `noUndeclaredDependencies` config in `biome.json`. → see `__tests__/biome-undeclared-dependencies.test.mjs.AGENTS.md` |
| `__tests__/claude-plugin-ensure-dashboard.test.mjs` | Behaviour tests for `ensure-dashboard.sh` (test-plan E3–E34, P1, X1–X10): real script vs temp HOME records, stub PATH, Node fixture servers. Timing via `PIDB_TEST_*`. |
| `__tests__/claude-plugin-publish-contract.test.mjs` | Static contract over `publish.yml`. `publish` preflight reads tagged `plugin.json` (`git show… → see `__tests__/claude-plugin-publish-contract.test.mjs.AGENTS.md` |
| `__tests__/claude-plugin-parity.test.mjs` | Derived `api-reference.md` byte parity (E35), missing-heading failure (E36), skill routes registered by the server (E38). |
| `__tests__/claude-plugin-structure.test.mjs` | Plugin layout + marketplace manifest (E1, E2), forbidden references (E37), skill content contract (E39). |
| `__tests__/claude-plugin-version.test.mjs` | `plugin.json` = root version (E40), `sync-versions.js` stamping idempotent (E41), `release-cut` stages + verifies it (E42). |
| `__tests__/claude-plugin-zip.test.mjs` | Release zip layout (E44) and version gate (E45) for `build-claude-plugin-zip.mjs`. |
| `__tests__/codeql-local-cli.test.mjs` | `codeql-local.mjs` end to end against a fake `CODEQL_BIN` + temp git repos (test-plan #E2-#E13, #E16, #E23,… → see `__tests__/codeql-local-cli.test.mjs.AGENTS.md` |
| `__tests__/codeql-local-real.test.mjs` | `codeql-local.mjs` against the REAL CodeQL CLI on tiny repos (#E4, #E18, #X6). → see `__tests__/codeql-local-real.test.mjs.AGENTS.md` |
| `__tests__/codeql-local.test.mjs` | Pure decision logic of `codeql-local.mjs` (#E14, #E15, #E17, #E19-#E22, #E24, #E29 writer, #P1). See change: add-local-codeql-ratchet. |
| `__tests__/coverage-config.test.mjs` | Coverage config shape; `coverage-unloaded` fixture stays unloaded (E29-E31). See change: triage-browser-e2e-offbox-poison. |
| `__tests__/coverage-report.test.mjs` | Live coverage runs; E2 scoped to `fixtures/coverage-unloaded`. See change: triage-browser-e2e-offbox-poison. |
| `__tests__/client-isolate-gate.test.mjs` | Client isolate gate. |
| `__tests__/e2e-fixture-import.test.mjs` | Guard tests for `check-e2e-fixture-import.mjs` (E6/E7, trust-write lint E21/E22). See change: triage-browser-e2e-offbox-poison. |
| `__tests__/e2e-reap-core.test.mjs` | L1 for `tests/e2e/reap-core.ts` (reap, refusal verdict, trust isolation E8-E18, X5-X16). See change: triage-browser-e2e-offbox-poison. |
| `__tests__/e2e-trust-seed.test.mjs` | Runs the `test-entrypoint.sh` config-seed program verbatim (E23-E25). See change: triage-browser-e2e-offbox-poison. |
| `__tests__/fixtures/coverage-unloaded/` | Fixture: one source file no test imports + no-op test + pinned config (scoped E2). See change: triage-browser-e2e-offbox-poison. |
| `__tests__/dependency-declarations.test.mjs` | Set-based manifest guarantees over ALL 32 non-private workspaces (not a sample). → see `__tests__/dependency-declarations.test.mjs.AGENTS.md` |
| `__tests__/fixtures/codeql-harness.mjs` | Test harness for `codeql-local.mjs`: temp git repos, per-call fake-binary plan, SARIF + baseline builders. See change: add-local-codeql-ratchet. |
| `__tests__/fixtures/coverage-failing/` | Red coverage fixture. |
| `__tests__/fixtures/fake-codeql.mjs` | Fake `codeql` (`CODEQL_BIN` seam). Plan from `$FAKE_CODEQL_PLAN`; logs argv, `LGTM_INDEX_FILTERS`,… → see `__tests__/fixtures/fake-codeql.mjs.AGENTS.md` |
| `__tests__/fixtures/mutation-journal-child.mjs` | Child-process fixture for the mutation-journal crash-safety tests. → see `__tests__/fixtures/mutation-journal-child.mjs.AGENTS.md` |
| `__tests__/fixtures/npm-view-stub.mjs` | Gate CLI npm-view stub. → see `__tests__/fixtures/npm-view-stub.mjs.AGENTS.md` |
| `__tests__/helpers/ensure-dashboard-harness.mjs` | `makeCtx()` sandbox for the bootstrap tests: temp HOME, logging stub executables, fixture/pid helpers, async `run()`. |
| `__tests__/helpers/fixture-dashboard-server.mjs` | Standalone fixture `/api/health` server (modes dashboard/wrong-pid/no-pid/recovery/foreign-html/hung); delayed bind, optional lock-meta write. |
| `__tests__/merge-latest-mac.test.mjs` | Covers test-plan U6 for `merge-latest-mac.py`: the `minimumSystemVersion` update gate survives the arm64 +… → see `__tests__/merge-latest-mac.test.mjs.AGENTS.md` |
| `__tests__/seed-settings-compaction.test.mjs` | Unit tests for the e2e-only `compaction.keepRecentTokens` seed (change: replay-compaction-boundary): merge… → see `__tests__/seed-settings-compaction.test.mjs.AGENTS.md` |
| `__tests__/nightly-report.test.mjs` | Nightly report (X9–X11). → see `__tests__/nightly-report.test.mjs.AGENTS.md` |
| `__tests__/shared-heavy-files.test.mjs` | Heavy shared groups. |
| `__tests__/select-affected-tests.test.mjs` | Selector layers (E1–E27). → see `__tests__/select-affected-tests.test.mjs.AGENTS.md` |
| `__tests__/select-affected-tests-cli.test.mjs` | Selector CLI (X2–X8). → see `__tests__/select-affected-tests-cli.test.mjs.AGENTS.md` |
| `__tests__/select-affected-tests-graph.test.mjs` | Real-tree graph build (X1, P1). → see `__tests__/select-affected-tests-graph.test.mjs.AGENTS.md` |
| `__tests__/test-selection-data.test.mjs` | Selection data contract (E29). → see `__tests__/test-selection-data.test.mjs.AGENTS.md` |
| `__tests__/fixed-tick-waits.test.mjs` | Guard tests + vitest wrapper for `check-fixed-tick-waits.mjs` (test-plan E10-E14, P3, X5): barrier detection… → see `__tests__/fixed-tick-waits.test.mjs.AGENTS.md` |
| `__tests__/jiti-cjs-transpile-safety.test.mjs` | Repo gate: jiti CJS transpile safety. → see `__tests__/jiti-cjs-transpile-safety.test.mjs.AGENTS.md` |
| `__tests__/loader-neutral-source.test.mjs` | Loader-neutral gate tests E23–E28 + repo HEAD clean. See change: fix-appimage-cold-boot-latency. |
| `__tests__/kb-packaging.test.mjs` | C2 (fix-kb-eval-measurement-integrity, ci-level behind RUN_CI_SCENARIOS=1): `npm pack --dry-run` of… → see `__tests__/kb-packaging.test.mjs.AGENTS.md` |
| `__tests__/knip-config.test.mjs` | Entry-point rooting for the dead-code oracle (test-plan #G1, #G2, #G4, #D1, #P2). → see `__tests__/knip-config.test.mjs.AGENTS.md` |
| `__tests__/knip-harness.test.mjs` | Docker-harness reproducibility for the dead-code oracle (test-plan #H1). → see `__tests__/knip-harness.test.mjs.AGENTS.md` |
| `__tests__/lint-harness-scoping.test.mjs` | Guards that repo-wide lint harnesses judge git-tracked SOURCE, not local-only working-tree state. → see `__tests__/lint-harness-scoping.test.mjs.AGENTS.md` |
| `__tests__/knip-ratchet.test.mjs` | Per-class dead-code ratchet (test-plan #R1-#R6). Load-bearing case is #R2: a scalar total lets one deleted… → see `__tests__/knip-ratchet.test.mjs.AGENTS.md` |
| `__tests__/tsc7-wrapper.test.mjs` | E1–E6, E8, E9, E11, X4: wrapper runs TS 7 from any cwd, forwards exit code, alias-missing message, no bare… → see `__tests__/tsc7-wrapper.test.mjs.AGENTS.md` |
| `__tests__/z-layer-lint.test.mjs` | Overlay z-index ratchet tests (test-plan #E4/#E5): `extractRawZ` matches raw numeric z but not word… → see `__tests__/z-layer-lint.test.mjs.AGENTS.md` |
| `__tests__/knip-scan.test.mjs` | Live whole-workspace Knip scan assertions (test-plan #G3, #G5, #G6, #D2, #D3, #P1). → see `__tests__/knip-scan.test.mjs.AGENTS.md` |
| `__tests__/mutation-journal.test.mjs` | Vitest crash-safety tests for the mutation-harness journal (test-plan #E1-#E8, #X1-#X13). → see `__tests__/mutation-journal.test.mjs.AGENTS.md` |
| `__tests__/nightly-verdaccio-publish.test.mjs` | Vitest unit tests for scripts/nightly-verdaccio-publish.mjs pure helpers: nextPatch (0.6.1→0.6.2, ignores… → see `__tests__/nightly-verdaccio-publish.test.mjs.AGENTS.md` |
| `__tests__/qa-smoke-guards.test.mjs` | Fault-injects the clean-prefix QA smoke (`qa/tests/35-plugin-install-load.sh`) by stubbing… → see `__tests__/qa-smoke-guards.test.mjs.AGENTS.md` |
| `__tests__/prune-memory-backups.test.mjs` | Pins `planPrune` selection + `prune` IO for the hermes store trim. → see `__tests__/prune-memory-backups.test.mjs.AGENTS.md` |
| `__tests__/rebuild-scripts-gate.test.mjs` | X5 fault injection: both `rebuild-restart.sh` and `rebuild-and-restart.sh` run the served-client gate between… → see `__tests__/rebuild-scripts-gate.test.mjs.AGENTS.md` |
| `__tests__/repair-meta-source.test.mjs` | Vitest unit tests for repair-meta-source.mjs. Asserts source:"dashboard" → cleaned (other fields preserved),… → see `__tests__/repair-meta-source.test.mjs.AGENTS.md` |
| `__tests__/review-changes-parser.test.mjs` | Vitest unit tests for parseFindings + splitFindings (.pi/skills/implement/scripts/parse-findings.ts). → see `__tests__/review-changes-parser.test.mjs.AGENTS.md` |
| `__tests__/settings-kit-guard.test.mjs` | Settings-kit ratchet tests: per-kind counts + negatives (#E33), exempt `ServerEditor.tsx`, closure, `main`… → see `__tests__/settings-kit-guard.test.mjs.AGENTS.md` |
| `__tests__/severity-literal-guard.test.mjs` | Static guard: no raw `red-<NN(N)>` Tailwind literal (2- or 3-digit shade, so `red-50` is caught too) in the… → see `__tests__/severity-literal-guard.test.mjs.AGENTS.md` |
| `__tests__/ship-it-manifest.test.mjs` | Vitest unit tests for ship-it `manifest.ts` (`.pi/skills/ship-it/scripts/`). → see `__tests__/ship-it-manifest.test.mjs.AGENTS.md` |
| `__tests__/ship-it-no-weakening.test.mjs` | Vitest unit tests for ship-it `no-weakening.ts` assertNoWeakening. → see `__tests__/ship-it-no-weakening.test.mjs.AGENTS.md` |
| `__tests__/skill-frontmatter.test.mjs` | Vitest guard over every repo `**/SKILL.md` (skips node_modules/dist/worktrees). → see `__tests__/skill-frontmatter.test.mjs.AGENTS.md` |
| `__tests__/spec-collateral.test.mjs` | L1 for `spec-collateral.mjs` (E1–E26, P1–P2, X1–X5). → see `__tests__/spec-collateral.test.mjs.AGENTS.md` |
| `__tests__/sync-served-client.test.mjs` | E15/E16/X3/X4: the `sync-served-client.mjs` outcome table over temp dirs — no-op (dest == source, source must… → see `__tests__/sync-served-client.test.mjs.AGENTS.md` |
| `__tests__/verify-release-deps-client-build-deps.test.mjs` | Vitest tests for the E7 client build-dep rules in verify-release-deps.mjs. → see `__tests__/verify-release-deps-client-build-deps.test.mjs.AGENTS.md` |
| `__tests__/theme-token-guard.test.mjs` | Scan/ratchet/bootstrap tests for all three guard arms. → see `__tests__/theme-token-guard.test.mjs.AGENTS.md` |
| `__tests__/harness-audit-armed.test.mjs` | Armed rule + max lifetime + unscoped mode of project-scoped `docker/harness-audit.sh` (stub docker, injected poll/max). See change: add-missing-ci-legs. |
| `__tests__/harness-recorder-helpers.mjs` | Shared docker stub + sandbox for the harness recorder tests (not a test file). See change: add-missing-ci-legs. |
| `__tests__/site-drift-decision.test.mjs` | E21–E23/X7–X9: drift decision table, marker boundaries, LAST path set, fetch/`gh` faults (git fixture repos + stub `curl`/`gh`). See change: add-missing-ci-legs. |
| `__tests__/test-down-recorder.test.mjs` | `test-down.sh` teardown marker, ≤10 s destroy wait, dead/absent recorder (stub docker). See change: add-missing-ci-legs. |
| `__tests__/test-up-recorder.test.mjs` | `test-up.sh` lifecycle recorder: state fields, events path, ordering, re-up idempotence, best-effort faults. See change: add-missing-ci-legs. |
| `__tests__/test-up-oversubscribe-guard.test.mjs` | Vitest tests for the co-resident harness oversubscription guard (change: stabilize-browser-e2e, #451 part 2)… → see `__tests__/test-up-oversubscribe-guard.test.mjs.AGENTS.md` |
| `__tests__/test-up-port-derivation.test.mjs` | Vitest tests for parallel-worktree test-harness port/project derivation. → see `__tests__/test-up-port-derivation.test.mjs.AGENTS.md` |
| `_windows-introspection-probe.ts` | Probe child for Windows introspection smoke. Imports real `isVirtualMachine` + `defaultGetCmdline` (relative… → see `_windows-introspection-probe.ts.AGENTS.md` |
| `assert-bundled-plugins-published.mjs` | Gate #X17. → see `assert-bundled-plugins-published.mjs.AGENTS.md` |
| `assert-runtime-release.mjs` | Release shape check #X16. → see `assert-runtime-release.mjs.AGENTS.md` |
| `build-claude-plugin-zip.mjs` | Zips `packages/claude-plugin/` (manifest at zip root) to `pi-dashboard-claude-plugin-<v>.zip`; fails when… → see `build-claude-plugin-zip.mjs.AGENTS.md` |
| `build.sh` | Type-check + build dashboard. Flags: --check-only (tsc --noEmit only), --client-only (Vite build only). Auto-runs npm install if node_modules absent. |
| `build-runtime-asset.mjs` | Per-platform runtime asset. → see `build-runtime-asset.mjs.AGENTS.md` |
| `__tests__/verify-published-imports.test.mjs` | Tests for `verify-published-imports.mjs`. Fixtures built in `mkdtemp` OUTSIDE the repo and the checker driven… → see `__tests__/verify-published-imports.test.mjs.AGENTS.md` |
| `__tests__/patch-vendor-specifiers.test.mjs` | Tests for `patch-vendor-specifiers.mjs` (E6: 4-specifier rewrite, byte-identical tree across run counts… → see `__tests__/patch-vendor-specifiers.test.mjs.AGENTS.md` |
| `__tests__/root-packaging.test.mjs` | ci-level root tarball exclusion check (E14/E15). → see `__tests__/root-packaging.test.mjs.AGENTS.md` |
| `__tests__/runtime-release.test.mjs` | Runtime release tests. → see `__tests__/runtime-release.test.mjs.AGENTS.md` |
| `__tests__/refresh-vendor.test.mjs` | Tests for `refresh-vendor.mjs` (X3: an unfaithful stubbed fetch aborts before patching with tree + manifest… → see `__tests__/refresh-vendor.test.mjs.AGENTS.md` |
| `__tests__/vendor-specifiers.test.mjs` | Tests for `check-vendor-specifiers.mjs` (E1/E2/X4: the patched tree passes non-vacuously;… → see `__tests__/vendor-specifiers.test.mjs.AGENTS.md` |
| `__tests__/verify-plugin-install-load.test.mjs` | Tests for `verify-plugin-install-load.mjs` (E8 scope filter always; X1/X2/X6 pack→install→import opt-in via `RUN_INSTALL_LOAD=1`). See change: fix-browser-plugin-vendor-specifier-resolution. |
| `__tests__/verify-docker-plugin-load.test.mjs` | Tests for `verify-docker-plugin-load.mjs` (X12): harness-state parsing, the load verdict (missing success… → see `__tests__/verify-docker-plugin-load.test.mjs.AGENTS.md` |
| `__tests__/vitest-workers.test.mjs` | Guard over the vitest worker consolidation (test-plan E15-E17, P1): no config restates the parallel target as… → see `__tests__/vitest-workers.test.mjs.AGENTS.md` |
| `check-conventions.mjs` | Deterministic half of the ship gate, run by `ship-it` step 4.4. → see `check-conventions.mjs.AGENTS.md` |
| `check-e2e-fixture-import.mjs` | Guard: every `tests/e2e/*.spec.ts` MUST import `test` from `./fixtures.js`, never `@playwright/test` directly… → see `check-e2e-fixture-import.mjs.AGENTS.md` |
| `check-fixed-tick-waits.mjs` | Fixed-tick wait guard, run by ci.yml (standalone step) + ship gate. → see `check-fixed-tick-waits.mjs.AGENTS.md` |
| `check-kb-dist-fresh.mjs` | CI gate (ci.yml, ship-it 4.4-adjacent): recomputes kb srcHash+tsconfigHash vs the committed… → see `check-kb-dist-fresh.mjs.AGENTS.md` |
| `check-loader-neutral-source.mjs` | Loader-neutral source gate (AST; server scope). → see `check-loader-neutral-source.mjs.AGENTS.md` |
| `check-pi-settings-paths.mjs` | Guard, run by ci.yml: no machine-specific absolute path in a committed `.pi/settings.json`… → see `check-pi-settings-paths.mjs.AGENTS.md` |
| `check-skill-frontmatter.mjs` | Skill frontmatter guard, run by ci.yml. Exit non-zero iff >=1 error; warnings never fail. → see `check-skill-frontmatter.mjs.AGENTS.md` |
| `check-vendor-specifiers.mjs` | Static specifier guard for the vendored relay: every import under `relay/vendor/` must be a builtin, a declared dep, or relative. → see `check-vendor-specifiers.mjs.AGENTS.md` |
| `codeql-local.mjs` | Local CodeQL ratchet for `ship-it` steps 4.4/4.4b: snapshot → analyse → per-alert baseline ratchet (`codeql-baseline.json`). → see `codeql-local.mjs.AGENTS.md` |
| `commit-windows-parity.sh` | Stages and commits fix-windows-server-parity + consolidate-platform-handlers work in 5 logical chunks (fix:,… → see `commit-windows-parity.sh.AGENTS.md` |
| `dox-byte-gate.mjs` | AGENTS.md byte-cap gate for `ship-it` step 4.4. Filters `kb dox lint --json` to `kind:"over-threshold"` +… → see `dox-byte-gate.mjs.AGENTS.md` |
| `fix-pty-permissions.cjs` | Postinstall: fix node-pty spawn-helper execute permissions |
| `generate-plugin-registry.mjs` | Standalone generator for packages/client/src/generated/plugin-registry.tsx (gitignored). → see `generate-plugin-registry.mjs.AGENTS.md` |
| `generate-runtime-lock.mjs` | Server lock gen. → see `generate-runtime-lock.mjs.AGENTS.md` |
| `i18n-lint.mjs` | Hardcoded-UI-string lint. → see `i18n-lint.mjs.AGENTS.md` |
| `i18n-parity.mjs` | Catalog parity gate: every key in the union of zh-CN (`i18n-zh-CN.ts`) + hu + plugin catalogs exists in each. → see `i18n-parity.mjs.AGENTS.md` |
| `rebuild-and-restart.sh` | Build → verify served client → `pi-dashboard restart` → `npm run reload`. → see `rebuild-and-restart.sh.AGENTS.md` |
| `rebuild-restart.sh` | Build (+ optional `--check` tsc) → verify served client (`node scripts/sync-served-client.mjs`) →… → see `rebuild-restart.sh.AGENTS.md` |
| `refresh-vendor.mjs` | Owns the vendored-relay refresh: copy → verify upstream (in memory, before any write) → patch → rehash. → see `refresh-vendor.mjs.AGENTS.md` |
| `site-drift-decision.mjs` | Decision script of `.github/workflows/site-drift-check.yml`: live `deploy-sha.txt` vs last site-relevant… → see `site-drift-decision.mjs.AGENTS.md` |
| `sync-claude-plugin.mjs` | Derives the control skill's `references/api-reference.md` from the extension skill's (drops the bus-verbs… → see `sync-claude-plugin.mjs.AGENTS.md` |
| `sync-served-client.mjs` | Resolves the served destination via the SERVER's `resolveStaticClientDir` (jiti) and mirrors the fresh… → see `sync-served-client.mjs.AGENTS.md` |
| `heap-probe.mjs` | CDP heap probe for a RUNNING dashboard: `SIGUSR1`s the pid (from `--pid` or `/api/health`), attaches to… → see `heap-probe.mjs.AGENTS.md` |
| `lib-jiti-scope.mjs` | Discovery rule + AST detector behind the `jiti-cjs-transpile-safety` gate. Scope is a DERIVED RULE… → see `lib-jiti-scope.mjs.AGENTS.md` |
| `lib/kb-engine-fingerprint.mjs` | Repo-facing re-export of `packages/kb/bin/lib/engine-fingerprint.mjs` (the ONE implementation — shipped via… → see `lib/kb-engine-fingerprint.mjs.AGENTS.md` |
| `lib/runtime-release.mjs` | Runtime release shared helpers. → see `lib/runtime-release.mjs.AGENTS.md` |
| `lib/smoke-spawn-session.mjs` | Test helper: connects dashboard browser WS (`/ws`), sends spawn_session for cwd, waits for… → see `lib/smoke-spawn-session.mjs.AGENTS.md` |
| `knip-config.mjs` | Derives Knip entry points from the project's own manifest conventions and fails when `knip.json` does not… → see `knip-config.mjs.AGENTS.md` |
| `knip-ratchet.mjs` | Per-class dead-code ratchet for `ship-it` step 4.4 and the nightly job. → see `knip-ratchet.mjs.AGENTS.md` |
| `tsc7.mjs` | Single wrapper for the TypeScript 7 compiler (`typescript-7` = npm alias of `typescript@7.0.2`). → see `tsc7.mjs.AGENTS.md` |
| `windows-forbidden-subjects-smoke.ts` | Windows-only smoke (`_smoke.yml` Windows leg): `forbiddenGrantSubjects()` lists host `%SystemRoot%`, no… → see `windows-forbidden-subjects-smoke.ts.AGENTS.md` |
| `z-layer-lint.mjs` | Overlay z-index ratchet (spec overlay-layering). Freezes raw numeric `z-[NNNN]`/`z-<n>` in… → see `z-layer-lint.mjs.AGENTS.md` |
| `z-layer-baseline.json` | Frozen baseline for `z-layer-lint.mjs` — the current raw-z occurrences (Tier-B inline popovers +… → see `z-layer-baseline.json.AGENTS.md` |
| `maybe-patch-package.cjs` | postinstall guard: runs patch-package only when module resolvable + patches/ dir exists. → see `maybe-patch-package.cjs.AGENTS.md` |
| `merge-latest-mac.py` | Merges the arm64 + x64 `latest-mac.yml` update-metadata legs into one file (softprops dedups release assets… → see `merge-latest-mac.py.AGENTS.md` |
| `measure-replay-compaction.mjs` | Measures the `compact-warm-replay-stream` (#399) win: events / bytes / batches / wall time, before vs after… → see `measure-replay-compaction.mjs.AGENTS.md` |
| `migrate-child-process-imports.sh` | One-shot sed migration: rewrites `from "node:child_process"` to platform/exec wrapper. → see `migrate-child-process-imports.sh.AGENTS.md` |
| `mutation-harness.mjs` | Manifest-driven mutation runner for the promise-rule ladder: breaks a covered behaviour in a real source file… → see `mutation-harness.mjs.AGENTS.md` |
| `mutation-journal-global-setup.mjs` | Root-level vitest `globalSetup` (registered in the ROOT `vitest.config.ts`) that reconciles mutation-harness… → see `mutation-journal-global-setup.mjs.AGENTS.md` |
| `nightly-verdaccio-publish.mjs` | Nightly Verdaccio publish: bump every non-private workspace + root to `<base>-nightly.<YYYYMMDD>.<sha7>` (or… → see `nightly-verdaccio-publish.mjs.AGENTS.md` |
| `nightly-verdaccio-serve.mjs` | Start an ephemeral Verdaccio as a detached background service (spawn detached+unref+stdio:ignore — cross-OS,… → see `nightly-verdaccio-serve.mjs.AGENTS.md` |
| `probe-harness-memory.mjs` | Out-of-band harness memory probe (host side): `docker exec` reads cgroup v2 `memory.*` + `pids.current` and… → see `probe-harness-memory.mjs.AGENTS.md` |
| `prune-memory-backups.mjs` | Recurring maintenance: trims `~/.pi/agent/pi-hermes-memory/`. Deletes all `sessions.db.corrupt-*` (incl. → see `prune-memory-backups.mjs.AGENTS.md` |
| `prune-orphan-worktrees.ts` | One-shot: `rm -rf` orphan `.worktrees/*` husk dirs (on disk, absent from `git worktree list`) left by kb DB… → see `prune-orphan-worktrees.ts.AGENTS.md` |
| `patch-vendor-specifiers.mjs` | Rewrites the vendored relay's playwright-internal specifiers to package-relative `shims/*.js` paths + §4(b) notice; idempotent, fail-closed. → see `patch-vendor-specifiers.mjs.AGENTS.md` |
| `reload-all.sh` | Build bridge + reload all pi sessions Inline per-request proof mint (byte-identical to shared `mintProof`,… → see `reload-all.sh.AGENTS.md` |
| `repair-main-specs.mjs` | Structural repair of corrupted `openspec/specs/**/spec.md`. → see `repair-main-specs.mjs.AGENTS.md` |
| `repair-meta-source.mjs` | Removes `source: "dashboard"` from every `~/.pi/agent/sessions/**/*.meta.json`. Atomic tmp+rename. → see `repair-meta-source.mjs.AGENTS.md` |
| `runtime-e2e-registry.mjs` | E2E registry fixture. → see `runtime-e2e-registry.mjs.AGENTS.md` |
| `seed-sessions-window.mjs` | E2E-only seed: writes >120 ended session `.meta.json`/`.jsonl` records across dummy dirs plus one… → see `seed-sessions-window.mjs.AGENTS.md` |
| `seed-settings-compaction.mjs` | E2E-only seed: writes `compaction.keepRecentTokens` (default 1) into pi `settings.json` so a manual… → see `seed-settings-compaction.mjs.AGENTS.md` |
| `seed-settings-default-model.mjs` | Seeds pi `settings.json` with SPLIT `defaultProvider`+`defaultModel` so faux is the startup default (pi 0.84… → see `seed-settings-default-model.mjs.AGENTS.md` |
| `select-affected-tests.mjs` | Affected-test selector CLI. → see `select-affected-tests.mjs.AGENTS.md` |
| `test-selection/` | Selector modules + data. → see `test-selection/AGENTS.md` |
| `settings-kit-baseline.json` | Shrink-only baseline for `settings-kit-guard.mjs`: `{counts}` map `<file>::<kind>` → count. → see `settings-kit-baseline.json.AGENTS.md` |
| `settings-kit-guard.mjs` | Settings-kit ratchet (design D7): scans every `.tsx` under each `settings-section` claim dir… → see `settings-kit-guard.mjs.AGENTS.md` |
| `spec-collateral.mjs` | Advisory OpenSpec post-archive contradiction scan; exit 0/2, never 1. → see `spec-collateral.mjs.AGENTS.md` |
| `split-large-agents.mjs` | One-off Node script. Splits over-large directory `AGENTS.md` file-based. → see `split-large-agents.mjs.AGENTS.md` |
| `stop-dashboard.sh` | Stops pi-dashboard server. Reads port from ~/.pi/dashboard/config.json (default 8000); lsof -ti :PORT; SIGTERM, SIGKILL fallback after 5s. |
| `sync-versions-spec.js` | Pure helper extracted from sync-versions.js for unit tests. → see `sync-versions-spec.js.AGENTS.md` |
| `sync-versions.js` | Post-bump release helper. Reads every workspace `package.json`, enforces lockstep versions, rewrites every… → see `sync-versions.js.AGENTS.md` |
| `test-standalone-npm-install-docker.sh` | Docker smoke: packs workspaces + root, launches clean Linux container (default node:24-bookworm-slim),… → see `test-standalone-npm-install-docker.sh.AGENTS.md` |
| `test-standalone-npm-install.ps1` | Windows port of standalone-npm-install smoke. Packs workspaces, installs into isolated temp HOME, spawns… → see `test-standalone-npm-install.ps1.AGENTS.md` |
| `test-standalone-npm-install.sh` | Bash standalone-install smoke: packs workspaces, installs tarballs into isolated temp HOME, spawns… → see `test-standalone-npm-install.sh.AGENTS.md` |
| `theme-token-baseline.json` | Shrink-only baseline for `theme-token-guard.mjs`: `{fallback,undeclared,accentText}` maps. → see `theme-token-baseline.json.AGENTS.md` |
| `theme-token-guard.mjs` | Three-arm theme-token ratchet: fallback-form, undeclared colour token, accent-as-text. → see `theme-token-guard.mjs.AGENTS.md` |
| `verify-published-imports.mjs` | Publish-correctness checker, run by ci.yml. For every non-private `packages/*`, asserts every module… → see `verify-published-imports.mjs.AGENTS.md` |
| `verify-plugin-install-load.mjs` | Dynamic install-load check: pack → install OUTSIDE the repo → import the server entry under plain node+jiti,… → see `verify-plugin-install-load.mjs.AGENTS.md` |
| `verify-docker-plugin-load.mjs` | Required Docker gate (X12): boot the image and assert the browser plugin loaded, with no alias crutch. → see `verify-docker-plugin-load.mjs.AGENTS.md` |
| `verify-lockfile-versions.mjs` | Sanity gate after `pnpm install --lockfile-only` in `publish.yml` (`tag-and-push`) + `_electron-build.yml`. → see `verify-lockfile-versions.mjs.AGENTS.md` |
| `verify-release-deps.mjs` | Pre-release dependency-shape gate. RULES assert server declares jiti, node-pty (>=1.2.0-beta.13),… → see `verify-release-deps.mjs.AGENTS.md` |
| `vitest.config.ts` | Vitest config for repo-root /scripts project. Includes scripts/__tests__/**/*.test.mjs, node env, forks pool,… → see `vitest.config.ts.AGENTS.md` |
| `windows-liveness-smoke.ts` | Windows boot-parent-liveness smoke (CI: `_smoke.yml` standalone-install-smoke-windows). → see `windows-liveness-smoke.ts.AGENTS.md` |
| `windows-introspection-smoke.ts` | Windows introspection smoke driver (CI: `_smoke.yml` standalone-install-smoke-windows). → see `windows-introspection-smoke.ts.AGENTS.md` |
