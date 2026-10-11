## Context

See proposal.md — Why. Line refs are against `origin/develop` (includes #806, merge `267512943`).

- `bundle-server.mjs` copies `BUNDLED_WORKSPACE_PKGS` (`bundle-server.mjs:113`; post-#806: server,
  shared, extension, dashboard-plugin-runtime, mcp-client-plugin, bus-client, client-utils,
  document-converter, kb, mcp-server-plugin, session-distiller, system-one) with
  `devDependencies` stripped, materializes plugins (`:164`), writes a synthetic root `bundlePkg`
  (`:221`, `workspaces` only) and runs `npm install --omit=dev --no-package-lock` (`:335`).
- `materializeBundledPlugins` (`packages/shared/src/runtime-overlay/materialize-plugins.mjs:51`)
  copies each plugin into `resources/plugins/<id>/` **excluding nested `node_modules`** (`:41`).
  Node resolution from `resources/server/resources/plugins/<id>/` walks up to
  `resources/server/node_modules/` — the only place deps can come from.
- Spec `electron-build-pipeline` › "Bundled dashboard server ships the pi runtime" › scenario
  "Synthetic package.json declares no dependencies directly", pinned by
  `packages/shared/src/__tests__/bundle-runtime-contract.test.ts` ("bundlePkg declares workspaces
  and no dependencies"). D1 changes this — MODIFIED delta.
- Overlay stager `materializeOverlayPlugins` (`packages/server/src/runtime-overlay/runtime-stager.ts:126`)
  reuses the helper over an `npm ci` tree from `runtime-lock.json`; any dep npm nested under the
  plugin package is dropped. GitHub source ships the built bundle, so it inherits the bundle fix.
- Load gate (`assert-bundled-server-plugin-load.mjs`) enables only `PLUGIN_ID = "browser"`
  (`:41`, `:148`); verdict deadline `VERDICT_TIMEOUT_MS = 120_000` (`:40`); loader emits
  `Loaded plugin` / `Failed to load plugin` / `Skipping plugin` per id
  (`packages/dashboard-plugin-runtime/src/server/loader.ts:394,419,485,501`); disabled plugins log
  nothing.
- `build-installer.sh` freshness watch list hardcodes the 4 original workspaces + client + bundler;
  bundled plugins are not watched at all (pre-existing gap; widened by #806 and by D1).
- All 20 bundled plugins are published (non-private) workspaces, so
  `publish-correctness-verification` already enforces "every import in the packed file set
  (`npm pack --dry-run`) is declared in the plugin's own manifest". The Electron bundle copies the
  whole package dir, so a server import in a file outside `files` escapes that check; the load
  gate (D5) is the backstop. Declared `dependencies` are a good, not perfect, proxy.
- No active CI size gate covers `resources/server` (spec "Size budget enforcement in CI" targets
  the removed `resources/bundled-extensions/`); `bundle-server.mjs` only prints a final size
  report (`:629-631`).
- `fix-appimage-cold-boot-latency` attributes part of the AppImage cold-boot regression to plugin
  graph growth (incl. chat-gateway/`discord.js`). This change does not add plugins to the runtime
  load set (they already load in production); it only makes their deps present. The pre-packaging
  load gate boots a throwaway HOME, so it adds no jiti cache to the shipped tree.

Audit of bundled plugins' third-party `dependencies` vs. bundle-workspace deps (server-reachable =
imported outside `src/client/` / `.tsx`):

| Dep | Plugins | Server-reachable | Declared by a bundle workspace? |
|---|---|---|---|
| `oauth4webapi` | gmail | yes | **no** (observed failure) |
| `yaml` | flows, automation | yes | **no** (hoisting luck) |
| `debug` | browser (vendored playwright relay) | yes | **no** (hoisting luck) |
| `discord.js` | chat-gateway | yes | **no** |
| `jose`, `ws`, `diff`, `@fastify/rate-limit`, `ajv` | various | yes | yes, identical specifiers |
| `@mdi/js`, `@mdi/react` | many | no | yes, identical specifiers |
| `dagre-d3-es` | flows | no | no |

Today: 12 distinct third-party deps, zero specifier conflicts, zero non-registry specifiers.

## Goals / Non-Goals

**Goals:**
- One build-time source of truth: plugin `package.json#dependencies` drives what is installed.
- One shared resolvability check used by the bundle gate and the overlay stager.
- Load gate proves every bundled plugin actually loads.
- Bundle cache invalidates on any bundled-plugin change.

**Non-Goals:**
- Skipping client-only deps (D2).
- Pinning / lockfile for the bundle install (the native path keeps `--no-package-lock`; the
  Docker path `docker-make.sh:93` is unchanged).
- Import-graph scanning (covered by `publish-correctness-verification` at manifest level).
- Externally installed plugins; `runtime-lock.json` generation.

## Decisions

### D1 — Union plugin deps into the synthetic root `dependencies`

New pure helper `collectPluginRuntimeDeps({ ids, resolveSource, workspaceManifests })` in
`materialize-plugins.mjs` (plain ESM, already shared by build + stager). Id filtering is one
extracted predicate shared with `materializeBundledPlugins` (missing `package.json` / unparsable /
fixture → skipped) so the union can never drift from the materialized set. Returns
`Record<name, specifier>` of every non-`@blackbelt-technology/*` key in each plugin's
`dependencies`. Excluded: `peerDependencies` (`react`/`fastify` peers come from the Vite bundle /
server workspace), `devDependencies`, and `optionalDependencies` (none declared today; an optional
dep may legitimately be absent on a platform, which would turn D4 red — revisit if one appears).
`workspaceManifests` = parsed `packages/<ws>/package.json` for each `BUNDLED_WORKSPACE_PKGS`
entry, read by `bundle-server.mjs` from the repo source (pre-strip; only `dependencies` used).

`bundle-server.mjs` computes `pluginRuntimeDeps` before the literal and writes
`const bundlePkg = { name, private, workspaces, dependencies: pluginRuntimeDeps }`.
`bundle-runtime-contract.test.ts` ("bundlePkg declares workspaces and no dependencies") is
updated to assert the `dependencies` value is exactly `pluginRuntimeDeps` (no literal entries).
The MODIFIED "pi runtime" scenario keeps its intent and its name (validator requires the name):
root `dependencies` hold only the plugin union; pi/openspec/tsx still arrive only through the
server workspace. npm gives root deps the root `node_modules/` slot; the D4 gate verifies the
result rather than trusting hoisting.

Alternatives:
- **Synthetic `bundled-plugin-deps` workspace** (keeps root dep-free) — npm may nest a workspace's
  dep under `packages/<ws>/node_modules` when another package's transitive dep claims the hoisted
  slot; plugins would not see it. Root deps win the root slot. Rejected.
- **Plugins as bundle workspaces** — plugin source ships twice, every plugin needs devDeps
  stripping, registry-vs-`-ci` mismatch class (#806) multiplies. Rejected.
- **Per-plugin `npm install`** — N installs, duplicated trees, stale registry first-party deps.
  Rejected.

### D2 — Install all declared deps; no client-only skip

Only `dagre-d3-es` is a plugin-only client dep; `@mdi/*` is collected too (declared plugin deps)
but identical to what client-utils / plugin-runtime already install. A skip signal (manifest field
or import scanner) risks misclassifying a server import — the failure class being fixed. Revisit
if size becomes a problem. If plugin manifests later drop client-only deps, the union shrinks
automatically.

### D3 — Conflict + specifier rules

For each name collected in D1, every declaration among bundled plugins AND bundle workspaces
(`BUNDLED_WORKSPACE_PKGS` manifests) SHALL use the identical specifier string; otherwise throw
listing `name: <pkg>@<spec>, …`. Rationale: two copies of an auth/crypto/http lib (`jose`,
`@fastify/rate-limit`) split across server and plugin is a silent risk; string equality is simple,
deterministic, and today's tree already agrees. A plugin-declared specifier containing `:` or `/`
(`workspace:`, `file:`, `link:`, `portal:`, `git+…`, `http(s):`, `npm:` aliases, `user/repo`
shorthand) is rejected — semver ranges and dist-tags never contain either.

### D4 — Shared resolvability check, bounded walk-up

New pure helper `findUnresolvedPluginDeps({ pluginsDir, rootDir })` in `materialize-plugins.mjs`:
for each `pluginsDir/<id>/package.json` (a dir without one is skipped — the presence gate and
`materializeBundledPlugins` already require it), for each key in `dependencies` (first- and
third-party),
walk from `pluginsDir/<id>` up to and including `rootDir`, checking
`<dir>/node_modules/<name>/package.json` exists (scoped names → two segments). Returns sorted
`[{ plugin, dep }]`. Existence, not `require.resolve`: strict `exports` may hide `package.json`,
and nothing is executed. Every npm-installed package has a root `package.json`. The `rootDir` bound
stops a stray `~/node_modules` or the monorepo tree from producing a false green. Bound: checks
declared deps, not import sites (see Context — manifest completeness is enforced elsewhere).

Consumers:
- `assert-bundled-plugins-complete.mjs` — after the presence check, `rootDir` = `BUNDLE_ROOT_DIR`
  env, default `dirname(dirname(BUNDLE_PLUGINS_DIR))` (= `resources/server`); exit non-zero listing
  pairs. On success it prints `<dep>@<installedVersion>` for every resolved third-party plugin
  dep. Runs in CI on every electron leg (`_electron-build.yml:381`) and, added by this change,
  from `build-installer.sh` right after a (re)bundle. Unit-test fixtures always set
  `BUNDLE_ROOT_DIR` explicitly so the default can never resolve against a shared temp root.
- `runtime-stager.ts` `materializeOverlayPlugins` — after the set check, `rootDir` = staged release
  root; throw `RuntimeStageError("plugin_deps_unresolved", ...)` (existing path removes `.partial`,
  leaves request untouched).

### D5 — Load gate enables and requires every bundled plugin

`assert-bundled-server-plugin-load.mjs` reads manifest ids from
`<bundle>/resources/plugins/*/package.json` (fixtures excluded) — only plugins whose manifest
declares a `server` entry, since a server-less plugin is marked loaded without any log line
(`loader.ts` client-only branch) — writes `config.json.plugins.<id>.enabled = true` for all
bundled plugins, and polls until every expected id has a terminal line — `Loaded`,
`Failed to load`, or `Skipping`. `VERDICT_TIMEOUT_MS` becomes an **idle** budget: it restarts
whenever a new verdict line appears, so 20 sequential activations are not squeezed into a
budget sized for one, while a hung activation still times out.
Ids are **manifest ids** (`gmail`), which the loader uses for config and log lines; directory
names (`gmail-plugin`) only locate manifests. `pluginLoadProblems(text, { plugins })` reports ids
lacking `Loaded plugin "<id>"`, any `Failed to load plugin`, any `Skipping plugin`; with no
options it keeps today's default (`["browser"]`), and `{ plugin }` stays accepted, so existing
tests stay valid. Keeps the browser/tsconfig premise and log-tail dump.

Stricter than the clean-install QA smoke (`dashboard-plugin-loader` › "Clean-install QA boot
proves plugins actually load", where a dependency-gated plugin is not a failure): that smoke
installs an arbitrary subset into a clean VM; this gate boots the complete shipped set with every
plugin enabled, so a `Skipping` line can only mean a failed dependency (already reported) or a
cycle — both defects. Unmet declared *requirements* do not emit `Skipping` (probed after load,
`loader.ts` requirement probes), so they cannot trip this gate.

### D6 — Freshness watch list derived, not hardcoded

`build-installer.sh` derives the watch set: `packages/<ws>/src` + `packages/<ws>/package.json` for
each `BUNDLED_WORKSPACE_PKGS` entry, `packages/<id>/src` + `packages/<id>/package.json` for each
`piDashboard.bundledPlugins` id, plus `packages/server/package.json`, the built client and
`bundle-server.mjs`. Lists come from a small new script `packages/electron/scripts/bundle-watch-paths.mjs`
(prints one path per line; `BUNDLED_WORKSPACE_PKGS` read from `bundle-server.mjs` via the same
regex the tests use, ids via `readBundledPluginIds`) so the shell never re-hardcodes them and the
derivation is unit-testable. After a (re)bundle, `build-installer.sh` runs
`assert-bundled-plugins-complete.mjs` (D4).

## Risks / Trade-offs

- [Bundle size grows, chiefly `discord.js`; no CI size gate covers `resources/server`] → accepted,
  unmitigated by a gate. Record before/after `✓ Server bundled (<size>)` in the PR description.
- [Floating ranges at build time, now incl. auth libs `oauth4webapi`, `jose`] → pre-existing for all
  bundle deps; the D4 gate logs resolved `name@version` for every plugin dep so a release's
  versions are auditable. Lockfile pinning is a separate change.
- [Enabling all plugins in the load gate: an activation needing credentials could throw in a clean
  HOME] → real defect (plugins must degrade, not fail activation); fix in-plugin, no exemption.
  Gate runtime bounded by the existing overall `VERDICT_TIMEOUT_MS`.
- [String-equality rule rejects compatible ranges (`^2.9.0` vs `^2.8.0`)] → loud, trivially fixed
  by aligning declarations.
- [Overlay: a release whose lock leaves a plugin dep nested under the plugin package becomes
  un-stageable (`plugin_deps_unresolved`) until `electron-runtime-release-pipeline` hoists it] →
  intended: the alternative is activating a runtime with a dead plugin. Staging fails before
  activation; current runtime and bundled fallback untouched. Cross-change task added to
  `electron-runtime-release-pipeline/tasks.md` (lock tree must hoist every bundled plugin dep).
- [Declared-deps proxy misses an undeclared import] → `publish-correctness-verification` gates
  manifest completeness for every (published) bundled plugin; the load gate catches the rest.

## Migration Plan

Build-time plus one new stager error code. Rollback = revert the commit: root loses `dependencies`,
gates and watch list return to prior behaviour; no persisted state.
