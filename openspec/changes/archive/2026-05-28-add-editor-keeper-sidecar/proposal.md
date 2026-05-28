## Why

The dashboard server spawns `code-server` as a direct child. When the
dashboard restarts (graceful, crash, or `/api/restart`), `editor-manager`
SIGTERMs every code-server it owns and `editor-pid-registry.cleanupOrphans()`
kills any survivors on the next boot. Users lose:

- Open tabs / editor layout (workspaceStorage not flushed in time).
- The iframe URL (`/editor/<id>/`) — id is `randomBytes(6)` per spawn, so the
  browser sees a "new" editor on every restart and loses any in-memory state.
- Several seconds of warm-up while code-server reinitialises extensions.

Pi already solves the equivalent problem for its own RPC stdin via the
`rpc-keeper` sidecar (`packages/server/src/rpc-keeper/`). The shape transfers
cleanly to code-server: a detached CJS-pure keeper owns the child, listens on
a per-editor UDS / named pipe, persists `{id, pid, port, cwd, dataDir}` to a
sidecar file, and outlives the dashboard server. On boot the dashboard
discovers keepers, probes their sockets, and reattaches.

## What Changes

- New module `packages/server/src/editor-keeper/`:
  - `keeper.cjs` — CJS-pure sidecar. Args: `<editorId> <cwd> <port> <binary>
    <dataDir>`. Spawns code-server, owns stdio, listens on
    `~/.pi/dashboard/editors/<id>.sock` (POSIX) or
    `\\.\pipe\pi-editor-<id>` (Windows). Persists
    `~/.pi/dashboard/editors/<id>.pid` with keeperPid + childPid + port +
    cwd + dataDir + spawnedAt. Accepts JSON-line commands: `heartbeat`,
    `stop`, `getStatus`. On child exit writes `exitCode` to sidecar and
    exits.
  - `keeper-manager.ts` — server-side: `spawnKeeperFor(cwd, theme)`,
    `discoverExistingKeepers()`, `writeCommand(id, cmd)`,
    `killKeeper(id)`. Mirrors `rpc-keeper/keeper-manager.ts` shape.
- `editor-manager.start()` becomes 3-way:
  1. existing in-memory instance for this cwd → return,
  2. live keeper sidecar for this cwd → **reattach** (reuse same `id`, port),
  3. else → spawn fresh keeper.
- `editor-pid-registry` semantics flip from **kill orphans** to **adopt
  orphans**: on boot, `discoverExistingKeepers()` runs first; only keepers
  whose socket probe + cmdline check fail are killed.
- Stable `editorId` across restarts → stable `/editor/<id>/` proxy URL →
  iframe survives a dashboard restart without reload.
- Idle timeout stays in the dashboard (resets on each reattach); not moved
  into the keeper — keeps the keeper minimal.
- New config field `editor.stopOnDashboardExit: boolean` (default `false`)
  controls whether graceful dashboard shutdown also stops editor keepers.
  Exposed in the Settings UI as a labelled switch — default OFF so tabs
  survive a restart. Explicit per-editor stop is unaffected.
- Theme updates remain file-based via `settings.json`; keeper does not
  participate.
- Cross-platform: POSIX UDS + named pipes on Windows, mirroring the
  rpc-keeper precedent (Decision 3 in
  `add-rpc-stdin-dispatch-with-keeper-sidecar/design.md`).
- Logs: `~/.pi/dashboard/editors/keeper-<id>.log`.

## Capabilities

### New Capabilities

- `editor-keeper-sidecar`: detached CJS-pure sidecar that owns a
  code-server child, exposes a per-editor UDS / named pipe, and persists
  its PID + port so the dashboard can reattach across restarts.

### Modified Capabilities

- `editor-manager`: 3-way start (in-memory → reattach → spawn); stable
  `editorId` per cwd across restarts; spawning delegated to keeper.
- `editor-detection`: unchanged.
- (No `editor-pid-registry` spec exists today; behaviour change captured in
  `editor-keeper-sidecar` requirements and `editor-manager` deltas.)

## Impact

- New: `packages/server/src/editor-keeper/{keeper.cjs,keeper-manager.ts}`.
- Modified: `packages/server/src/editor-manager.ts` (3-way start, delegate
  spawn to keeper), `packages/server/src/editor-pid-registry.ts` (adopt
  before kill), `packages/server/src/server.ts` boot wiring (call
  `discoverExistingKeepers()` before `cleanupOrphans()`),
  `packages/shared/src/config.ts` (new `stopOnDashboardExit` field +
  default + parser), `packages/client/src/components/SettingsPanel.tsx`
  (new switch in editor section).
- No client-side changes — `/editor/<id>/` proxy URL stays stable thanks to
  id-reuse on adoption.
- New on-disk files under `~/.pi/dashboard/editors/`: `<id>.sock`,
  `<id>.pid`, `keeper-<id>.log`. Cleaned up on `stop()` and on keeper exit.
- Should land **after** `fix-editor-settings-persistence` so the persistence
  win is available without depending on the keeper.
- Borrows pattern + design rationale from
  `openspec/changes/add-rpc-stdin-dispatch-with-keeper-sidecar/` and
  `packages/server/src/rpc-keeper/` (read these before designing).
