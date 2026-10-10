# Install bundled plugins' third-party npm dependencies

## Why

Bundled first-party plugins ship to `resources/server/resources/plugins/<id>/` **without
`node_modules`** (copied by `materializeBundledPlugins` from
`packages/shared/src/runtime-overlay/materialize-plugins.mjs`, called by
`packages/electron/scripts/bundle-server.mjs`). At runtime they resolve modules only via
`resources/server/node_modules`, which is populated by `npm install --omit=dev` over the
synthetic bundle workspace (`BUNDLED_WORKSPACE_PKGS`).

PR #806 (merged) made every **first-party** dependency of a bundled plugin a bundle workspace and
added a transitive coverage test (`packages/shared/src/__tests__/bundled-plugins-complete.test.ts`).
**Third-party** npm deps remain uncovered: they resolve only if some bundled workspace happens to
depend on them (hoisted). Observed failure in CI Electron: `gmail-plugin` →
`Cannot find module 'oauth4webapi'`.

**Still failing on `develop` after #806** (2026-10-05). These are CI Electron linux-x64 runs on spike
branch `spike/native-ts-loader` (develop `27d6391e7` plus an opt-in TS-loader switch from
`fix-appimage-cold-boot-latency`). The Ubuntu 22.04 AppImage smoke booted the bundled server once
per loader:

| Run | Loader | Plugins loaded / failed | Failure |
|---|---|---|---|
| 37285545559 | native | 18 / 1 | `gmail`: `Cannot find package 'oauth4webapi' imported from /tmp/squashfs-root/resources/server/resources/plugins/gmail-plugin/src/serv…` |
| 37285545559 | jiti | 18 / 1 | `gmail`: `Cannot find module 'oauth4webapi'` |
| 37286703495 | native | 18 / 1 | `gmail`: same |

The failure doesn't depend on the TypeScript loader: it is a resolution gap in the bundle layout,
not a transpile problem. gmail is the only failing plugin, so the other server-reachable deps
listed below (`yaml`, `debug`, `discord.js`) currently resolve by hoisting. In the same runs, the
build-time plugin-load gate (`assert-bundled-server-plugin-load.mjs`) reported **zero** `Failed to
load plugin` lines. It boots the bundle in place at `<repo>/packages/electron/resources/server`
(`:45`, `cwd: root` at `:137`). From there Node's module resolution walks up into the monorepo's own
`node_modules/oauth4webapi`, which exists, so gmail resolves at build time and fails only once the
bundle is relocated (the extracted AppImage). This is the false green that the bounded walk-up in
design D4 and What Changes items 3–4 exist to close.

Third-party runtime deps of bundled plugins today (from each `package.json#dependencies`; the
other bundled plugins — roles, flows-anthropic-bridge, apple-tools, cost-estimator, quota —
declare first-party deps only):

| Plugin | Third-party deps |
|---|---|
| gmail-plugin | `oauth4webapi`, `@fastify/rate-limit` |
| keycloak-resolver-plugin | `jose` |
| chat-gateway | `discord.js` |
| browser-plugin | `debug`, `ws` |
| mcp-client-plugin | `ajv` (+ `@mdi/*`) |
| flows-plugin | `@fastify/rate-limit`, `yaml`, `dagre-d3-es` (+ `@mdi/*`) |
| automation-plugin | `yaml` (+ `@mdi/*`) |
| grammar-plugin | `diff` (+ `@mdi/*`) |
| mcp-server-plugin, system-one-plugin | `@fastify/rate-limit` |
| goal, subagents, kb, hermes-memory, blackhole | `@mdi/*` only |

Server-reachable and covered by no bundle workspace today: `oauth4webapi`, `yaml`, `debug`,
`discord.js` (see design.md audit). The rest work by hoisting luck or are client-only.

## What Changes

