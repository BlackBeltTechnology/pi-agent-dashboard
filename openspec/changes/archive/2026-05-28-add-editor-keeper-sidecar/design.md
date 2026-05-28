## Context

Today `editor-manager.ts` spawns `code-server` as a direct (non-detached)
child of the dashboard server. On dashboard restart the editor dies, its
in-memory id is forgotten, and `editor-pid-registry.cleanupOrphans()` kills
any survivor on the next boot. The browser's iframe (`/editor/<id>/`) breaks
because the id is fresh per spawn.

`packages/server/src/rpc-keeper/` already solves the analogous problem for
pi's stdin pipe: a detached, CJS-pure sidecar owns the child, listens on a
deterministic per-session UDS / named pipe, and persists PID + path so the
dashboard can reattach on boot. Spec at
`openspec/specs/rpc-keeper-sidecar/spec.md`. The shape transfers almost
verbatim. This design mostly copies decisions from that prior art and notes
where editor-specific concerns diverge.

## Goals / Non-Goals

**Goals**
- Code-server survives `pi-dashboard restart`, `pi-dashboard stop && start`,
  `/api/restart`, and graceful dashboard crash.
- Stable `editorId` per `cwd` across restarts → stable `/editor/<id>/`
  proxy URL → iframe survives without reload.
- Boot-time adoption replaces today's kill-orphans policy.
- Cross-platform (POSIX UDS + Windows named pipes).

**Non-Goals**
- Surviving an OS reboot (process state lost; deferred).
- Surviving an SIGKILL of the keeper itself (no double-keeper).
- Changing the `/editor/:id/*` proxy contract or any client code.
- Moving idle timeout into the keeper (kept in dashboard for simplicity).
- Replacing the data-dir / settings.json contract (handled by
  `fix-editor-settings-persistence`).

## Decisions

### Decision 1: Mirror rpc-keeper structure
New module `packages/server/src/editor-keeper/` with:
- `keeper.cjs` — CJS-pure, only Node built-ins
- `keeper-manager.ts` — server-side spawn / discover / write / kill

Rationale: matching layout makes future maintenance trivial; reviewers can
diff against `rpc-keeper/` to verify correctness.

### Decision 2: Detached, own session/PGID
Keeper SHALL be spawned `detached: true` with `stdio: ["ignore", logFd,
logFd]` and `setsid()` (POSIX) / `DETACHED_PROCESS` (Windows). Dashboard
SHALL NOT track the keeper's PID for its own shutdown — keeper outlives
parent by design. Mirrors rpc-keeper Decision 8.

### Decision 3: Socket / pipe path
- POSIX: `~/.pi/dashboard/editors/<editorId>.sock`
- Windows: `\\.\pipe\pi-editor-<editorId>`
- PID sidecar: `<sock>.pid` (POSIX), `<homedir>/.pi/dashboard/editors/pi-editor-<editorId>.pid` (Windows)

The `editorId` is **stable across restarts**: derived from `cwd` as
`sha256(cwd).slice(0,12)` (same scheme as the existing data-dir hash, so
data dir and editor id share the same folder-keyed identity). This replaces
today's `"editor-" + randomBytes(6)`. Side benefit: per-cwd uniqueness now
enforced by the id itself, removing one source of "ghost" instances.

Alternative considered: random id persisted in a sidecar. Rejected — adds a
round-trip on adoption and breaks if the sidecar is gone but the keeper is
alive.

### Decision 4: PID sidecar contract
```jsonc
{
  "editorId": "abc123def456",
  "keeperPid": 12345,
  "childPid": 12346,
  "port": 38291,
  "cwd": "/Users/x/proj",
  "dataDir": "/Users/x/.pi/dashboard/editors/abc123def456",
  "binary": "/usr/local/bin/code-server",
  "spawnedAt": "2026-05-27T22:00:00.000Z"
}
```
Written before keeper signals readiness on socket. Adopted by the dashboard
on boot.

### Decision 5: JSON-line command protocol
Same shape as rpc-keeper but bidirectional for this use case because the
dashboard needs to know exit status:

Commands (server → keeper):
- `{"cmd":"heartbeat"}` — no-op, keeps socket alive
- `{"cmd":"stop"}` — keeper SIGTERMs child, waits 5 s, SIGKILLs, exits
- `{"cmd":"getStatus"}` — keeper replies with current PID + port + uptime

Events (keeper → server, only on the responding connection):
- `{"event":"status", ...}` in response to `getStatus`
- `{"event":"child_exit","code":N,"signal":"..."}` broadcast to all
  connected clients when child exits, then keeper exits

Rationale: dashboard needs `child_exit` to update `editor_status` and clear
the in-memory entry. Simple JSON-line over UDS — no framing library.

### Decision 6: 3-way start in editor-manager
```ts
start(cwd):
  1. cwdIndex.has(cwd)                     → return existing in-memory
  2. await keeper-manager.probe(editorId)  → reattach, populate memory
  3. else                                  → keeper-manager.spawnKeeperFor(cwd)
```
Reattach steps:
- Read PID sidecar; verify keeperPid + childPid alive.
- Connect to socket; send `getStatus`; verify reply within 500 ms.
- Verify port still bound (TCP connect probe).
- Populate `instances` + `cwdIndex`; start fresh idle timer.

### Decision 7: Boot-time adoption replaces kill-orphans
`editor-pid-registry.cleanupOrphans()` flips to `adoptOrChooseToKill()`:

