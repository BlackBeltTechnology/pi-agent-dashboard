# Tasks — fix-browser-plugin-vendor-specifier-resolution

Test tasks in §5 are folded from `test-plan.md` (24 automated rows, 1
manual-only). The manifest is the source of truth for automated vs manual.

## 0. Reproduce the evidence (the proposal's spike rows)

- [ ] 0.1 Live failure: `grep 'Failed to load plugin' ~/.pi/dashboard/server.log | tail -1` → `"browser": Cannot find module '@isomorphic/manualPromise'`; per-boot counts via the last `discovered .* plugin(s)` block (16 loaded / 1 failed), NOT the whole-file count.
- [ ] 0.2 Env gap: `ps eww <server-pid> | tr ' ' '\n' | grep JITI` → no output; confirm which wrapper launched it (`which pi-dashboard`, then grep that file for `JITI_TSCONFIG_PATHS`).
- [ ] 0.3 Hole 2: `ls $(npm root -g)/@blackbelt-technology/pi-agent-dashboard/tsconfig.base.json` → absent.
- [ ] 0.4 Rows 1-2: detached worktree, apply the patch, delete the `paths` + `resolve.alias` entries, regenerate the manifest, run `tsc --noEmit` and `vitest run` in `packages/browser-plugin` (expect 22 files / 199 tests). Remove per-package `node_modules` symlinks in the worktree first — they resolve `dashboard-plugin-runtime` back to the main checkout.
- [ ] 0.5 Rows 3-4: pack → extract outside the repo → `npm install --omit=dev` → import the entry, patched vs unpatched, flag on vs off.
- [ ] 0.6 Rows 6-7: two cold server boots (temp `HOME`, `env -u JITI_TSCONFIG_PATHS`), unpatched vs patched; write per-boot logs to distinct files.
- [ ] 0.7 Confirm Docker currently WORKS (`docker/entrypoint.sh` execs `pi-dashboard`, `Dockerfile:152` copies `tsconfig.base.json`) — this change must not regress it.

## 1. Patch script + vendored files (D1, D3)

- [ ] 1.1 `scripts/patch-vendor-specifiers.mjs`: idempotent; maps the 4 specifiers to `'../'.repeat(depth) + 'shims/<name>.js'` from each file's depth below `relay/vendor/`; emits the Apache §4(b) in-file modification notice exactly once per file; exits non-zero on any unmapped playwright-internal specifier.
- [ ] 1.2 Run it: expect 2 files, 5 specifier lines, 2 headers.
- [ ] 1.3 `scripts/refresh-vendor.mjs`: fetch each `upstream-verbatim` file at `upstreamCommit`, assert its recorded `upstream` hash, then invoke 1.1, then regenerate `patched`. This is the only place refresh fidelity is checkable.

## 2. Integrity manifest + attribution (D2, D3)

- [ ] 2.1 `vendor-hashes.json` → per-file `kind`: `upstream-verbatim` (`upstream` + `patched`) or `authored` (`patched` only). `playwright-core/src/server/registry/index.ts` and `shims/wsServer.ts` are `authored` — they replace upstream modules.
- [ ] 2.2 Add `relay/vendor/shims/**` to the manifest (today hashed only in NOTICE prose, and now the target of every rewritten import).
- [ ] 2.3 Replace the `$comment` regenerator one-liner — the shipped copy emits the old single-hash schema and would break 2.1's own assertion on the next refresh.
- [ ] 2.4 Update `vendor-integrity.test.ts`: assert `patched` vs disk, key-presence per `kind`, exact file set. Fix its stale title ("alias wiring works") and comments.
- [ ] 2.5 `vendor/NOTICE`: move `cdpRelay.ts` / `cdpRelayV2.ts` out of "Verbatim upstream files" into a Modifications section (§4(d)); rewrite the shims rationale sentence that says the specifiers resolve "without editing the vendored files"; rewrite the refresh policy to copy → verify → patch → rehash.

## 3. Delete the alias layers and every doc describing them as live

