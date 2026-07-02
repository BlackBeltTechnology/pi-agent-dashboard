## Context

The global OpenSpec profile section in the dashboard Settings panel renders "not found" / fails to load the current profile when the dashboard runs as a bundled Electron app on macOS (confirmed) and Windows (same bug class, partly mitigated). The `openspec` CLI is installed, resolvable, and its global config is correct.

Reproduced root cause on the affected macOS machine:

```
env -i HOME=… ~/.pi-dashboard/node_modules/.bin/openspec config list --json
  → env: node: No such file or directory   exit=127
(normal shell PATH) same command             → valid JSON, exit=0
```

The managed `openspec` bin is a `#!/usr/bin/env node` shebang script. It executes only when a binary literally named `node` is on the spawning process's PATH. Two facts about the current spawn machinery make that fragile in the bundle:

- **Unix has no node-wrap.** `nodeScriptToArgv` in `packages/shared/src/tool-registry/definitions.ts` node-wraps `.js` entry points **only on Windows** (`[node.exe, script.js]`). On unix it returns `[resolvedPath]` and trusts the `#!/usr/bin/env node` shebang.
- **The child PATH may lack a real `node`.** Electron spawns the server via `spawnFromSource`, whose env is built by `ToolResolver.buildSpawnEnv`. That prepends `MANAGED_BIN` (`~/.pi-dashboard/node_modules/.bin` — has `openspec`/`pi` symlinks, no `node`) and `dirname(pick.nodeBin)`. `pickNodeForServer` returns a real `<resources>/node/bin/node` in a healthy immutable bundle (so `node` IS on PATH), but on the `execpath-fallback` path returns the Electron binary (dir has `Electron`, not `node`), and `buildSpawnEnv` additionally **strips** `ELECTRON_RUN_AS_NODE` from children and never seeds `~/.pi-dashboard/node/bin`. So across install topologies (healthy bundle / corrupted-bundle fallback / legacy managed), a child `openspec` spawn is not guaranteed a resolvable `node`.

When the spawn dies (exit 127), `configListOrAsync` unwraps the failure to `null` **silently**; `GET /api/openspec/config` returns `200 { profile:"custom", workflows:[] }`; the Settings panel cannot match that to a real profile and shows "not found."

## Goals / Non-Goals

**Goals:**
- Managed Node-script CLIs (`openspec`, `pi`) execute from the bundled Electron server regardless of whether a binary named `node` is on the child PATH — deterministically, not by luck of install topology.
- A CLI-read failure for the global config is distinguishable from a genuinely empty profile, so the Settings UI can show a real error state instead of a fake-empty "not found."
- Preserve the existing Windows node-wrap behavior with no regression.

**Non-Goals:**
- Changing the on-disk config format, the config path (`~/.config/openspec/config.json`), or the pinned openspec CLI version.
- Reworking `pickNodeForServer` / immutable-bundle architecture.
- Fixing the separate (already-understood) UX gap that per-project OpenSpec UI is hidden in projects without an `openspec/` dir — out of scope here.

## Decisions

### Decision 1 — Node-wrap unix Node-script executor spawns (primary fix)

Extend the executor resolution so `openspec` and `pi` spawns produce `[<real node>, <entry>.js]` on **unix as well as Windows**, removing the dependency on the `#!/usr/bin/env node` shebang finding `node` on PATH.

Two coordinated pieces:

1. **Resolve the `.js` entry, not the `.bin` symlink.** The managed-bin strategy currently resolves `~/.pi-dashboard/node_modules/.bin/openspec` (a shebang symlink). For node-wrapping, the resolved path must be the actual `bin/openspec.js`. Prefer the `bare-import` / `managedModule` strategies (which resolve `bin/openspec.js` directly) ahead of the `.bin` symlink on unix, OR dereference the symlink to its `.js` target before `toArgv`.
2. **Generalize `nodeScriptToArgv` to node-wrap `.js` on unix.** When the resolved path matches `/\.js$/`, return `[nodePath, resolvedPath]` on every platform. `nodePath` comes from `registry.resolve("node")`; fall back to `process.execPath` only when it is a real `node`.

Edge case — server running under `ELECTRON_RUN_AS_NODE` (the `execpath-fallback`): `process.execPath` is the Electron binary, which behaves as `node` only with `ELECTRON_RUN_AS_NODE=1`. If the node-wrap has to fall back to `process.execPath` in that state, the spawn env for that child must set `ELECTRON_RUN_AS_NODE=1`. Preferred: ensure `registry.resolve("node")` yields the bundled/managed **real** node so this fallback is never hit.

