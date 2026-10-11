# Test Plan — bundle-plugin-third-party-deps

Stage: design   Generated: 2026-10-05

No clarifications needed: every Triple slot is concrete (idle budget = existing
`VERDICT_TIMEOUT_MS = 120_000`; size has no threshold by design — explicit non-goal, so no perf row).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ebp: plugin third-party deps installed | EP | L1 | automated | tmp plugin `gmail-plugin` with `dependencies: {oauth4webapi: "^3.8.8", "@blackbelt-technology/pi-dashboard-shared": "x"}` | `collectPluginRuntimeDeps({ids:["gmail-plugin"], resolveSource, workspaceManifests:[]})` | returns exactly `{oauth4webapi: "^3.8.8"}` |
| E2 | ebp: dev/peer/optional not added | EP | L1 | automated | plugin with `devDependencies:{vitest}`, `peerDependencies:{react}`, `optionalDependencies:{fsevents}`, no `dependencies` | collect | returns `{}` |
| E3 | ebp: same id filter as materialization | decision table | L1 | automated | ids `[a, fixture-p, missing]`: `a` normal, `fixture-p` has `pi-dashboard-plugin.fixture:true` + dep `x`, `missing` has no package.json | collect AND `materializeBundledPlugins` on the same ids | union has no `x`; both skip the same ids (`[a]` materialized) |
| E4 | conflict rule: identical specifiers merge | EP | L1 | automated | plugins A, B and workspace `server` all declare `@fastify/rate-limit: "^11.2.0"` | collect | no throw; key present once with `^11.2.0` |
| E5 | conflict rule: plugin vs plugin | decision table | L1 | automated | plugin A `yaml:"^2.9.0"`, plugin B `yaml:"^1.10.0"` | collect | throws; message contains `yaml`, `A@^2.9.0`, `B@^1.10.0` |
| E6 | conflict rule: plugin vs bundle workspace | decision table | L1 | automated | plugin `jose:"^5.0.0"`, workspace manifest `server` `jose:"^6.0.0"` | collect | throws; message contains `jose`, plugin name, `server` |
| E7 | conflict rule: workspace-only dep ignored | EP | L1 | automated | workspace `server` declares `fastify:"^5"`; no plugin declares fastify | collect | `fastify` absent from result; no throw |
| E8 | specifier rule | decision table / BVA | L1 | automated | plugin specifiers: reject `file:../x`, `workspace:*`, `link:../y`, `npm:foo@1`, `git+https://h/r.git`, `user/repo`; accept `^1.2.3`, `1.x`, `>=1 <2`, `latest` | collect per specifier | each reject throws naming plugin + dep; each accept returns it |
| E9 | resolvability: lookup locations | EP | L1 | automated | `root/resources/plugins/p/package.json` deps `{a, "@s/b", c}`; `a` in `root/resources/plugins/p/node_modules/a/package.json`; `@s/b` in `root/node_modules/@s/b/package.json`; `c` absent | `findUnresolvedPluginDeps({pluginsDir: root/resources/plugins, rootDir: root})` | returns `[{plugin:"p", dep:"c"}]` |
| E10 | resolvability: bounded by rootDir | BVA | L1 | automated | dep `d` exists only in `parent/node_modules/d/package.json`, `rootDir = parent/root` | find | returns `[{plugin:"p", dep:"d"}]`; same dep placed at `parent/root/node_modules/d` → `[]` |
| E11 | resolvability: scoped name needs both segments | BVA | L1 | automated | `root/node_modules/@s/package.json` exists but `root/node_modules/@s/b/` absent; plugin dep `@s/b` | find | `@s/b` reported unresolved |
| E12 | resolvability: first-party deps checked; manifest-less dir skipped | decision table | L1 | automated | plugin `p` dep `@blackbelt-technology/x` absent; sibling dir `q/` with no package.json | find | returns `[{plugin:"p", dep:"@blackbelt-technology/x"}]`; no throw, nothing for `q` |
| E13 | repo invariant: real tree has a valid union | EP | L1 | automated | real `piDashboard.bundledPlugins` + real `BUNDLED_WORKSPACE_PKGS` manifests | collect | no throw; result contains `oauth4webapi`, `yaml`, `debug`, `discord.js`; no `@blackbelt-technology/*` key |
| E14 | ebp MODIFIED pi-runtime: synthetic root dependency contract | EP | L1 | automated | `packages/electron/scripts/bundle-server.mjs` source | parse `const bundlePkg = {…}` literal and the `collectPluginRuntimeDeps(` call | literal has `workspaces:` and `dependencies: pluginRuntimeDeps` and no other dependency entries; call passes `workspaceManifests`; no `pi-coding-agent`/`openspec`/`tsx` literal in the root |
| E15 | built-bundle gate: missing dep fails | EP | L1 | automated | fixture `BUNDLE_ROOT_DIR=<tmp>/b`, `BUNDLE_PLUGINS_DIR=<tmp>/b/resources/plugins`, `gmail-plugin/package.json` deps `{oauth4webapi}`, no node_modules | run `assert-bundled-plugins-complete.mjs` | exit 1; stderr contains `gmail-plugin → oauth4webapi` |
| E16 | built-bundle gate: outside-root dep does not count | BVA | L1 | automated | as E15 plus `<tmp>/node_modules/oauth4webapi/package.json` (above `BUNDLE_ROOT_DIR`) | run gate | exit 1; same pair reported |
| E17 | built-bundle gate: complete bundle passes + version log | EP | L1 | automated | as E15 plus `<tmp>/b/node_modules/oauth4webapi/package.json` `{version:"3.8.8"}` | run gate | exit 0; stdout contains `oauth4webapi@3.8.8` |
| E18 | built-bundle gate: presence behaviour unchanged | EP | L1 | automated | existing fixtures (plugin dirs without package.json) | run existing `assert-bundled-plugins-complete.test.mjs` cases with `BUNDLE_ROOT_DIR` set | all pre-existing assertions still pass |
| E19 | load gate: expected ids | decision table | L1 | automated | fixture `resources/plugins/`: `gmail-plugin` (`id:gmail`, `server` entry), `ui-only` (no `server`), `fx` (`fixture:true`, server entry) | `expectedServerPluginIds(dir)` | returns `["gmail"]` (manifest id, not dir name) |
| E20 | load gate: enable-all config | EP | L1 | automated | bundled manifest ids `[browser, gmail]` (browser `defaultEnabled:false`) | build gate config object | `{plugins:{browser:{enabled:true}, gmail:{enabled:true}}}` |
| E21 | load gate: verdict per id | decision table | L1 | automated | expected `[a, b, c]`; log: `Loaded plugin "a"`, `Failed to load plugin "b": Cannot find module 'x'`, `Skipping plugin "c" — missing/disabled dep: b` | `pluginLoadProblems(log, {plugins:[a,b,c]})` + verdict detector | problems name `b` and `c` (not `a`); detector reports all three as having a verdict |
| E22 | load gate: legacy call unchanged | EP | L1 | automated | existing healthy/dead/vacuous browser logs | `pluginLoadProblems(log)` with no options | identical results to today's tests (default `["browser"]`) |
| E23 | ebp MODIFIED freshness: derived watch list | EP | L1 | automated | real repo | run `bundle-watch-paths.mjs` | output contains `packages/gmail-plugin/package.json`, `packages/gmail-plugin/src`, `packages/client-utils/src`, `packages/client-utils/package.json`, `packages/server/package.json`, `packages/dist/index.html`, `packages/electron/scripts/bundle-server.mjs` |
| E24 | ebp MODIFIED freshness: shell consumes derivation + runs gate | EP | L1 | automated | `packages/electron/scripts/build-installer.sh` source | textual parse of the freshness block | iterates `bundle-watch-paths.mjs` output (no hardcoded `packages/server/src` list); invokes `assert-bundled-plugins-complete.mjs` after `bundle-server.mjs` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | load gate idle budget | tail/idle timeout (fake clock) | L1 | automated | 20 expected ids; fake clock; one verdict every 100 s (total 2000 s) | waiter returns all 20 verdicts, never times out (idle 120 s > 100 s gap) | simulated 2000 s |
| P2 | load gate idle budget boundary | BVA (fake clock) | L1 | automated | 3 ids; verdicts at t=10 s, t=20 s, then none | waiter returns at t ≤ 20 s + 120 s + one poll interval with the 3rd id missing | simulated 150 s |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | ero: nested-only dep rejected | fault-injection (abort) | L1 | automated | staged tree: plugin dep `yaml` only at `node_modules/@blackbelt-technology/<flows-plugin npm name>/node_modules/yaml` (no root `yaml`) | `stageRuntime` (npm source, fake deps) | rejects `RuntimeStageError` code `plugin_deps_unresolved`, message names `flows-plugin → yaml`; `versions/X.partial` absent; no `versions/X`; `request.json` `pending` unchanged |
| X2 | ero: dep above release root does not count | fault-injection | L1 | automated | `yaml` present only in `<runtimeDir>/node_modules` (above `versions/X.partial`) | `stageRuntime` | rejects `plugin_deps_unresolved` |
| X3 | ero: resolvable release stages | EP | L1 | automated | same fixture with `yaml` at `versions/X.partial/node_modules/yaml/package.json` | `stageRuntime` | resolves; `versions/X` exists; `request.pending = X` |
| X4 | dpl: bundled plugin third-party imports resolve (real bundle) | integration | electron | automated | real CI electron build of this branch, every leg | `_electron-build.yml` steps `assert-bundled-plugins-complete.mjs` + `assert-bundled-server-plugin-load.mjs` | both exit 0; gate log lists `oauth4webapi@<ver>`; server log has `Loaded plugin "<id>"` for every server-entry bundled plugin (incl. `gmail`, `browser`, `chat-gateway`) and zero `Failed to load plugin` / `Skipping plugin` |

---

## Coverage summary

- Requirements covered: 10/10 (ebp ADDED ×4, ebp MODIFIED ×3, dpl MODIFIED ×1, ero ADDED ×1, design D6 wiring)
- Scenarios by class: edge 24 · perf 2 · frontend 0 · error 4
- Scenarios by level: L1 29 · L2 0 · L3 0 · electron 1
- Scenarios by disposition: automated 30 · manual-only 0

## New infra needed

- none (P1/P2 need the load-gate waiter to take injectable `now`/`sleep`/`readLog` — a design detail of the existing script, not a new harness)
