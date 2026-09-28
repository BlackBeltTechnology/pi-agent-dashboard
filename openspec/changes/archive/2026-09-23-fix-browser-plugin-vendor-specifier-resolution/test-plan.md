# Test Plan — fix-browser-plugin-vendor-specifier-resolution

Stage: design   Generated: 2026-09-21

Gate resolved interactively (3 answers): CI install-load runs **nightly for
all plugins, per-PR for changed plugins only**; the Docker regression gate is a
**required CI job**; the clean-install smoke installs the browser plugin from a
**locally packed tarball**.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | browser-relay: resolves without alias config | EP (valid partition) | L1 | automated | patched vendored tree, `relay/vendor/playwright-core/**` | enumerate every import statement | every bare specifier is a Node builtin or a key of the plugin `package.json` `dependencies`/`peerDependencies`; zero others |
| E2 | browser-relay: resolves without alias config | EP (invalid partition) | L1 | automated | a vendored file containing `import x from '@protocol/foo'` (fixture string, not on disk) | run the specifier guard over the fixture | guard exits non-zero naming file + `@protocol/foo` (prefix allowlists would pass this) |
| E3 | browser-relay: integrity, provenance kinds | decision-table | L1 | automated | manifest entries: `{kind:upstream-verbatim, upstream, patched}`, `{kind:authored, patched}`, `{kind:authored, upstream, patched}`, `{kind:upstream-verbatim, patched}` | validate the manifest | rows 1-2 pass; row 3 fails (authored must not claim upstream); row 4 fails (missing `upstream`) |
| E4 | browser-relay: integrity, authored shim | decision-table | L1 | automated | `playwright-core/src/server/registry/index.ts` | validate the manifest | its entry has `kind: "authored"` and no `upstream` key |
| E5 | browser-relay: integrity covers shims | EP | L1 | automated | `relay/vendor/shims/*.ts` (4 files) | validate manifest file-set against disk | every shim appears in the manifest; a shim added on disk but absent from the manifest fails |
| E6 | browser-relay: patch script idempotent | BVA (run count 1, 2, 3) | L1 | automated | pristine vendored copy in a tmp dir | run `patch-vendor-specifiers.mjs` 1×, 2×, 3× | tree hash after run 1 == run 2 == run 3; the §4(b) header appears exactly once |
| E7 | browser-relay: Apache §4(b) | EP | L1 | automated | the two patched files | read their first 20 lines | each carries a modification notice naming the change; `vendor/NOTICE` lists them under Modifications and NOT under "Verbatim upstream files" |
| E8 | dashboard-plugin-loader: server-less plugin skipped | decision-table | L1 | automated | manifests: with `server`; `fixture:true` without `server`; without `server` and not fixture | run the install-load scope filter | first is checked; second and third are reported `skipped`, not failed |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | browser-relay: loads with no monorepo tsconfig | fault-injection (remove the alias source) | L1 | automated | packed plugin extracted outside the repo; no `tsconfig.base.json` reachable; `JITI_TSCONFIG_PATHS` unset | import the server entry under plain node+jiti | import resolves and `typeof mod.default === "function"` (the check at `loader.ts:462`); resolved path is inside the temp install, not any checkout |
| X2 | browser-relay: both patched modules exercised | fault-injection (bypass the runtime chain) | L1 | automated | same install as X1 | import `vendor/playwright-core/src/tools/mcp/cdpRelay.js` directly | import resolves — covers the 4 specifiers `cdpRelayV2` never reaches |
| X3 | browser-relay: refresh fidelity | fault-injection (corrupt source) | L1 | automated | a vendored file whose bytes differ from the recorded `upstream` hash | run `refresh-vendor.mjs` with a stubbed fetch returning those bytes | exits non-zero on the `upstream` mismatch BEFORE patching; the tree is left untouched |
| X4 | browser-relay: refresh skipping the patch | fault-injection (partial procedure) | L1 | automated | vendored tree re-copied pristine (bare specifiers restored) | run the specifier guard | exits non-zero naming `cdpRelay.ts` + `cdpRelayV2.ts` |
| X5 | browser-relay: hand-edit detection | fault-injection (mutate byte) | L1 | automated | one byte changed in a vendored file | run the integrity test | fails on that file's `patched` hash |
| X6 | dashboard-plugin-loader: working-tree runtime under test | fault-injection (stale registry copy) | L1 | automated | `dashboard-plugin-runtime` working tree exports a symbol absent from the published version; plugin entry imports it | run the install-load check | check passes only if the packed local runtime was installed; resolving from the registry fails with the missing export |
| X7 | browser-relay: server boot | fault-injection (env stripped) | L2 | automated | clean prefix; dashboard + browser plugin installed from locally packed tarballs; config enabling all discovered plugins | cold start through the launcher with `env -u JITI_TSCONFIG_PATHS` | log contains `Loaded plugin "browser"`, no `Failed to load plugin`, health responds 200 |
| X8 | dashboard-plugin-loader: empty prefix cannot pass | fault-injection (omit the plugin) | L2 | automated | clean prefix with dashboard only, no plugin installed | run the clean-install smoke | smoke FAILS on the non-empty-discovery assertion (guards against the vacuous-green trap) |
| X9 | dashboard-plugin-loader: disabled-by-default cannot hide | fault-injection (broken entry) | L2 | automated | installed plugin with `defaultEnabled:false` whose server entry throws | run the clean-install smoke | smoke enables it and FAILS; never reports a clean run |
| X10 | dashboard-plugin-loader: dependency-gated not a failure | decision-table | L2 | automated | a plugin reported `loaded:false` with `missing/disabled dep` or unmet `missingRequirements` | evaluate smoke results | not counted as a failure; `loaded == discovered` is NOT asserted |
| X11 | dashboard-plugin-loader: wrong-tree contamination | fault-injection (monorepo on host) | L2 | automated | a monorepo checkout present on the same host as the clean prefix | run the clean-install smoke | every loaded plugin path is inside the install prefix; a path in the checkout FAILS the run |
| X12 | browser-relay: Docker after both crutches are removed | fault-injection (removed stamp + removed paths) | ci | automated | image built from the change branch | required CI job builds the image and boots the container | container health 200 and container log contains `Loaded plugin "browser"`, zero `Failed to load plugin` |
| X13 | browser-relay: Electron bundled server | fault-injection (no tsconfig in bundle) | electron | automated | `bundle-server.mjs` output (workspace source, no `tsconfig.base.json`) | boot the bundled server from the bundle dir | `Loaded plugin "browser"` present, no `Failed to load plugin` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | dashboard-plugin-loader: install-load check cost | threshold | ci | automated | nightly run over all plugin workspaces with a `server` entry (~13 pack+install+import cycles) | wall-clock of the whole leg < 12 min; per-plugin cycle p95 < 60 s | single nightly run |
| P2 | dashboard-plugin-loader: per-PR cost | threshold | ci | automated | PR touching one plugin → changed-plugins-only selection | the leg runs ≤ 2 plugins and adds < 3 min to PR CI | per PR |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | browser-relay plugin surfaces after the fix | state-convergence | L3 | automated | docker harness with the plugin loaded (port from `.pi-test-harness.json` `dashboardPort`) | open the plugins settings view | the `browser` plugin row converges to enabled/loaded with no error badge — the inverse of the reported `error` state that opened this change |
| F2 | relay behaviour is unchanged by the patch | human judgment | — | manual-only | a real Chrome profile with SSO | operator connects a profile and drives a page | connection, live-view tile and navigation feel unchanged; no automatable observable (needs a real logged-in browser + human eyes) |

---

## Coverage summary

- Requirements covered: 4/4 (browser-relay ×2, dashboard-plugin-loader ×2)
- Scenarios by class: edge 8 · perf 2 · frontend 2 · error 13
- Scenarios by level: L1 14 · L2 5 · L3 1 · ci 3 · electron 1 · manual 1
- Scenarios by disposition: automated 24 · manual-only 1

## New infra needed

- `scripts/verify-plugin-install-load.mjs` — new CI entry point (X1, X2, X6, E8, P1, P2). No existing harness does pack→install→import.
- A nightly workflow leg + a changed-plugins selector for it (P1, P2).
- A required Docker image-build-and-boot CI job (X12) — `docker/test-up.sh` exists for e2e, but no job asserts plugin load inside the image.
- An Electron bundled-server boot check (X13) — `ci-electron.yml` builds artifacts but does not boot the bundled server and read its plugin log.