- [ ] 3.1 `tsconfig.base.json` — remove the 4 `@isomorphic/*` + `@utils/wsServer` `paths` entries (keep the 6 pi-* entries).
- [ ] 3.2 `packages/browser-plugin/vitest.config.ts` — remove the 4 alias entries, `VENDOR_SHIMS`, and the stale comment block.
- [ ] 3.3 `scripts/verify-published-imports.mjs` — delete the browser-plugin waiver block and its rationale comment.
- [ ] 3.4 `packages/server/bin/pi-dashboard.mjs` — remove the `JITI_TSCONFIG_PATHS` stamp and the comment at ~141-152 that credits the docker harness.
- [ ] 3.5 Docs that assert the deleted mechanism: `packages/server/AGENTS.md` (stamp clause), `packages/browser-plugin/AGENTS.md:10-11`, `relay/vendor/AGENTS.md:27-30`, `scripts/verify-published-imports.mjs.AGENTS.md:3` ("cannot be rewritten to relative paths").

## 4. Guard scripts (D4, D6)

- [ ] 4.1 Specifier guard: parse import statements under `relay/vendor/playwright-core/**`; every bare specifier must be a Node builtin or a declared dependency. Scope to import syntax — `NOTICE`/`AGENTS.md` legitimately name the old specifiers in prose.
- [ ] 4.2 `scripts/verify-plugin-install-load.mjs`: pack the plugin AND its first-party workspace deps, install from those tarballs outside the repo, import under plain node+jiti with the flag unset; assert `typeof mod.default === "function"`; also import `cdpRelay.js`; skip manifests with no `server` entry.
- [ ] 4.3 CI wiring: nightly leg over all plugin workspaces; per-PR only for changed plugins (+ browser-plugin). Required Docker job that builds the image and asserts plugin load.

## 5. Tests folded from test-plan.md

### L1 — vitest (exemplar: `packages/browser-plugin/src/server/__tests__/vendor-integrity.test.ts`; script-level exemplar: `scripts/__tests__/verify-published-imports.test.mjs`)

