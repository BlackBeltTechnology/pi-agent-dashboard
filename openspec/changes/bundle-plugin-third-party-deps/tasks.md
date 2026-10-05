## 0. Prerequisite

- [x] 0.1 Branch the worktree from current `origin/develop` (contains PR #806, merge `267512943`); verify `BUNDLED_WORKSPACE_PKGS` in `packages/electron/scripts/bundle-server.mjs` lists 12 packages incl. `mcp-client-plugin` and `client-utils`, and the devDependencies strip is present

## 1. Shared helpers — tests first (`packages/shared/src/__tests__/materialize-plugins-deps.test.ts`, new; exemplar `packages/shared/src/__tests__/bundled-plugins-complete.test.ts` for repo-path + tmp-fixture glue)

- [x] 1.1 Test (test-plan #E1): input tmp `gmail-plugin` with deps `oauth4webapi ^3.8.8` + one `@blackbelt-technology/*` dep · trigger `collectPluginRuntimeDeps({ids, resolveSource, workspaceManifests: []})` · observable returns exactly `{oauth4webapi: "^3.8.8"}`
- [x] 1.2 Test (test-plan #E2): input plugin with only `devDependencies`/`peerDependencies`/`optionalDependencies` · trigger collect · observable returns `{}`
- [x] 1.3 Test (test-plan #E3): input ids normal / `fixture:true` with dep `x` / missing package.json · trigger collect and `materializeBundledPlugins` on the same ids · observable no `x` in union and both skip identically (only the normal id materialized)
- [x] 1.4 Test (test-plan #E4): input plugins A, B and workspace `server` all `@fastify/rate-limit ^11.2.0` · trigger collect · observable no throw, single key `^11.2.0`
- [x] 1.5 Test (test-plan #E5): input A `yaml ^2.9.0`, B `yaml ^1.10.0` · trigger collect · observable throws with `yaml`, `A@^2.9.0`, `B@^1.10.0` in message
- [x] 1.6 Test (test-plan #E6): input plugin `jose ^5.0.0`, workspace manifest `server` `jose ^6.0.0` · trigger collect · observable throws naming `jose`, the plugin and `server`
- [x] 1.7 Test (test-plan #E7): input workspace-only dep `fastify` · trigger collect · observable `fastify` absent, no throw
- [x] 1.8 Test (test-plan #E8): input specifiers `file:../x`, `workspace:*`, `link:../y`, `npm:foo@1`, `git+https://h/r.git`, `user/repo` vs `^1.2.3`, `1.x`, `>=1 <2`, `latest` · trigger collect per specifier · observable rejects throw naming plugin + dep, accepts returned
- [x] 1.9 Test (test-plan #E9): input plugin deps `{a, @s/b, c}` with `a` plugin-local, `@s/b` at root, `c` absent · trigger `findUnresolvedPluginDeps({pluginsDir, rootDir})` · observable `[{plugin:"p", dep:"c"}]`
- [x] 1.10 Test (test-plan #E10): input dep `d` only in `parent/node_modules`, `rootDir = parent/root` · trigger find · observable `d` reported; moved to `parent/root/node_modules` → `[]`
- [x] 1.11 Test (test-plan #E11): input `root/node_modules/@s/package.json` but no `@s/b/` · trigger find · observable `@s/b` reported
- [x] 1.12 Test (test-plan #E12): input plugin with absent first-party dep + sibling dir without package.json · trigger find · observable only the first-party pair reported, no throw
- [x] 1.13 Verify 1.1–1.12 fail (`npx vitest run packages/shared/src/__tests__/materialize-plugins-deps.test.ts`), then implement in `packages/shared/src/runtime-overlay/materialize-plugins.mjs`: extract one shared plugin-source predicate (missing/unparsable package.json, fixture → skip) used by `materializeBundledPlugins` and `collectPluginRuntimeDeps`; add `findUnresolvedPluginDeps` (fs existence only, bounded walk-up); add types to `materialize-plugins.d.mts`. Verify 1.1–1.12 pass and existing materialization tests stay green

## 2. Bundle build installs plugin deps

- [x] 2.1 Test (test-plan #E13), in `packages/shared/src/__tests__/bundled-plugins-complete.test.ts` (extend; exemplar its existing transitive first-party test): input real `piDashboard.bundledPlugins` + real `BUNDLED_WORKSPACE_PKGS` manifests · trigger collect · observable no throw; contains `oauth4webapi`, `yaml`, `debug`, `discord.js`; no `@blackbelt-technology/*` key
- [x] 2.2 Test (test-plan #E14), update `packages/shared/src/__tests__/bundle-runtime-contract.test.ts` "bundlePkg declares workspaces and no dependencies" (exemplar: that test's own literal-regex parse): input `bundle-server.mjs` source · trigger parse `bundlePkg` literal + `collectPluginRuntimeDeps(` call · observable literal has `workspaces:` and `dependencies: pluginRuntimeDeps` only, call passes `workspaceManifests`, no pi/openspec/tsx in root. Verify it fails
- [x] 2.3 In `packages/electron/scripts/bundle-server.mjs`: read `packages/<ws>/package.json` for each `BUNDLED_WORKSPACE_PKGS` entry as `workspaceManifests`, compute `pluginRuntimeDeps = collectPluginRuntimeDeps({ids, resolveSource, workspaceManifests})` before the literal (a throw exits non-zero with its message), and write `dependencies: pluginRuntimeDeps` in `bundlePkg`. Verify 2.1 + 2.2 pass

## 3. Built-bundle resolvability gate (exemplar `scripts/__tests__/assert-bundled-plugins-complete.test.mjs` — subprocess runner with `PACKAGES_DIR`/`BUNDLE_PLUGINS_DIR`)

- [x] 3.1 Test (test-plan #E15): input fixture with `BUNDLE_ROOT_DIR` + `BUNDLE_PLUGINS_DIR`, `gmail-plugin` declaring absent `oauth4webapi` · trigger run gate · observable exit 1, stderr has `gmail-plugin → oauth4webapi`
- [x] 3.2 Test (test-plan #E16): input as 3.1 plus `oauth4webapi` only above `BUNDLE_ROOT_DIR` · trigger run gate · observable exit 1, same pair
- [x] 3.3 Test (test-plan #E17): input as 3.1 plus `<root>/node_modules/oauth4webapi/package.json` version `3.8.8` · trigger run gate · observable exit 0, stdout has `oauth4webapi@3.8.8`
- [x] 3.4 Test (test-plan #E18): set `BUNDLE_ROOT_DIR` in the existing runner; input existing manifest-less fixtures · trigger existing cases · observable all pre-existing assertions still pass
- [x] 3.5 Verify 3.1–3.3 fail, then in `packages/electron/scripts/assert-bundled-plugins-complete.mjs` add `BUNDLE_ROOT_DIR` (default `dirname(dirname(BUNDLE_PLUGINS_DIR))`), call `findUnresolvedPluginDeps` after the presence check, `::error::` + exit 1 listing pairs, print `<dep>@<installedVersion>` for resolved third-party plugin deps on success. Verify 3.1–3.4 pass

## 4. Load gate covers every server-entry plugin (exemplar `scripts/__tests__/assert-bundled-server-plugin-load.test.mjs` — pure-function verdict tests)

- [x] 4.1 Test (test-plan #E19): input fixture `resources/plugins/` with `gmail-plugin` (id `gmail`, server entry), `ui-only` (no server), `fx` (fixture) · trigger `expectedServerPluginIds(dir)` · observable `["gmail"]`
- [x] 4.2 Test (test-plan #E20): input manifest ids `[browser, gmail]` (browser `defaultEnabled:false`) · trigger build gate config · observable `{plugins:{browser:{enabled:true}, gmail:{enabled:true}}}`
- [x] 4.3 Test (test-plan #E21): input log with `Loaded "a"`, `Failed to load "b"`, `Skipping "c"` · trigger `pluginLoadProblems(log, {plugins:[a,b,c]})` + verdict detector · observable problems name `b`, `c` not `a`; detector sees verdicts for all three
- [x] 4.4 Test (test-plan #E22): input existing browser logs · trigger `pluginLoadProblems(log)` without options · observable identical to current expectations
- [x] 4.5 Test (test-plan #P1): input 20 ids, fake clock, one verdict every 100 s · trigger verdict waiter (injectable `now`/`sleep`/`readLog`, idle budget `VERDICT_TIMEOUT_MS`) · observable all 20 verdicts returned, no timeout
- [x] 4.6 Test (test-plan #P2): input 3 ids, verdicts at t=10 s and t=20 s only · trigger waiter · observable returns by t ≤ 140 s + one poll interval with the 3rd id missing
- [x] 4.7 Verify 4.1–4.6 fail, then update `packages/electron/scripts/assert-bundled-server-plugin-load.mjs`: expected ids from bundle manifests (server-entry, non-fixture, manifest id), enable all bundled ids in temp `config.json`, idle-budget waiter treating `Loaded`/`Failed to load`/`Skipping` as verdicts, `pluginLoadProblems({plugins})` with legacy default; keep tsconfig premise + log-tail dump. Verify 4.1–4.6 pass

## 5. Runtime-overlay parity (exemplar `packages/server/src/__tests__/runtime-stager.test.ts` — `fakeInstalledTree` fixtures)

- [x] 5.1 Test (test-plan #X1): input staged tree where the flows plugin's `yaml` exists only under its nested `node_modules` · trigger `stageRuntime` (npm source) · observable `RuntimeStageError` code `plugin_deps_unresolved` naming `flows-plugin → yaml`, `.partial` removed, no `versions/X`, `request.pending` unchanged
- [x] 5.2 Test (test-plan #X2): input `yaml` only in the runtime dir's `node_modules` above the staged root · trigger `stageRuntime` · observable `plugin_deps_unresolved`
- [x] 5.3 Test (test-plan #X3): input `yaml` at the staged root `node_modules` · trigger `stageRuntime` · observable resolves, `versions/X` exists, `request.pending = X`
- [x] 5.4 Verify 5.1–5.3 fail, then in `packages/server/src/runtime-overlay/runtime-stager.ts` `materializeOverlayPlugins` call `findUnresolvedPluginDeps({pluginsDir: destDir, rootDir: root})` after the set check and throw `RuntimeStageError("plugin_deps_unresolved", …)` listing pairs (`code` is a plain string — no union to extend). Verify 5.1–5.3 and existing stager tests pass

## 6. Bundle freshness (exemplar: `bundle-runtime-contract.test.ts` textual checks of `build-installer.sh`)

- [x] 6.1 Test (test-plan #E23), new `packages/shared/src/__tests__/bundle-watch-paths.test.ts`: input real repo · trigger run `packages/electron/scripts/bundle-watch-paths.mjs` · observable output includes `packages/gmail-plugin/package.json`, `packages/gmail-plugin/src`, `packages/client-utils/src`, `packages/client-utils/package.json`, `packages/server/package.json`, `packages/dist/index.html`, `packages/electron/scripts/bundle-server.mjs`
- [x] 6.2 Test (test-plan #E24), extend `bundle-runtime-contract.test.ts`: input `build-installer.sh` source · trigger textual parse of the freshness block · observable iterates `bundle-watch-paths.mjs` output (no hardcoded `packages/server/src` watch entry) and runs `assert-bundled-plugins-complete.mjs` after `bundle-server.mjs`
- [x] 6.3 Verify 6.1–6.2 fail, then add `bundle-watch-paths.mjs` and rewire `packages/electron/scripts/build-installer.sh` (derived watch loop; run the resolvability gate after a rebundle). Verify 6.1–6.2 pass and `bash -n build-installer.sh` is clean

## 7. Integration + suite

- [ ] 7.1 Test (test-plan #X4), electron level (exemplar: existing `_electron-build.yml` steps invoking both gates — no workflow change expected): input this branch · trigger `ci-electron.yml` dispatch (all legs) · observable both gates exit 0, gate log lists `oauth4webapi@<ver>`, server log has `Loaded plugin "<id>"` for every server-entry bundled plugin (incl. `gmail`, `browser`, `chat-gateway`) and zero `Failed to load plugin` / `Skipping plugin`. A plugin failing activation in a clean HOME is fixed in-plugin, not exempted
- [ ] 7.2 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; record before/after `✓ Server bundled (<size>)` in the PR description

## 8. Docs

- [x] 8.1 Update DOX rows: `packages/shared/src/runtime-overlay/AGENTS.md` (`materialize-plugins.mjs` helpers), `packages/server/src/runtime-overlay/AGENTS.md` (`runtime-stager.ts` `plugin_deps_unresolved`), `packages/electron/AGENTS.md` (bundle-server, both gates, new `bundle-watch-paths.mjs`, build-installer), `scripts/AGENTS.md` + sidecars for the two gate tests, `packages/shared/src/__tests__` rows for new/changed tests; each `See change: bundle-plugin-third-party-deps`
- [x] 8.2 Delegate `docs/` prose to DocScribe (caveman style): `docs/electron-immutable-bundle.md` gains plugin-dep union, conflict/specifier rules, both gates, `plugin_deps_unresolved`; verify by grep for `plugin_deps_unresolved` and `collectPluginRuntimeDeps`