**Why over alternatives:** deterministic — the interpreter is supplied explicitly, independent of PATH contents or install topology. Mirrors the already-proven Windows path (single code path, less divergence). The shebang approach is exactly what fails today.

### Decision 2 — Seed a real `node` dir into `buildSpawnEnv` — TRIED, then REVERTED as redundant

Originally proposed as defense-in-depth: add the managed `~/.pi-dashboard/node/bin` to the PATH `buildSpawnEnv` constructs, so any *other* shebang-based child spawn also resolves `node`.

**Outcome: reverted (commit `fix(ci): revert redundant buildSpawnEnv managed-node prepend`).** It was redundant — every caller already guarantees a real node dir on the child PATH: `process-manager` wraps with `prependManagedNodeToPath` (from `embed-managed-node-runtime`), and `server-launcher` / electron `launch-source` build the resolver with `processExecPath = pick.nodeBin` (the picked real node), so `buildSpawnEnv` already prepends its dir. It was also off the actual fix path — the openspec spawn goes through the runner's `toArgv` node-wrap (Decision 1), not `buildSpawnEnv`. And the extra `existsSync`/`os.homedir()` widened a pre-existing cross-file HOME-mutation race, flaking `process-manager-managed-path.test.ts` in CI.

**Net:** Decision 1 (node-wrap by absolute node path) is the sole fix; it removes the PATH dependency entirely, so seeding PATH was unnecessary. Decision 2 is retained here only as a rejected-alternative record.

### Decision 3 — Surface CLI-read failure instead of degrading to empty

Stop collapsing a failed `openspec config list` into an empty profile.

- The `GET /api/openspec/config` handler switches from `configListOrAsync(..., null)` to the `Result`-returning `configListAsync(...)`, inspects `.ok`, and on failure returns a distinct signal (e.g. HTTP 502/503 or `{ success:false, error:"openspec config read failed" }`) rather than a `200` with `workflows:[]`.
- The empty-vs-failure distinction propagates through `fetchGlobalOpenSpecConfig` so the Settings panel renders a "couldn't read OpenSpec config" state, separate from a genuine empty/custom profile.
- Keep the successful-read behavior intact, including the `custom`+expanded-set → `expanded` alias mapping.

**Why:** without this, even a correct exec fix leaves the diagnosis-hostile masking in place; any future CLI failure would again silently present as "not found." This is the defect that made the original bug invisible.

## Risks / Trade-offs

- **Resolving `.js` over the `.bin` symlink could change `source` in resolution trails / break tests asserting the `.bin` path.** → Update fixtures; keep managed-bin as a lower-priority fallback so behavior degrades sensibly.
- **`registry.resolve("node")` might itself fail in a degraded bundle.** → Node-wrap falls back to `process.execPath`; when that is the Electron binary, the runner's `buildSpawnEnvForArgv` sets `ELECTRON_RUN_AS_NODE=1` on the child spawn so it still runs as node.
- **Returning an HTTP error from `GET /config` could surface a scarier UI than today's silent empty.** → Intended: a clear "couldn't read config" beats a wrong "not found." Client must render it as recoverable (retry), not fatal.
- **Windows regression risk** from touching shared `nodeScriptToArgv`. → The change generalizes the unix branch only; the Windows branch keeps its exact existing shape. Cover with a unix + win32 argv test matrix.
- **Legacy managed-node topology** (`~/.pi-dashboard/node/bin`) not covered by `pickNodeForServer`. → Decision 2 explicitly seeds it; Decision 1 makes it moot when a real node resolves.

## Migration Plan

- Pure code change; no data migration, no config-format change. Ships in the normal release + Electron bundle rebuild.
- Rollback: revert the `definitions.ts` / `binary-lookup.ts` / `openspec-routes.ts` edits; on-disk config untouched, so no state cleanup.
- Validation gate: post-fix, `env -i HOME="$HOME" <bundled server env> openspec config list` succeeds, and the Settings panel loads `expanded` (10 workflows) on the confirmed config.

## Open Questions

- Does the affected user's install resolve to the healthy immutable bundle (`<resources>/node/bin/node`) or the `execpath-fallback`? Verifying `pickNodeForServer`'s result on that machine tells us whether Decision 1's node resolution needs the `ELECTRON_RUN_AS_NODE` fallback branch in practice or only for safety.
- Should the config-read error be a hard HTTP error (502/503) or a `200` with an explicit `{ readError: true }` flag? Trade-off between HTTP semantics and client-handling simplicity — settle before implementing the route + client edits.
- Should the node-wrap generalization apply to every Node-script executor in the registry (broadest fix) or only `openspec`/`pi` (narrowest, lowest regression risk)?
