## Context

The session-card process list is implemented as a pipeline:

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Today                                      │
└─────────────────────────────────────────────────────────────────────┘

   bridge.ts                process-scanner.ts          ProcessList.tsx
   ─────────                ──────────────────          ───────────────
   setInterval(10s)    ──▶  scanChildProcesses(         processes.len === 0
     PROCESS_SCAN_           parentPid,                   → return null
     INTERVAL                trackedPgids,              else
                             minElapsedMs=30_000)         render N rows
                                                          (1..∞)
                             ① captureChildPgids
                                walks ps -eo pid,ppid;
                                adds discovered PGIDs
                                to trackedPgids
                                (forever, until reaped
                                 in phase ②)

                             ② scanTrackedProcesses
                                for each tracked PGID
                                  if alive AND elapsed≥30s
                                    AND binary≠bash/sh
                                      → include
                                  if dead → remove from set
```

Two flaws this change addresses:

1. **`trackedPgids` is opt-out only.** Anything captured stays until its PGID dies. The bridge's own auto-started infrastructure (dashboard server, RPC keeper sidecar) gets captured at boot and then sits in the list forever as `node …` rows.
2. **Floor of 30 s + tick of 10 s** is calibrated to hide noise, but the same calibration hides almost every legitimate bash subprocess too. The list is mostly empty, and when it isn't, the card thrashes vertically.

We also surface a UI bug: `ProcessList` returns `null` at 0 procs and grows organically — the parent `SessionCard` resizes every change.

## Goals / Non-Goals

**Goals:**

- Exclude bridge self-spawned subprocesses (dashboard server, RPC keeper) from the list without manual user config.
- Surface real subprocesses fast enough that users *see* them while they're running (5 s floor, 5 s tick on Unix).
- Hold session-card footer height stable from the moment a process appears until the last one dies, with a hard upper bound on row count.

**Non-Goals:**

- No change to Windows scan cadence or min-elapsed (10 s / 30 s remain). The `wmic` / PowerShell paths are expensive and flash consoles; the cost/benefit is different there. Revisit only if a user complains.
- No change to the `process_list` wire protocol. Filtering happens entirely inside the bridge before the message is sent.
- No persistence of `selfSpawnedPgids` — bridge restarts re-spawn the infrastructure with fresh PIDs anyway.
- No user-facing setting to tweak min-elapsed / scan tick. Hard-coded constants stay hard-coded.
- No change to kill semantics, message protocol, or server-side event wiring.

## Decisions

### D1. Exclusion model: capture-time refusal, not filter-time skip

Two valid shapes for "ignore these PGIDs":

| Shape | Where check runs | Cost |
|---|---|---|
| **Capture-time refusal** | `captureChildPgids` checks `excludedPgids` before `trackedPgids.add(pgid)` | One check per capture |
| **Filter-time skip** | `scanTrackedProcesses` skips entries whose PGID is excluded | One check per scan, *every* scan |

We pick **capture-time refusal**. Cheaper at steady-state and prevents `trackedPgids` from growing unbounded with infrastructure PGIDs that will never die during the bridge's lifetime.

Trade-off: if a self-spawned PID is registered *after* the scanner has already captured it, the entry will persist until that PGID dies. We mitigate by registering at the spawn callsite (synchronous with `child.pid` being known), well before the next 5 s tick.

### D2. Where the exclusion set lives

Add `selfSpawnedPgids: Set<number>` to `BridgeContext` (mutable state, see `bridge-context.ts`). Two callsites populate it:

- **`server-launcher.ts`** (extension-side). When the bridge auto-starts the dashboard server, `launchDashboardServer` returns the spawned child pid. Register before kicking off readiness polling.
- **RPC keeper spawn from bridge.** The keeper is spawned by `keeper-manager.ts` on the server, but the bridge also has paths that may spawn one (per `add-rpc-stdin-dispatch-with-keeper-sidecar` change). Wherever the *bridge's own process* is the parent, register the keeper's pid.

Registration is `selfSpawnedPgids.add(child.pid)`. Because `spawnDetached` makes the child a session/process-group leader on Unix, `pid === pgid` at the moment of spawn — the same number we'd match in `captureChildPgids`.

No deregistration needed for the death path: the scanner already prunes dead PGIDs from `trackedPgids` in `scanTrackedProcesses`. We extend the same prune to drop dead PIDs from `selfSpawnedPgids` so the set doesn't leak across long-lived bridges that restart their server.

### D3. Platform-aware constants in bridge.ts

```ts
const PROCESS_SCAN_INTERVAL = process.platform === "win32" ? 10_000 : 5_000;
const PROCESS_MIN_ELAPSED_MS = process.platform === "win32" ? 30_000 : 5_000;
```

The scanner already accepts `minElapsedMs` as a parameter. Bridge passes the platform-correct value. `DEFAULT_MIN_ELAPSED_MS` inside `process-scanner.ts` becomes the Windows-safe default (30_000), kept for direct callers that pass no override.

### D4. ProcessList render contract: floor 5, ceiling 5 + overflow tail

```
┌─────────────────────────────────────────────────────────────────────┐
│  Decision matrix                                                    │
└─────────────────────────────────────────────────────────────────────┘

   processes.length   render
   ────────────────   ──────────────────────────────────────────────
   0                  null                  (unchanged from today)
   1                  1 real + 4 skeleton
   2                  2 real + 3 skeleton
   3                  3 real + 2 skeleton
   4                  4 real + 1 skeleton
   5                  5 real
   6                  5 real + "+1 more processes"
   8                  5 real + "+3 more processes"
   N (>5)             5 real + "+(N-5) more processes"