- [ ] 5.1 Specifier inventory passes on the patched tree (test-plan #E1) · input: patched `relay/vendor/playwright-core/**` · trigger: enumerate import statements · observable: every bare specifier is a Node builtin or a declared dependency, zero others. See `scripts/__tests__/biome-undeclared-dependencies.test.mjs` for the declared-dependency lookup idiom.
- [ ] 5.2 Unknown internal namespace is rejected (test-plan #E2) · input: fixture file importing `@protocol/foo` · trigger: run the guard over the fixture · observable: exit non-zero naming file + specifier (a prefix allowlist would pass). See `scripts/__tests__/verify-published-imports.test.mjs`.
- [ ] 5.3 Manifest provenance decision table (test-plan #E3) · input: 4 manifest entries (valid verbatim, valid authored, authored-with-upstream, verbatim-missing-upstream) · trigger: validate · observable: first two pass, last two fail with the offending key named. See `vendor-integrity.test.ts`.
- [ ] 5.4 Authored shim is not claimed as upstream (test-plan #E4) · input: `playwright-core/src/server/registry/index.ts` entry · trigger: validate manifest · observable: `kind: "authored"`, no `upstream` key. See `vendor-integrity.test.ts`.
- [ ] 5.5 Shims are covered by the manifest (test-plan #E5) · input: `relay/vendor/shims/*.ts` · trigger: compare manifest file set to disk · observable: all four present; an unlisted shim on disk fails. See `vendor-integrity.test.ts`.
- [ ] 5.6 Patch script idempotency (test-plan #E6) · input: pristine vendored copy in a tmp dir · trigger: run the script 1×/2×/3× · observable: identical tree hashes; §4(b) header present exactly once. See `scripts/__tests__/verify-published-imports.test.mjs` for the tmp-fixture idiom.
- [ ] 5.7 Apache §4(b)/§4(d) placement (test-plan #E7) · input: the two patched files + `vendor/NOTICE` · trigger: read headers and NOTICE sections · observable: in-file notice present in both; NOTICE lists them under Modifications and not under "Verbatim upstream files". See `vendor-integrity.test.ts` (it already asserts NOTICE content).
- [ ] 5.8 Install-load scope filter (test-plan #E8) · input: manifests with `server`, `fixture:true` without `server`, plain without `server` · trigger: run the scope filter · observable: first checked, other two reported `skipped` not failed. See `scripts/__tests__/assert-bundled-plugins-complete.test.mjs`.
- [ ] 5.9 Out-of-repo load of the server entry (test-plan #X1) · input: packed plugin extracted outside the repo, no reachable `tsconfig.base.json`, `JITI_TSCONFIG_PATHS` unset · trigger: import the server entry under plain node+jiti · observable: `typeof mod.default === "function"` and the resolved path is inside the temp install. See `scripts/__tests__/verify-published-imports.test.mjs`.
- [ ] 5.10 `cdpRelay.js` imports directly (test-plan #X2) · input: the same install · trigger: import `vendor/playwright-core/src/tools/mcp/cdpRelay.js` · observable: resolves — covers the 4 specifiers the runtime chain never reaches. See `vendor-integrity.test.ts:24`.
- [ ] 5.11 Refresh rejects an unfaithful upstream copy (test-plan #X3) · input: file bytes differing from the recorded `upstream` hash · trigger: `refresh-vendor.mjs` with a stubbed fetch · observable: non-zero exit on the mismatch BEFORE patching; tree untouched. See `scripts/__tests__/check-kb-dist-fresh.test.mjs` for the stub-and-assert idiom.
- [ ] 5.12 Refresh that skips the patch is caught (test-plan #X4) · input: pristine re-copy with bare specifiers restored · trigger: specifier guard · observable: non-zero naming both files. See `scripts/__tests__/verify-published-imports.test.mjs`.
- [ ] 5.13 Hand-edit detection (test-plan #X5) · input: one byte changed in a vendored file · trigger: integrity test · observable: fails on that file's `patched` hash. See `vendor-integrity.test.ts`.
- [ ] 5.14 Working-tree runtime is what gets imported (test-plan #X6) · input: runtime working tree exporting a symbol absent from the published version, imported by the plugin entry · trigger: install-load check · observable: passes only with the packed local runtime; registry resolution fails on the missing export. See `packages/electron/scripts/bundle-server.mjs:86-92` for the documented hazard.

### L2 — qa VM smoke (exemplar: `qa/tests/01-install.sh` + `qa/tests/02-server-start.sh`; PowerShell twins required)

- [ ] 5.15 Cold boot loads the browser plugin (test-plan #X7) · input: clean prefix, dashboard + browser plugin installed from locally packed tarballs, config enabling all discovered plugins · trigger: cold start through the launcher with `env -u JITI_TSCONFIG_PATHS` · observable: `Loaded plugin "browser"` in the log, zero `Failed to load plugin`, health 200. See `qa/tests/02-server-start.sh`.
- [ ] 5.16 Empty prefix cannot pass (test-plan #X8) · input: clean prefix, dashboard only, no plugin · trigger: run the smoke · observable: smoke FAILS on the non-empty-discovery assertion. See `qa/tests/01-install.sh`.
- [ ] 5.17 Disabled-by-default cannot hide a failure (test-plan #X9) · input: installed plugin with `defaultEnabled:false` and a throwing server entry · trigger: run the smoke · observable: it is enabled and the smoke FAILS. See `qa/tests/02-server-start.sh`.
- [ ] 5.18 Dependency-gated plugin is not a failure (test-plan #X10) · input: a plugin reported `loaded:false` for a missing dep or unmet requirement · trigger: evaluate results · observable: not counted as a failure; `loaded == discovered` is never asserted. See `qa/tests/02-server-start.sh`.
- [ ] 5.19 Wrong-tree contamination is caught (test-plan #X11) · input: a monorepo checkout present on the host · trigger: run the smoke against the clean prefix · observable: all loaded plugin paths inside the prefix; a checkout path FAILS. See `qa/tests/01-install.sh`.

### L3 — Playwright e2e (exemplar: `tests/e2e/apple-tools-activation.spec.ts`, `tests/e2e/anthropic-bridge-activation.spec.ts`)

- [ ] 5.20 Browser plugin row shows loaded, not error (test-plan #F1) · input: docker harness with the plugin loaded (port from `.pi-test-harness.json` `dashboardPort`, never hardcoded) · trigger: open the plugins settings view · observable: the `browser` row converges to enabled/loaded with no error badge. See `tests/e2e/apple-tools-activation.spec.ts`.

### ci / electron (exemplar: `.github/workflows/ci.yml` verify step, `.github/workflows/nightly.yml`, `.github/workflows/ci-electron.yml`)

- [ ] 5.21 Required Docker job: build the image, boot the container, assert `Loaded plugin "browser"` and zero `Failed to load plugin` (test-plan #X12) · input: image from the change branch · trigger: CI job · observable: container health 200 + log assertions. See `.github/workflows/ci-e2e-browser.yml` for the docker-harness job shape.
- [ ] 5.22 Electron bundled-server boot check (test-plan #X13) · input: `bundle-server.mjs` output (no `tsconfig.base.json` in it) · trigger: boot the bundled server · observable: `Loaded plugin "browser"`, no failures. See `.github/workflows/ci-electron.yml` and `_electron-build.yml`.
- [ ] 5.23 Nightly install-load leg budget (test-plan #P1) · input: all plugin workspaces with a `server` entry (~13 cycles) · trigger: nightly run · observable: whole leg < 12 min, per-plugin p95 < 60 s. See `.github/workflows/nightly.yml`.
- [ ] 5.24 Per-PR selection budget (test-plan #P2) · input: a PR touching one plugin · trigger: changed-plugins selection · observable: ≤ 2 plugins checked, < 3 min added to PR CI. See `.github/workflows/ci.yml`.

### Manual

- [ ] 5.25 Operator verification that relay behaviour is unchanged: connect a real SSO Chrome profile, drive a page, check the live-view tile (test-plan #F2 — test-plan: manual-only) — no automatable observable; needs a logged-in browser and human judgment.

## 6. Gates

- [ ] 6.1 `cd packages/browser-plugin && tsc -p tsconfig.json --noEmit` → exit 0.
- [ ] 6.2 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` → green (browser-plugin baseline: 22 files / 199 tests).
- [ ] 6.3 `node scripts/verify-plugin-install-load.mjs` → green.
- [ ] 6.4 A/B cold boot: patched tree, launched **through the wrapper** with `env -u JITI_TSCONFIG_PATHS`, 0 plugin-load failures and `Loaded plugin "browser"`. Do NOT verify via `/api/restart` — it re-execs with inherited `process.env` and does not re-read `bin/pi-dashboard.mjs`.
- [ ] 6.5 `node scripts/verify-published-imports.mjs` → green with the waiver removed.
- [ ] 6.6 Docker harness run (`docker/test-up.sh` → assert plugin load → `test-down.sh`) — Docker works today via the two crutches this change removes.
- [ ] 6.7 `openspec validate fix-browser-plugin-vendor-specifier-resolution --strict` and `node scripts/check-conventions.mjs`.
- [ ] 6.8 `npm run quality:changed`.

## 7. Discipline checkpoints

- [ ] 7.1 `doubt-driven-review` on the D2 provenance/refresh design BEFORE any vendored file is edited (round 1 already run on proposal+design; this is the irreversible step).
- [ ] 7.2 `review-code` on the full diff before commit.

## 8. Docs

- [ ] 8.1 `DocScribe`: vendor refresh policy prose (copy → verify → patch → rehash) in caveman style.
- [ ] 8.2 Directory `AGENTS.md` rows for `scripts/patch-vendor-specifiers.mjs`, `scripts/refresh-vendor.mjs`, `scripts/verify-plugin-install-load.mjs`, and the new qa test.
- [ ] 8.3 CHANGELOG `## [Unreleased]`: the browser relay plugin loads in npm, managed and Electron installs; note that the patched plugin and the server change ship together (an older plugin copy on disk stops working once the server stops stamping the flag).