1. **Install plugin runtime deps into the bundle** — union the third-party `dependencies` of
   every bundled plugin into the synthetic bundle root `package.json` so `npm install --omit=dev`
   materializes them under `resources/server/node_modules`. Differing specifiers for the same
   package (across plugins, or plugin vs. bundle workspace) or non-registry specifiers → fail the
   build loudly.
2. **No client-only skipping** — install every declared dep (design D2).
3. **Built-bundle resolvability gate** — `assert-bundled-plugins-complete.mjs` asserts every
   declared dep of every bundled plugin resolves inside the bundle.
4. **Tighten the CI plugin-load gate** (`assert-bundled-server-plugin-load.mjs`) — enable every
   bundled plugin and require `Loaded plugin "<id>"` for each.
5. **Runtime-overlay parity** — the overlay stager shares `materializeBundledPlugins`; staging
   fails with `plugin_deps_unresolved` when a materialized plugin's dep does not resolve.
   Ordering: no `runtime-lock.json` release exists yet (`electron-runtime-release-pipeline` is
   unshipped), so no current release is blocked; that change's task 2.6 must hoist plugin deps
   before its first release.
6. **Bundle freshness** — `build-installer.sh` rebundles when any bundled workspace or bundled
   plugin (sources or `package.json`) changes.

Out of scope: AppImage boot latency (see `fix-appimage-cold-boot-latency`); third-party
(externally installed) plugins under `~/.pi/dashboard/plugins/`; `runtime-lock.json` generation
(`electron-runtime-release-pipeline`).

## Capabilities

- Modified: `electron-build-pipeline` — bundled plugins' runtime npm deps SHALL be installed;
  conflicting declarations fail the build; resolvability + every-plugin-loads gates; the
  synthetic root's `dependencies` SHALL be exactly the plugin-dep union; freshness watches plugins; the bundled-plugin
  list requirement is corrected to `piDashboard.bundledPlugins`.
- Modified: `dashboard-plugin-loader` — "First-party monorepo plugins SHALL ship inside the
  Electron bundle" extended to cover their runtime deps.
- Modified: `electron-runtime-overlay` — staging rejects plugins with unresolved deps
  (`plugin_deps_unresolved`).

Decisions (see design.md): union into the synthetic root `dependencies` (D1); install all,
no client-only skip (D2).

## Impact

- `packages/electron/scripts/bundle-server.mjs`, `assert-bundled-plugins-complete.mjs`,
  `assert-bundled-server-plugin-load.mjs`, `build-installer.sh`.
- `packages/shared/src/runtime-overlay/materialize-plugins.mjs`;
  `packages/server/src/runtime-overlay/runtime-stager.ts`.
- Tests: `packages/shared/src/__tests__/bundled-plugins-complete.test.ts`,
  `bundle-runtime-contract.test.ts`, `scripts/__tests__/assert-bundled-*.test.mjs`,
  `packages/server/src/__tests__/runtime-stager.test.ts`.
- Bundle size grows (e.g. `discord.js`). Compatibility: additive. Rollback: revert the commit.
- npm 10 `edgesOut` crash class (#806): bundle workspace copies keep `devDependencies` stripped.

## Discipline Skills

- `doubt-driven-review` — dep-resolution strategy is hard to reverse once shipped in installers.
- `security-hardening` — adds third-party code (auth libs `oauth4webapi`, `jose`) to the shipped
  bundle; specifier restrictions + resolved-version logging.
- `performance-optimization` / size / boot \u2014 not triggered as a budget task; size growth recorded
  in the PR (no CI size gate exists for `resources/server`).

## References

- PR #806 (`fix/electron-plugin-load-gate-log`, merged as `267512943`).
- Archived: `2026-04-21-bundle-first-party-extensions`, `2026-04-21-electron-offline-bundled-packages`,
  `2026-08-29-fix-grammar-settings-plugin-bundle`.
- Related pending: `electron-runtime-release-pipeline` (generates `runtime-lock.json`).