```
For each *.pid sidecar under ~/.pi/dashboard/editors/:
  ┌─ keeper alive + child alive + socket reachable
  │     → adopt (register in editor-manager, don't spawn)
  │
  ├─ keeper alive + child dead
  │     → send {"cmd":"stop"} to keeper, wait 1 s, SIGTERM keeper, unlink
  │
  ├─ keeper dead + child alive (rare: keeper crashed)
  │     → SIGTERM child via pgroup, unlink sidecar
  │
  └─ both dead
        → unlink sidecar
```

Adoption runs **before** the existing kill-orphans cmdline scan, so any
keeperless code-server lingering from before the change is still cleaned up.

### Decision 8: Idle timeout stays in dashboard
Each adoption restarts the idle timer at full duration. Trade-off: an
editor adopted after a 9-minute dashboard restart still gets the full 10
minutes before idle-stop, instead of stopping 1 minute later. Acceptable —
keeps keeper minimal and idle policy in one place.

### Decision 9: Stop semantics
`editor-manager.stop(id)` sends `{"cmd":"stop"}` to the keeper, then closes
the local socket. Keeper handles the SIGTERM → 5 s → SIGKILL escalation
(graceful window matches `fix-editor-settings-persistence`). Dashboard
removes the in-memory entry once the keeper sends `child_exit` (or after a
6 s fallback timer if the keeper itself is hung).

### Decision 10: stopAll on dashboard exit — config-gated, default OFF
Add a new boolean field `editor.stopOnDashboardExit` to `EditorConfig`
(`packages/shared/src/config.ts`), **default `false`**. When `false` (the
default), `stopAll()` on graceful dashboard shutdown SHALL be a no-op
against keepers — editors persist across `pi-dashboard stop` and
`/api/restart`. When `true`, `stopAll()` SHALL send `{"cmd":"stop"}` to
every keeper and wait for them to exit before the dashboard exits.

Exposed in the Settings UI (`SettingsPanel.tsx` → editor section) as a
labelled switch: **“Stop editors when dashboard exits”** with helper text
explaining that leaving it off lets tabs and dirty buffers survive a
dashboard restart.

Rationale: persistence is the design's headline feature, so it must be the
default. But some users (CI runners, multi-user kiosks, anyone who wants a
clean process tree on stop) need the old behaviour; a switch costs almost
nothing and avoids surprising them.

Explicit per-editor stop (`POST /api/editor/:id/stop`,
`editorManager.stop(id)`) is **unaffected by this flag** — user-initiated
stop always kills the keeper.

For test cleanup, expose a separate `forceStopAll()` for the test harness
that bypasses the flag.

### Decision 11: Keeper log location
`~/.pi/dashboard/editors/keeper-<editorId>.log`. Rotated never (small,
append-only, last-write-wins is fine). Mirrors rpc-keeper logging.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Adoption race: socket exists but keeper has just died | PID + socket probe both required; failed adoption falls through to spawn |
| Stable id is sha256 prefix — collision in 2 different cwds | 12 hex chars = 48 bits; collision in practice ≈ 0; matches existing data-dir hash so collision risk is identical to today |
| Multiple dashboards (e.g. dev + prod) fighting over same keeper | Each dashboard sees the same sidecar; first-to-adopt wins via filesystem `flock` on the `.pid` file (cross-platform via `open(O_EXCL)` lockfile) |
| User runs `pi-dashboard stop` expecting editor to stop | Add explicit notice in CLI: editor keepers persist; use `--stop-editors` flag or `POST /api/editor/:id/stop`. Default behavior preserves editors. |
| Keeper itself crashes mid-life | Child is orphaned; next dashboard boot detects "child alive + keeper dead", SIGTERMs child, cleans up. User loses tabs (but data dir has hot-exit) and respawns on next start. Acceptable. |
| `--bind-addr 127.0.0.1:<port>` port reuse on adoption | TCP connect probe in adoption verifies port is still listening on the keeper-owned PID; failed probe = stale, kill + respawn |
| Windows named-pipe quirks (no unlink, no FS visibility) | PID sidecar is authoritative on Windows; socket existence == named-pipe `connect()` succeeds. Mirrors rpc-keeper Windows handling. |
| Cross-platform `detached + setsid` (POSIX) vs `DETACHED_PROCESS` (Windows) | Use shared `spawnDetached` from `src/shared/platform/detached-spawn.ts` (existing primitive) |

## Migration Plan

1. Ship `fix-editor-settings-persistence` first.
2. Ship this change behind no flag — adoption falls through to spawn for any
   editor without a sidecar, so existing installs keep working.
3. On first dashboard restart post-upgrade, any in-flight editor without a
   keeper is killed by the existing `cleanupOrphans` fallback (kept). New
   editors get keepers.
4. Rollback: revert the diff. Existing keepers are then orphan code-server
   processes from the dashboard's perspective; `cleanupOrphans` sweeps them
   on next boot (the data-dir marker check still matches). Lose tabs once.

## Open Questions

- Settings switch resolved (Decision 10): `editor.stopOnDashboardExit`,
  default `false`, exposed in `SettingsPanel.tsx`. CLI flag
  `--stop-editors` deferred — the config field is sufficient; CLI can be
  added in a follow-up if requested.
- Should we expose a `pi-dashboard editors list` CLI subcommand for users
  to see / kill keepers without the dashboard running? Probably yes —
  belongs in a follow-up change.
- Idle-timeout-in-keeper: keep as a future option if users complain that
  reattached editors aren't auto-stopping. Not in scope here.