```

**Skeleton row**: identical CSS box to a real row (same `min-h`, padding, border-left). No icon, no text, no kill button. `aria-hidden`. Invisible to the eye but holds the slot.

**Overflow tail row**: same row chrome, text reads `+{N} more processes`, no icon, no kill button. `title` attribute lists the hidden command lines for hover discovery. Does not count toward the 5-slot floor (i.e. floor and ceiling do not double-pad: at exactly 5 procs we show 5 real and nothing else).

**Ordering** (for which 5 are "real"): sort by `elapsedMs` descending. Longest-running stays anchored as new processes appear; new arrivals fall into the overflow tail if 5 are already shown. Rationale: the feature exists to surface long-runners, so they should be the stable view.

This applies to **both** layouts: `compact` (mobile) and full. The compact layout has no header row, so the floor of 5 row-slots is the only thing keeping the mobile card footer stable.

### D5. What we don't filter

The existing `bash` / `sh` wrapper filter stays. Self-spawned exclusion is *additive* — it only adds the bridge's own auto-started PIDs to the existing skip rules. We do not generalize to "anything named node/bun/pi", because users running their own long `node script.js` legitimately deserve visibility.

## Risks / Trade-offs

**Scan cost on Unix doubles.** From one `ps -eo …` per 10 s to one per 5 s. `ps` on macOS/Linux completes in single-digit milliseconds; this is noise in a process that's also doing WebSocket I/O. Accepted.

**Race between spawn and first scan.** If a 5 s scan tick fires in the ~10 ms between `child = spawn(...)` and `selfSpawnedPgids.add(child.pid)`, the PGID gets captured into `trackedPgids` and surfaces. Probability is tiny but non-zero. Two mitigations: (a) register immediately after `spawn()` returns and before the `await` for readiness, (b) at filter time in `scanTrackedProcesses`, *also* skip PGIDs present in `excludedPgids` (defense in depth — small constant cost, eliminates the race). We will implement both belt-and-suspenders.

**Skeleton rows on a tiny mobile screen.** Five rows of ~24 px = 120 px of footer that's empty-looking when only 1 real process exists. This is the intentional cost of "no resize when active." If user feedback finds this excessive on mobile we can drop the mobile floor to 3, but we ship at 5 for parity.

**Overflow tail hides processes.** With ≥6 procs running, the user only sees 5 commands + a count. Tooltip lists the rest. This is a deliberate UX trade — most session cards never hit 6 simultaneous long-runners, and unbounded growth was the worse failure mode. If a power user needs all of them, they can kill the visible ones to surface the next.

**Self-spawned set leaks if no scan-prune.** Mitigated: D2 specifies the same prune sweep that already runs in `scanTrackedProcesses` extends to `selfSpawnedPgids`.

**Configurability deferred.** Hard-coded 5 (floor + ceiling) and 5 s (tick + min-elapsed) are intentional. We can always make these settings later; we cannot un-add settings that nobody asked for.
