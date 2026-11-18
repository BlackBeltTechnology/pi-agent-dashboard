# DOX — scripts

Files in this directory. One row per file. Non-source area (migrated from `docs/file-index-skills-misc.md`; source of truth now here). See change: migrate-file-index-to-agents-tree.

| File | Purpose |
|------|---------|
| `__tests__/` | Script tests. Per-file rows → see `__tests__/AGENTS.md` |
| `_windows-introspection-probe.ts` | Probe child for Windows introspection smoke. Imports real… → see `_windows-introspection-probe.ts.AGENTS.md` |
| `assert-bundled-plugins-published.mjs` | Gate #X17. → see `assert-bundled-plugins-published.mjs.AGENTS.md` |
| `assert-runtime-release.mjs` | Release shape check #X16. → see `assert-runtime-release.mjs.AGENTS.md` |
| `build-runtime-canary.mjs` | Builds the runtime canary fixture + variants with the SDK preset. → see `build-runtime-canary.mjs.AGENTS.md` |
| `build-claude-plugin-zip.mjs` | Zips `packages/claude-plugin/` (manifest at zip root) to `pi-dashboard-claude-plugin-<v>.zip`; fails when… → see `build-claude-plugin-zip.mjs.AGENTS.md` |
| `build.sh` | Type-check + build dashboard. Flags: --check-only (tsc --noEmit only), --client-only (Vite build only). Auto-runs npm install if node_modules absent. |
| `build-runtime-asset.mjs` | Per-platform runtime asset. → see `build-runtime-asset.mjs.AGENTS.md` |
| `check-advisory-triage.mjs` | → `check-advisory-triage.mjs.AGENTS.md` |
| `check-client-sinks.mjs` | Client sink guard. → see `check-client-sinks.mjs.AGENTS.md` |
| `check-conventions.mjs` | Deterministic half of the ship gate, run by `ship-it` step 4.4. → see `check-conventions.mjs.AGENTS.md` |
| `check-e2e-fixture-import.mjs` | Guard: every `tests/e2e/*.spec.ts` MUST import `test` from `./fixtures.js`, never `@playwright/test` directly… → see `check-e2e-fixture-import.mjs.AGENTS.md` |
| `check-fixed-tick-waits.mjs` | Fixed-tick wait guard, run by ci.yml (standalone step) + ship gate. → see `check-fixed-tick-waits.mjs.AGENTS.md` |
| `check-kb-dist-fresh.mjs` | CI gate (ci.yml, ship-it 4.4-adjacent): recomputes kb srcHash+tsconfigHash vs the committed… → see `check-kb-dist-fresh.mjs.AGENTS.md` |
| `check-loader-neutral-source.mjs` | Loader-neutral source gate (AST; server scope). → see `check-loader-neutral-source.mjs.AGENTS.md` |
| `check-mockups.mjs` | → `check-mockups.mjs.AGENTS.md` |
| `check-pi-settings-paths.mjs` | Guard, run by ci.yml: no machine-specific absolute path in a committed `.pi/settings.json`… → see `check-pi-settings-paths.mjs.AGENTS.md` |
| `check-plugin-boundary.mjs` | Core/plugin import ratchet for `ship-it` step 4.4 + `npm run check:plugin-boundary`: NEW edge / STALE row… → see `check-plugin-boundary.mjs.AGENTS.md` |
| `codeql-anchor/plugin-routes.mjs` | → `codeql-anchor/plugin-routes.mjs.AGENTS.md` |
| `e2e-csp-lane-check.mjs` | CSP E2E lane zero-skip check. → see `e2e-csp-lane-check.mjs.AGENTS.md` |
| `host-api-surface.mjs` | Host API surface snapshot + bump gate. `--write` regenerates… → see `host-api-surface.mjs.AGENTS.md` |
| `check-skill-frontmatter.mjs` | Skill frontmatter guard, run by ci.yml. Exit non-zero iff >=1 error; warnings never fail. → see `check-skill-frontmatter.mjs.AGENTS.md` |
| `check-vendor-specifiers.mjs` | Static specifier guard for the vendored relay: every import under `relay/vendor/` mus… → see `check-vendor-specifiers.mjs.AGENTS.md` |
| `codeql-local.mjs` | Local CodeQL ratchet for `ship-it` steps 4.4/4.4b: snapshot → analyse → per-alert baseline ratchet (`codeql-baseline.json`). → see `codeql-local.mjs.AGENTS.md` |
| `commit-windows-parity.sh` | Stages and commits fix-windows-server-parity + consolidate-platform-handlers work in 5 logical chunks (fix:,… → see `commit-windows-parity.sh.AGENTS.md` |
| `discord-release-announce.mjs` | Full release notes → Discord webhook. → see `discord-release-announce.mjs.AGENTS.md` |
| `dox-byte-gate.mjs` | AGENTS.md byte-cap gate for `ship-it` step 4.4. Filters `kb dox lint --json` to `kind:"over-threshold"` +… → see `dox-byte-gate.mjs.AGENTS.md` |
| `fix-pty-permissions.cjs` | Postinstall: fix node-pty spawn-helper execute permissions |
| `generate-plugin-registry.mjs` | Standalone generator for packages/client/src/generated/plug… → see `generate-plugin-registry.mjs.AGENTS.md` |
| `generate-runtime-lock.mjs` | Server lock gen. → see `generate-runtime-lock.mjs.AGENTS.md` |
| `lint-runtime-lock.mjs` | `--version X [--lock F]`: runs the bundle's `rebaseRuntimeLock` over the generated lock as a check; non-zero… → see `lint-runtime-lock.mjs.AGENTS.md` |
| `i18n-lint.mjs` | Hardcoded-UI-string lint. → see `i18n-lint.mjs.AGENTS.md` |
| `i18n-parity.mjs` | Catalog parity gate: every key in the union of zh-CN (`i18n-zh-CN.ts`) + hu + plugin catalogs exists in each. → see `i18n-parity.mjs.AGENTS.md` |
| `rebuild-and-restart.sh` | Build → verify served client → `pi-dashboard restart` → `npm run reload`. → see `rebuild-and-restart.sh.AGENTS.md` |
| `rebuild-restart.sh` | Build (+ optional `--check` tsc) → verify served client (`node scripts/sync-served-client.mjs`) →… → see `rebuild-restart.sh.AGENTS.md` |
| `refresh-vendor.mjs` | Owns the vendored-relay refresh: copy → verify upstream (in memory, before any write) → patch → rehash. → see `refresh-vendor.mjs.AGENTS.md` |
| `site-drift-decision.mjs` | Decision script of `.github/workflows/site-drift-check.yml`: live `deploy-sha.txt` vs last site-relevant… → see `site-drift-decision.mjs.AGENTS.md` |
| `stage-runtime-canary.mjs` | Stages runtime canary for the harness. → see `stage-runtime-canary.mjs.AGENTS.md` |
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
| `windows-forbidden-subjects-smoke.ts` | Windows-only smoke (`_smoke.yml` Windows leg): `forbiddenG… → see `windows-forbidden-subjects-smoke.ts.AGENTS.md` |
| `z-layer-lint.mjs` | Overlay z-index ratchet (spec overlay-layering). Freezes raw numeric `z-[NNNN]`/`z-<n>` in… → see `z-layer-lint.mjs.AGENTS.md` |
| `z-layer-baseline.json` | Frozen baseline for `z-layer-lint.mjs` — the current raw-z occurrences (Tier-B inline popovers +… → see `z-layer-baseline.json.AGENTS.md` |
| `maybe-patch-package.cjs` | postinstall guard: runs patch-package only when module resolvable + patches/ dir exists. → see `maybe-patch-package.cjs.AGENTS.md` |
| `merge-latest-mac.py` | Merges the arm64 + x64 `latest-mac.yml` update-metadata legs into one file (softprops dedups release assets… → see `merge-latest-mac.py.AGENTS.md` |
| `measure-replay-compaction.mjs` | Measures the `compact-warm-replay-stream` (#399) win: events / bytes / batches / wall time, before vs after… → see `measure-replay-compaction.mjs.AGENTS.md` |
| `migrate-child-process-imports.sh` | One-shot sed migration: rewrites `from "node:child_process"` to platform/exec wrapper. → see `migrate-child-process-imports.sh.AGENTS.md` |
| `mutation-harness.mjs` | Manifest-driven mutation runner for the promise-rule ladder: breaks a covered behaviour in a real source file… → see `mutation-harness.mjs.AGENTS.md` |
| `mutation-journal-global-setup.mjs` | Root-level vitest `globalSetup` (registered in the ROOT `v… → see `mutation-journal-global-setup.mjs.AGENTS.md` |
| `nightly-verdaccio-publish.mjs` | Nightly Verdaccio publish: bump every non-private workspace + root t… → see `nightly-verdaccio-publish.mjs.AGENTS.md` |
| `nightly-verdaccio-serve.mjs` | Start an ephemeral Verdaccio as a detached background service (spawn detached+unref+stdio:ignore — cross-OS,… → see `nightly-verdaccio-serve.mjs.AGENTS.md` |
| `plugin-boundary-allowlist.json` | Ratcheting `(from, to)` baseline for `check-plugin-boundary.mjs`: 76 seed rows, each… → see `plugin-boundary-allowlist.json.AGENTS.md` |
| `probe-harness-memory.mjs` | Out-of-band harness memory probe (host side): `docker exec` reads cgroup v2 `memory.*` + `pids.current` and… → see `probe-harness-memory.mjs.AGENTS.md` |
| `prune-memory-backups.mjs` | Recurring maintenance: trims `~/.pi/agent/pi-hermes-memory/`. Deletes all `sessions.db.corrupt-*` (incl. → see `prune-memory-backups.mjs.AGENTS.md` |
| `prune-orphan-worktrees.ts` | One-shot: `rm -rf` orphan `.worktrees/*` husk dirs (on disk, absent from `git worktree list`) left by kb DB… → see `prune-orphan-worktrees.ts.AGENTS.md` |
| `patch-vendor-specifiers.mjs` | Rewrites the vendored relay's playwright-internal specifiers to package-relative `shi… → see `patch-vendor-specifiers.mjs.AGENTS.md` |
| `reload-all.sh` | Build bridge + reload all pi sessions Inline per-request proof mint (byte-identical to shared `mintProof`,… → see `reload-all.sh.AGENTS.md` |
| `repair-main-specs.mjs` | Structural repair of corrupted `openspec/specs/**/spec.md`. → see `repair-main-specs.mjs.AGENTS.md` |
| `repair-meta-source.mjs` | Removes `source: "dashboard"` from every `~/.pi/agent/sessions/**/*.meta.json`. Atomic tmp+rename. → see `repair-meta-source.mjs.AGENTS.md` |
| `runtime-e2e-registry.mjs` | E2E registry fixture. → see `runtime-e2e-registry.mjs.AGENTS.md` |
| `seed-sessions-window.mjs` | E2E-only seed: writes >120 ended session `.meta.json`/`.jsonl` records across dummy dirs plus one… → see `seed-sessions-window.mjs.AGENTS.md` |
| `seed-settings-compaction.mjs` | E2E-only seed: writes `compaction.keepRecentTokens` (default 1) into pi `settings.json` so a manual… → see `seed-settings-compaction.mjs.AGENTS.md` |
| `seed-settings-default-model.mjs` | Seeds pi `settings.json` with SPLIT `defaultProvider`+`def… → see `seed-settings-default-model.mjs.AGENTS.md` |
| `select-affected-tests.mjs` | Affected-test selector CLI. → see `select-affected-tests.mjs.AGENTS.md` |
| `test-selection/` | Selector modules + data. → see `test-selection/AGENTS.md` |
| `settings-kit-baseline.json` | Shrink-only baseline for `settings-kit-guard.mjs`: `{counts}` map `<file>::<kind>` → count. → see `settings-kit-baseline.json.AGENTS.md` |
| `settings-kit-guard.mjs` | Settings-kit ratchet (design D7): scans every `.tsx` under each `settings-section` claim dir… → see `settings-kit-guard.mjs.AGENTS.md` |
| `spec-collateral.mjs` | Advisory OpenSpec post-archive contradiction scan; exit 0/2, never 1. → see `spec-collateral.mjs.AGENTS.md` |
| `split-large-agents.mjs` | One-off Node script. Splits over-large directory `AGENTS.md` file-based. → see `split-large-agents.mjs.AGENTS.md` |
| `stop-dashboard.sh` | Stops pi-dashboard server. Reads port from ~/.pi/dashboard/config.json (default 8000); lsof -ti :PORT; SIGTERM, SIGKILL fallback after 5s. |
| `sync-versions-spec.js` | Pure helper extracted from sync-versions.js for unit tests. → see `sync-versions-spec.js.AGENTS.md` |
| `sync-versions.js` | Post-bump release helper. Reads every workspace `package.json`, enforces lockstep versions, rewrites every… → see `sync-versions.js.AGENTS.md` |
| `test-standalone-npm-install-docker.sh` | Docker smoke: packs workspaces + root, launches clean Linu… → see `test-standalone-npm-install-docker.sh.AGENTS.md` |
| `test-standalone-npm-install.ps1` | Windows port of standalone-npm-install smoke. Packs workspaces… → see `test-standalone-npm-install.ps1.AGENTS.md` |
| `test-standalone-npm-install.sh` | Bash standalone-install smoke: packs workspaces, installs tarballs into isolated temp HOME, spawns… → see `test-standalone-npm-install.sh.AGENTS.md` |
| `theme-token-baseline.json` | Shrink-only baseline for `theme-token-guard.mjs`: `{fallback,undeclared,accentText}` maps. → see `theme-token-baseline.json.AGENTS.md` |
| `theme-token-guard.mjs` | Three-arm theme-token ratchet: fallback-form, undeclared colour token, accent-as-text. → see `theme-token-guard.mjs.AGENTS.md` |
| `verify-published-imports.mjs` | Publish-correctness checker, run by ci.yml. For every non-private `packages/*`, asserts every module… → see `verify-published-imports.mjs.AGENTS.md` |
| `verify-plugin-install-load.mjs` | Dynamic install-load check: pack → install OUTSIDE the rep… → see `verify-plugin-install-load.mjs.AGENTS.md` |
| `verify-docker-plugin-load.mjs` | Required Docker gate (X12): boot the image and assert the browser plugin loaded, with no alias crutch. → see `verify-docker-plugin-load.mjs.AGENTS.md` |
| `verify-lockfile-versions.mjs` | Sanity gate after `pnpm install --lockfile-only` in `publish.yml` (`tag-and-push`) + `_electron-build.yml`. → see `verify-lockfile-versions.mjs.AGENTS.md` |
| `verify-release-deps.mjs` | Pre-release dependency-shape gate. RULES assert server declares jiti, node-pty (>=1.2.0-beta.13),… → see `verify-release-deps.mjs.AGENTS.md` |
| `vitest.config.ts` | Vitest config for repo-root /scripts project. Includes scripts/__tests__/**/*.test.mjs, node env, forks pool,… → see `vitest.config.ts.AGENTS.md` |
| `windows-liveness-smoke.ts` | Windows boot-parent-liveness smoke (CI: `_smoke.yml` standalone-install-smoke-windows). → see `windows-liveness-smoke.ts.AGENTS.md` |
| `windows-introspection-smoke.ts` | Windows introspection smoke driver (CI: `_smoke.yml` standalone-install-smoke-windows). → see `windows-introspection-smoke.ts.AGENTS.md` |
