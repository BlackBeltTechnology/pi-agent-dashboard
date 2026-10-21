# Electron Immutable Bundle

Architectural invariant: Electron app bundle read-only at runtime. No code under `<resourcesPath>/` mutates after install. No `npm install` ever runs after the app ships.

## Path layout

```
<resourcesPath>/
  node/
    bin/node               # POSIX
    node.exe               # Windows
  server/
    node_modules/
      @blackbelt-technology/pi-dashboard-server/
        src/cli.ts         # server entry
      @earendil-works/pi-coding-agent/   # pi
      @fission-ai/openspec/              # openspec
      tsx/                                # ts loader
      fastify/  ws/  node-pty/  jiti/  ...
```

pi / openspec / tsx ship as regular `dependencies` of `@blackbelt-technology/pi-dashboard-server`. `bundle-server.mjs` installs the runtime tree at build time: floating `npm install --omit=dev` by default, or pinned release-lock install with `--release-lock=<X>` (see [Release-lock bundle install](#release-lock-bundle-install)). Result copied into `<resourcesPath>/server/node_modules/`. Read-only thereafter.

## Update path

electron-updater replaces the whole `.app` / `.exe` / `.AppImage`. No in-app installer. No partial updates. No file writes into bundle.

Standalone (`npm i -g`) arm and bridge arm keep the pi-core update endpoint for in-place pi-core upgrades. Electron arm hides that UI: `useLaunchSource()` returns `"electron"` → `UnifiedPackagesSection` skips Core sub-group + `App.tsx` skips `<PiUpdateBadge />`.

## Runtime overlay

Second runtime location, opt-in. Bundle stays immutable. Dashboard runtime — server, web client, bridge extension, first-party plugins, pi/openspec/tsx — runs from `~/.pi/dashboard/runtime/versions/<X>/` instead of `<resourcesPath>/server/`. Bundle untouched. Bundle = final fallback.

Unit of update = one locked runtime release **X**. `runtime-lock.json` ships inside `@blackbelt-technology/pi-dashboard-server@X`; pins every package exactly. Not an in-place package mutation — whole runtime replaced.

`getRuntimeOverlayDir()` = `<configDir>/runtime` = `~/.pi/dashboard/runtime/`.

```
~/.pi/dashboard/runtime/
  request.json          # SERVER writer only
  state.json            # ELECTRON writer only
  versions/<X>/
    package.json        # synthetic root, deps = lock roots
    package-lock.json   # runtime-lock.json of X
    node_modules/...    # npm ci --omit=dev result
    resources/plugins/  # materialized first-party plugins
    runtime-manifest.json
```

Server entry: `versions/<X>/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts`. Bridge extension: `versions/<X>/node_modules/@blackbelt-technology/pi-dashboard-extension`. Web client: resolved through `node_modules/@blackbelt-technology/pi-dashboard-web` the same way as `client-dist.ts`.

### One writer per file

- `request.json` — server only. `source` (`bundled|npm|github`), `sourceEpoch` (uuid, created with file), `sourceSeq` (int ≥ 1, +1 per selection), `channel`, `pin`, `pending`, `pendingNonce`, `activateNonce`.
- `state.json` — Electron only. `localPath`, `localBinding {epoch,seq}`, `current`, `previous`, `bad`, `attempts`, `handledNonce`, `handledPendingNonce`, `lastFailure`.

Both writers: atomic tmp+rename (Windows EPERM/EBUSY retry), preserve unknown keys, missing/corrupt file → defaults, never throw. Effective source derived, not stored (`deriveEffectiveSource()`): `local` only when `state.localPath` set AND `state.localBinding` equals request `{sourceEpoch, sourceSeq}`. Local can only turn off, never on, without an app-menu action.

### Sources

| Source | Meaning |
|---|---|
| `bundled` | No overlay (default). `<resourcesPath>/server/`. |
| `npm` | Stage release X: `runtime-lock.json` from server@X → synthetic root → `npm ci --omit=dev` (bundled Node/npm, `.npmrc` honoured). |
| `github` | Download release asset `vX` + verify `.sha512` → extract. |
| `local` | Link mode. Run checkout in place, copy nothing. Set from app menu only (`Runtime → Use Local Folder…`). |

The server never selects `local`. No `/api/runtime/*` route sets a local path; `/api/runtime/source` rejects `local` and any `localPath` field. Selecting any source in Settings bumps `sourceSeq` and turns local off.

### Staging + activation

Stager installs X into `versions/X.partial/`, lockstep-checks every `@blackbelt-technology/*` package == X, materializes first-party plugins into `resources/plugins/`, writes `runtime-manifest.json`, renames to `versions/X/`, sets `pending`. Never activates. Any failure removes `.partial`; `request.json` untouched.

After plugin set check, `findUnresolvedPluginDeps` against staged root. Failure → `RuntimeStageError` code `plugin_deps_unresolved` (`.partial` removed, request untouched).

Activation is Electron-owned. Server writes `activateNonce`; Electron watcher stops old server, gates, re-points extension, spawns X, health-gates, commits or rolls back. Full sequence: [electron-bootstrap-flow.md](./electron-bootstrap-flow.md).

### runtime-manifest.json

`{ version, minShellVersion, nodeEngines, origin, integrity?, piVersion?, installMode?, lockVersion? }`. `parseRuntimeManifest()` / `writeRuntimeManifest()` shared by the build script (`bundle-server.mjs`) and runtime code.

- `installMode`: `release-lock` | `floating`. Optional.
- `lockVersion`: X of pinned `runtime-lock.json`. Set only when `installMode` = `release-lock`.

### pi follows the runtime

Overlay is a locked release X. `runtime-lock.json` pins pi/openspec/tsx exactly, so `piVersion` in `runtime-manifest.json` follows the runtime, not the shell. Opt-in only: source `bundled` keeps pi-on-app-release behaviour. Deliberate, overlay-scoped reversal of the `eliminate-electron-runtime-install` rule.

### Compatibility gate

Electron refuses a runtime it cannot host, before spawn (`evaluateRuntimeCandidate()` + preflight):

- `runtime-manifest.minShellVersion <= app.getVersion()` — else `requires_app >=<minShellVersion>`.
- Shell's bundled Node satisfies `runtime-manifest.nodeEngines` (server `engines.node` range; node-pty 1.x is N-API → range, not equality) — else `node_engines <range>`.
- Required files exist: server `cli.ts`, web `dist/index.html`, extension entry, `resources/plugins/` (`preflightOverlay`). Local requires `packages/server/src/cli.ts`, `packages/client/dist/index.html`, `packages/extension`, `node_modules` (`preflightLocal`).

Local link runs under the shell's bundled Node, never system Node; refused `node_engines <range>` when the checkout root `package.json#engines.node` excludes it.

### Retention + fallback

Keep `current` + `previous`. `pruneVersions()` deletes every other `versions/*` after commit (`*.partial` is the stager's). Peak disk ≈ 3× runtime size during staging (partial + current + previous), 2× at steady state. A `bad` runtime is never retried automatically; explicit Update/Activate or re-picking the local folder clears `bad` + `attempts`. An overlay failing compat, preflight, or the health gate never stops the app starting — the bundle catches it.

## Legacy `~/.pi-dashboard/`

Pre-R3 builds installed pi/openspec/tsx into `~/.pi-dashboard/node_modules/` at runtime. R3 leaves that dir untouched. `detectLegacyManagedDir({ homedir })` in `packages/shared/src/legacy-managed-dir.ts` returns `{present:true, path, pkgCount, sizeMb}` when detected; Doctor surfaces a warning-severity advisory ("Legacy install directory"). Server CLI logs the path once at startup. Safe to delete manually (`rm -rf ~/.pi-dashboard`).

## Bundled plugin dependencies

Bundled plugins ship to `resources/server/resources/plugins/<id>/` WITHOUT `node_modules`. `materializeBundledPlugins` (`packages/shared/src/runtime-overlay/materialize-plugins.mjs`) excludes nested `node_modules`. Plugins resolve modules only via `resources/server/node_modules`.

Third-party plugin deps hoist to root `node_modules` at build. `bundle-server.mjs` writes synthetic root `package.json` with `dependencies: pluginRuntimeDeps` = `collectPluginRuntimeDeps({ids, resolveSource, workspaceManifests})`: union of bundled plugins' third-party `dependencies`. Excludes `@blackbelt-technology/*`, `peerDependencies`, `devDependencies`, `optionalDependencies`. Floating mode: `npm install --omit=dev` places them at root `node_modules` slot. Release-lock mode: same union must equal lock root third-party deps (see below). pi/openspec/tsx still arrive only through the server workspace.

Specifier rules (build fails, `✗` + exit 1): every declaration of a collected name across bundled plugins AND `BUNDLED_WORKSPACE_PKGS` manifests must be identical string. Plugin specifier with `:` or `/` (`file:`, `workspace:`, `link:`, `git+`, `npm:` alias, `user/repo`) rejected. Fix = align declarations.

`findUnresolvedPluginDeps({pluginsDir, rootDir})`: fs-existence check of `node_modules/<dep>/package.json` from plugin dir up to and including `rootDir`, never above. Monorepo/`~` node_modules cannot mask missing dep. A dep npm nested under the plugin package fails.

Motivating failure: gmail plugin `Cannot find module 'oauth4webapi'` in extracted AppImage. Old build-time gate stayed green — booted bundle inside repo, Node walked up into monorepo `node_modules`.

See change: bundle-plugin-third-party-deps

## Release-lock bundle install

Pins bundle third-party tree to published lock of server release X. Floating install not used for release builds.

Flag: `node packages/electron/scripts/bundle-server.mjs --release-lock=<X>`.
- Only accepted form. Bare flag, space-separated value, empty value, combined with `--source-only`, or `X` ≠ server workspace version → exit non-zero before any work.

Caller: `_electron-build.yml` input `release_lock` → `--release-lock`.
- `publish.yml`, `nightly.yml`: `true`.
- `ci-electron.yml`, `ci-e2e-electron.yml`: unset → floating.

Floating command (unset): `npm install --omit=dev --no-audit --no-fund --no-package-lock`.

Release-lock steps:
1. `fetchPublishedLock`: `npm pack @blackbelt-technology/pi-dashboard-server@X --prefer-online`. 3 attempts. Archive listing checked via shared `runtime-overlay/archive-safety.mjs`. Root `version` must equal X. Reads `runtime-lock.json`.
2. `rebaseRuntimeLock` (`packages/electron/scripts/lib/release-lock.mjs`):
   - Bundled workspaces → linked to `packages/<dir>`.
   - `@blackbelt-technology/pi-dashboard-web` + non-workspace bundled plugins → removed.
   - Other `@blackbelt-technology/*` → throw.
   - Third-party → kept verbatim. Throw if missing `integrity` or non-https source. Loopback `http` allowed (nightly Verdaccio). `inBundle` entries exempt.
   - Root → synthetic name `pi-dashboard-bundled-server`, version X, deps = bundle workspaces + plugin union.
   - Plugin union must equal lock root third-party deps.
3. Write `package-lock.json`.
4. `npm ci --omit=dev --no-audit --no-fund --allow-remote=all`. Exit status checked.
5. `auditInstalledTree`:
   - Installed third-party ⊆ lock at same key + version.
   - First-party entries = symlinks to `packages/<dir>`.
   - No `packages/<dir>/node_modules`.
6. `package-lock.json` removed in `finally`.

Fail closed. Any step error → build fails. No fallback to floating install.

Manifest: `runtime-manifest.json` `installMode: release-lock`, `lockVersion: X`.

Gate: `packages/electron/scripts/assert-release-lock-bundle.mjs` reads `release_lock` boolean. Mismatch with bundle manifest → build fails.

Release-path checks:
- `scripts/lint-runtime-lock.mjs --version X` runs rebase as check.
- `publish.yml`: runs between `scripts/generate-runtime-lock.mjs` and server `npm publish`. Publish irreversible → check gates it.
- `nightly.yml`: runs same check via `scripts/nightly-verdaccio-publish.mjs`.

Nightly publish order (`scripts/nightly-verdaccio-publish.mjs`):
1. All packages except server + root.
2. Lock + lint.
3. Server.
4. Root.

Release path runs on 6 nightly legs.

See change: pin-electron-bundle-dependency-tree

## Bundle guardrails

- `packages/electron/scripts/bundle-server.mjs` Phase 1 GO/NO-GO: asserts `node-pty/prebuilds/{darwin-arm64,darwin-x64,linux-x64,win32-x64}/` exist after `npm install --omit=dev`. Build fails loudly on missing prebuilds.
- `scripts/verify-release-deps.mjs` blocks release if pi/openspec/tsx/node-pty/jiti regress below pinned floor.
- Repo-lint `packages/shared/src/__tests__/no-managed-dir-reference.test.ts` walks `packages/electron/src/lib/`, `packages/server/src/`, `packages/shared/src/`. Fails when a file references `.pi-dashboard` outside the explicit allowlist (detector + read-only probes + standalone-arm-only pi-core update writes).
- `packages/electron/scripts/assert-release-lock-bundle.mjs`: release-lock build gate. Checks manifest `installMode` / `lockVersion` against `release_lock` input. See [Release-lock bundle install](#release-lock-bundle-install).
- Gate 1 `packages/electron/scripts/assert-bundled-plugins-complete.mjs`: presence check then resolvability. Failure lists `plugin → dep`; success prints `<dep>@<installedVersion>`. Env `BUNDLE_ROOT_DIR` (default `dirname(dirname(BUNDLE_PLUGINS_DIR))` = `resources/server`). Runs on every CI electron leg and from `build-installer.sh` after a rebundle.
- Gate 2 `packages/electron/scripts/assert-bundled-server-plugin-load.mjs`: enables every bundled server-entry plugin (temp-HOME `config.json`), requires `Loaded plugin "<id>"` for each, zero `Failed to load plugin` / `Skipping plugin`. `VERDICT_TIMEOUT_MS` (120000) idle budget, restarts on each new verdict.
- `build-installer.sh` freshness watch list derived by `packages/electron/scripts/bundle-watch-paths.mjs`: bundle workspaces + bundled plugins `src` + `package.json`, server manifest, built client, bundler.

## What broke before R3

Pre-R3 Electron ran first-run `npm install` from offline cacache into `~/.pi-dashboard/`. Failure modes: GCM hang on Windows (private repos), AppImage path collision, jiti version skew across system vs. managed pi, stale managed-dir under app version bump, offline-cacache SHA-256 mismatches, recursive bridge auto-start during install, version-marker stale-cache cascades.

R3 deletes the whole pyramid: no installable list, no list-driven reconcile, no preflight reconcile step, no reinstall affordance, no bundle-extract step, no offline-packages bundle, no managed-package allowlist, no bootstrap REST routes, no bootstrap banner, no bootstrap-status client hook.

## Regression rules

- Any new `npm install` / `fs.writeFile` / `fs.cp` writing into `<resourcesPath>/` is a violation. Use electron-updater.
- Any new write into `~/.pi-dashboard/` from `packages/electron/` or `packages/server/` requires entry on `no-managed-dir-reference.test.ts` allowlist with explicit rationale.
- Any reintroduction of an installable list, runtime bootstrap-install pyramid, bootstrap-state store, bootstrap banner, or bootstrap-status client hook blocks release.
