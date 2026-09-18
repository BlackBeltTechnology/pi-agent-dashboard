# Test Plan — add-served-build-coherence-and-hash-parity

Stage: design   Generated: 2026-09-17

All Triple slots resolved — no clarification markers. The three gaps found during
scenario derivation (discovery-root policy, fixture policy on a dev host, twin
rebuild script) were resolved with the user during the doubt-review cycles and are
now spec text, so they generate scenarios instead of questions.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | staleness: client-less plugin excluded | decision-table | L1 | automated | discovery set = 2 plugins with `clientEntryPath`, 1 without (`mcp-server` shape) | `selectClientRegistryPlugins(set, {isProd:true})` | returns exactly the 2 client-bearing plugins; `pluginRegistryHash` of the result equals the hash of the same 2 supplied alone |
| E2 | staleness: fixture policy both sides | decision-table | L1 | automated | set includes 1 `fixture:true` plugin **with** a client entry (`demo-plugin` shape) | select with `isProd:true` then `isProd:false` | `isProd:true` excludes it, `isProd:false` includes it; no other row differs |
| E3 | staleness: runtime-only root excluded | EP | L1 | automated | discovery set with one plugin whose packageDir lies under a runtime-only root (`~/.pi/dashboard/plugins` shape) and has a client entry | select with either policy | that plugin is absent from the result under both policies |
| E4 | build hash == runtime hash on this repo | EP | L1 | automated | the real repo discovery set (17 plugins, 1 client-less) | compute build-side and server-side hash through the shared selector | both equal the `PLUGIN_REGISTRY_HASH` committed in `packages/client/src/generated/plugin-registry.tsx` |
| E5 | hash over a declared set | BVA (order) | L1 | automated | the same 3 plugins supplied in reverse order and from a different absolute root | build a declaration from each | the two declarations are byte-identical |
| E6 | hash over a declared set | BVA (set delta) | L1 | automated | a 3-plugin set vs the same set plus one client-bearing plugin | build a declaration from each | the `pluginRegistryHash` values differ |
| E7 | declaration emit — production | EP | L1 | automated | a production build run of the vite plugin over a fixture plugin set | build completes | `pi-dashboard-build.json` exists in the output with `schemaVersion`, `fixturePolicy:"excluded"`, and a hash equal to the emitted `PLUGIN_REGISTRY_HASH` |
| E8 | declaration emit — dev | EP | L1 | automated | a dev/HMR registry regeneration | regeneration completes | no `pi-dashboard-build.json` is written |
| E9 | declaration validation | decision-table | L1 | automated | six destination files: valid · absent · malformed JSON · wrong `schemaVersion` · missing `pluginRegistryHash` · unknown `fixturePolicy` | `readBuildDeclaration(dir)` | each returns its own non-throwing outcome; only the first yields a usable declaration |
| E10 | static-root precedence | decision-table | L1 | automated | four temp layouts: package+workspace both valid · package only · workspace only · neither | resolve the static root | returns package dir, package dir, workspace dir, `null` respectively |
| E11 | static-root precedence (subtle) | decision-table | L1 | automated | web package resolvable but its `dist/` has **no** `index.html`, while a valid workspace `../../client/dist` exists | resolve the static root | returns `null` (API-only), NOT the workspace dir |
| E12 | health `clientBuild` states | decision-table | L1 | automated | four server fixtures: declaration hash == runtime hash · != runtime hash · dir without declaration · no static dir | `GET /api/health` | `clientBuild.status` is `matched` / `mismatched` / `metadata-missing` / `not-served`, with a hash on the first two and `null` on the last two |
| E13 | health backward compatibility | EP | L1 | automated | any of the four fixtures above | `GET /api/health` | `bundleHash` is a hex string and every pre-existing health key is present with its prior type; only `clientBuild` is new |
| E14 | comparison honours declared fixture policy | decision-table | L1 | automated | dev-mode server (`config.dev:true`) + a served artifact declaring `fixturePolicy:"excluded"`, discovery set containing `demo-plugin` | `GET /api/health` | `clientBuild.status` is `matched` — the fixture plugin alone does not produce `mismatched` |
| E15 | sync outcome table | decision-table | L1 | automated | five temp-dir pairs: dest == source · dest is a valid build with a declaration · dest is a valid build with **no** declaration (legacy) · no dest resolves · dest exists but has no `index.html` | run the sync helper | no-op success · mirror+verify success · mirror+verify success (adopted) · "API-only host" success · non-zero refusal with the destination unmodified |
| E16 | sync refuses a bad source | EP | L1 | automated | source build whose declaration is absent or fails validation | run the sync helper | non-zero exit; destination byte-identical to before |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | health stays a hot path | threshold | L1 | automated | 200 sequential `GET /api/health` against a server with a resolved static dir | added wall-clock per request vs a baseline without `clientBuild` < 1 ms mean (the field is a startup snapshot, so it must add no filesystem I/O per request) | the 200-request run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | banner hides on a parity host | state-transition | L1 | automated | mocked `/api/health` returning a `bundleHash` equal to the imported `PLUGIN_REGISTRY_HASH`, with a client-less plugin in the server's set | `PluginStalenessBanner` mounts | no `plugin-staleness-banner` testid is rendered |
| F2 | banner still fires on a genuine delta | state-transition | L1 | automated | mocked `/api/health` returning a `bundleHash` differing from the imported hash | banner mounts | the banner renders with its Refresh button, and dismiss still suppresses it for the session |
| F3 | banner converges end-to-end | state-transition | L3 | automated | the docker harness serving a client built from the same checkout (port from `.pi-test-harness.json` `dashboardPort`) | load the dashboard root and wait for the health probe to resolve | the staleness banner never appears; `/api/health` reports `clientBuild.status:"matched"` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | diagnostic leaks no path | fault-injection (unreadable file) | L1 | automated | served dir whose `pi-dashboard-build.json` cannot be read (permission/EACCES or a directory in its place) | server startup reads the declaration | status is `metadata-missing`; the emitted log line names the condition and matches no path-like substring (no `/`-containing token, no drive letter) |
| X2 | diagnostic leaks no path (mismatch) | fault-injection | L1 | automated | served dir declaring a hash different from the runtime set | server startup | the diagnostic names `mismatched` and contains no filesystem path |
| X3 | sync on a non-writable destination | fault-injection (EACCES) | L1 | automated | destination directory chmod'd non-writable | run the sync helper | non-zero exit with a remediation hint; destination contents unchanged (no partial write) |
| X4 | post-copy verification failure | fault-injection | L1 | automated | a sync where the destination's declaration still differs after the copy (simulated by a write hook) | run the sync helper | non-zero exit; the failure is reported as a mismatch, never as success |
| X5 | rebuild scripts abort before restart | fault-injection (forced refusal) | L2 | automated | a forced-refusal destination, with `pi-dashboard` and `reload-all.sh` replaced by recording stubs on `PATH` | run `scripts/rebuild-restart.sh`, then `scripts/rebuild-and-restart.sh` | both exit non-zero; neither stub is invoked (no restart, no bridge reload) |
| X6 | dev-mode scoping is honest | state-transition | L1 | automated | dev-mode server with a production fallback dir present | `GET /api/health` | `clientBuild` describes the fallback directory's declaration and the response is well-formed (no crash, no null-deref) whether or not a Vite dev server is reachable |

---

## Coverage summary

- Requirements covered: 9/9 (5 in `served-client-build-coherence`, 2 modified in `plugin-manifest-staleness`, plus the resolver-precedence and rebuild-entry-point requirements)
- Scenarios by class: edge 16 · perf 1 · frontend 3 · error 6
- Scenarios by level: L1 23 · L2 1 · L3 1 · manual-only 0
- Scenarios by disposition: automated 26 · manual-only 0

## New infra needed

None. L1 rides existing `packages/*/src/**/__tests__/*.test.ts` (vitest); X5 rides
`qa/tests/*.sh` with `PATH`-shadowed stubs; F3 rides the existing docker harness
used by `tests/e2e/*.spec.ts` (port read from `.pi-test-harness.json`, never
hardcoded).
