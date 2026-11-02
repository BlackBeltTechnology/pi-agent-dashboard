# Proposal

## Why

GitHub issue #914, a follow-up from `fix-session-reclaim-tmux` (decision R7).

After a server restart, `cleanupOrphans` reloads headless entries from
`~/.pi/dashboard/headless-pids.json`. It checks only that the pid is alive
(`isProcessAlive`) and gives the reloaded entry a dummy handle
(`packages/server/src/spawn-process/headless-pid-registry.ts:651,674`).
While the server was down, the pid may have been reused by an unrelated process.
That process is then trusted at three points:

1. **Reclaim.** The recycled pid is adopted as a session entry. A later kill, or a
   bridge relinking by pid, acts on it (`headless-pid-registry.ts:674-690`).
2. **The 7-day orphan kill.** An entry older than `MAX_ORPHAN_AGE_MS` is killed by
   pid with no identity check (`headless-pid-registry.ts:41,661`). The oldest
   entries are the ones most likely to have been recycled.
3. **Keeper discovery.** At startup, discovery reads the keeper pid sidecar. If
   that pid is alive and pi is dead, it sends `killPidWithGroup(keeperPid, "SIGTERM")`
   based on liveness alone (`keeper-manager.ts:450-461`). It also surfaces a
   sidecar pi pid on liveness alone (`:471-472`).
4. **Later kills.** `killEntry` (via `killBySessionId` / `killByToken`) and
   `killAll` (`headless-pid-registry.ts:562`, `killPidWithGroup(pid, "SIGTERM")`)
   signal restored entries the same way as live ones. Since `group-aware-kill-process`
   (#912), `killProcess` targets the process group of a pid that leads one, so a
   recycled group leader now takes its whole group with it.

A restored entry has no exit event (dummy handle). Its pid can therefore also die
and be recycled AFTER restore, while the entry stays in the registry. A check done
only at restore time is not enough.

The shared terminator's start-time identity guard exempts registry-reached pids
by name (`force-kill-handler` *An unattended kill SHALL verify process identity
before signalling*). That exemption is the gap this change closes, on the
registry side, as R7 directed.

## What Changes

- **A one-sided start-time verifier for restored entries.** A pid matches when it
  started no later than its anchor plus 2 s. A recycled pid can only start later
  than the original.

  | pid | anchor |
  |---|---|
  | spawn-time pid | `spawnedAt` |
  | `piPid` with a link time | new persisted `piLinkedAt` (time of `linkByToken`) |
  | legacy unstamped `piPid` | `spawnedAt` + 60 s |
  | keeper pid in discovery | mtime of the keeper's pid sidecar |
  | sidecar pi pid | mtime of the pi-PID sidecar |

  The keeper writes each sidecar right after the process starts (`keeper.cjs:432,459`).
- **`piLinkedAt`** is persisted synchronously when `linkByToken` records pi's pid
  from the live bridge. At that instant pi is alive. No probe is needed and there
  is no stamp race.
- **Every signal of a restored pid is gated:** the reclaim, the 7-day kill,
  `killEntry`, the 200 ms keeper-group timer, `killAll`, and keeper discovery.
  - A **mismatch** is never signalled, on any path.
  - A pid with **no determinable start time** (win32 today) is refused on
    unattended paths (including token reclaims and an idle auto-stop) and allowed on
    operator paths: shutdown, force-kill, and a `shutdown` / `user-quit` / `restart`
    stop.
- **The terminator honours a registry refusal.** The registry rung returns a
  `refused-identity` outcome, and the ladder stops without escalating. Today the
  ladder would re-signal the same pid unguarded, because registry-owned pids skip
  its own guard (`session-terminator.ts:186`).
- **Live entries are unchanged.**
- **`killAll()` becomes async.** The change ripples through
  `shutdownHeadlessProcesses` (`browser-gateway.ts:508,3022`) to `server.ts:5488`.
- **Spec deltas:**
  - `force-kill-handler`: a restored entry is no longer exempt; a refusal is
    reported and not retried.
  - `headless-spawn`: orphan cleanup, PID-file field, keeper cleanup, and a new
    *A restored entry is verified before every signal*.

## Decisions (confirmed at the scenario-design gate)

- **Q1** `unverifiable` is refused on unattended paths and allowed on operator
  paths. This mirrors the operator exemption in `force-kill-handler`.
- **Q2** The legacy `piPid` window is 60 s.
- Gate details G1–G8 (null intent unattended, operator mismatch result, timer verdicts, keeper registration, anchor failures, probe budgets, refused keeper group, `linkByPid` skip) are recorded in `design.md`.

## Capabilities

### Modified Capabilities

- `force-kill-handler`: *An unattended kill SHALL verify process identity before signalling*.
- `force-kill-handler` (also): *Unattended reclamation…*, *Force kill process escalation* (rebased on `scope-pids-to-namespace`).
- `rpc-keeper-sidecar`: *Server reconnect to existing keepers on startup*.
- `headless-spawn`: MODIFIED *Orphan cleanup on server startup*, *Headless PID persistence to disk*, *Headless spawn cleanup tracks keeper PIDs*, *Process group kill for headless agents*; ADDED *A restored entry is verified before every signal*.

## Impact

- `packages/server/src/spawn-process/headless-pid-registry.ts`: the verifier,
  the `restored` / `identityRefused` markers, gating, `piLinkedAt`,
  `killBySessionIdChecked`, and an async `killAll`.
- `packages/server/src/rpc-keeper/keeper-manager.ts`: discovery verifies the
  keeper pid and the pi pid against their sidecar mtimes.
- `packages/server/src/spawn-process/session-terminator.ts`: `registryRung`
  honours `refused-identity`.
- `packages/server/src/pairing/browser-gateway.ts` and `server.ts`: await
  `shutdownHeadlessProcesses`.
- Probe cost: one `ps` per restored pid at startup and per kill on macOS.
  Linux reads `/proc`. No probe runs on the registration path.
- **Compatibility:** `piLinkedAt` is optional. Old PID files load unchanged;
  entries without it use the legacy window.
- **Rollback:** revert the registry file. Files written with `piLinkedAt` stay
  readable, because unknown fields are ignored on load.
- No migration.
- **Relation to #913:** #913 (`add-windows-process-identity`) adds an async Windows
  probe and plugs it into this guard's injectable probe (its task 2.3). Until then,
  restored entries on win32 are `unverifiable`: refused on unattended paths,
  allowed on operator paths.
- **Ordering:** the `Process group kill for headless agents` delta is based on the
  text synced by the `group-aware-kill-process` archive (PR #1069). The two
  `force-kill-handler` blocks are rebased on `scope-pids-to-namespace`. Both are
  declared in `dependencies.yaml`.

## Discipline Skills

- `security-hardening`: a recycled pid is untrusted input to a kill decision.
  The change stops the server from signalling unrelated processes.
- `doubt-driven-review`: a fail-open versus fail-closed choice (Q1) on a shared
  termination path. Stress-test it before it stands.
- `review-code`: a non-trivial change to the registry kill paths, reviewed before
  commit.
