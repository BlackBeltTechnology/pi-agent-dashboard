## 1. Preconditions

- [x] 1.1 Confirm no flow step invokes a built-in tool at the model layer, so `--no-builtin-tools` is safe for guarded sessions. — Confirmed (engine agents are `tools: read`; deterministic work is flow-node code).
- [x] 1.2 Confirm the working directory model: the plugin serves many workspaces (cwd per request), so guarding is keyed on origin ∪ registered cwd (not a single init-time cwd).
- [x] 1.3 Confirm `pi --no-builtin-tools` and repeatable `-e` behave as documented against the pinned pi version (usage.md: `--no-builtin-tools`/`-nbt`, `-e` repeatable).

## 2. Guarded-directory registry

- [x] 2.1 Host-side guarded-working-directory registry (register/unregister/query by cwd) — `packages/server/src/session-guard.ts` (`registerGuardedDir`/`unregisterGuardedDir`/`isGuardedDir`).
- [x] 2.2 The host registers a spawn's cwd as guarded when a plugin opts in (`opts.guard`), so client-spawned sessions in that workspace (the "Ask"/Kérdezz session) are guarded too.
- [x] 2.3 Plugin-originated spawns are guarded by ORIGIN as well (guard = origin ∪ guarded-cwd) — `resolveGuardForSpawn({cwd, origin})`.

## 3. `spawnPiSession` enforcement

- [x] 3.1 `spawnPiSession` resolves the guard (origin ∪ cwd) and folds it into spawn flags/env — `session-guard` + `SessionOptions.{guard,noBuiltinTools,loadExtensions,guardEnv}`.
- [x] 3.2 For a guarded spawn it injects `--no-builtin-tools` (via shared `sessionFlagsToArgv`) into the pi CLI args; no-op for unguarded cwds.
- [x] 3.3 Applies across every spawn mechanism (headless/tmux/wt) — guard flags flow through the shared `sessionFlagsToArgv`; guard env threaded via `buildSpawnEnv({extraEnv})`.

## 4. Extensible guard policy + tool-call folder guard

- [x] 4.1 `SessionGuardPolicy` is an open, extensible shape (`noBuiltinTools`, `allowedRoots`, `deniedTools`, room to grow) translated by `guardPolicyToSpawn` — new constraints need no spawn-call-site change.
- [x] 4.2 Tool-call containment guard extension shipped — `packages/server/src/session-guard-extension.ts` (blocks path args outside allowed roots via `fs.realpath` + Windows normalization; blocks denied tools), with unit-tested pure helpers. Loaded via `-e` when a folder policy is configured; OFF by default pending runtime verification (baseline = built-ins disabled, which already removes every fs/shell tool).

## 5. Cover both spawn paths

- [x] 5.1 Plugin spawn hook (`server.ts` `spawnSession`) marks its spawns guarded by origin; `PluginSpawnOptions.guard` added; invoice `session-link` passes `guard: true`.
- [x] 5.2 Generic client spawn path (`session-api`/`event-wiring`) is guarded automatically via the cwd registry inside `spawnPiSession` — no UI-side change.
- [x] 5.3 Verified via tests that origin, guarded-cwd, both, and neither resolve correctly, and that guard flags reach the pi argv.

## 6. Tests (faux/offline gate)

- [x] 6.1 Unit: guarded (origin/cwd) → `--no-builtin-tools` in argv; unregistered/unrelated → args unchanged. — `session-guard.test.ts`.
- [x] 6.2 Unit: origin ∪ cwd resolution (origin-only, cwd-only, both overlay, neither).
- [x] 6.3 Unit: containment helpers block a path outside roots (incl. symlink realpath) and allow one inside; folder policy loads the guard `-e` + passes allowed roots.
- [x] 6.4 Run the dashboard faux/offline gate (`npm test` + `npm run build`) green.

## 7. Docs

- [x] 7.1 Note the guarded-session policy in the relevant `AGENTS.md` (server + plugin).
- [x] 7.2 OS-level isolation recorded as optional/out-of-scope (not required for cwd containment); Gondolin no-Windows finding noted.
