# Fix keeper-backed session identity capture

## Why

The headless PID registry can permanently lose a keeper-backed session's process identity,
degrading every later reattach to a cwd-positional match that the code's own comment describes as
capable of killing the wrong pi process.

**Defect 1 — `piPid` capture is single-sourced and unrecoverable. (Proven, by code.)**
`headless-pid-registry.ts` writes `entry.piPid` in exactly one place: `linkByToken` (Tier 1,
line 399). `linkByPid` (Tier 2) and `linkSession` (Tier 3, cwd-FIFO) set `sessionId` but never
`piPid`. `cleanupOrphans` reclaim copies the field only `if (entry.piPid !== undefined)`
(line 586). An entry that misses Tier 1 once can never acquire `piPid` — and Tier 2b, which
matches on `entry.piPid`, can therefore never fire for it again. That circularity is the defect.
Its consequence is documented in the file's own header comment (lines 78–90): *"the registry
falls all the way through to the cwd-FIFO tier, which mis-maps sessionIds to keeper entries when
two sessions share a cwd. Symptom: `/ctx-stats` in session A dispatches to pi-B's keeper; killing
A SIGTERMs B's pi."*

Observed live on 2026-08-15: registry entry `abe06e02` carries `spawnToken=aae097bc-…` but no
`piPid`, so `linkByToken` never matched it. Its keeper (75884) and pi (76302) are both alive.

**Defect 2 — post-restart reclaim opens a mis-map window. (Proven, by code.)**
Reclaim deliberately drops `sessionId` so sessions re-link cleanly. Consequently, immediately
after every restart all keeper entries sharing a cwd are unlinked simultaneously, and
`linkSession` selects the first match by arrival order. For an entry whose `piPid` is absent
(defect 1), Tiers 1 and 2 both miss and resolution lands in exactly that ambiguous window.

**Defect 3 — the identity-capture miss is likely a register-ordering race, not a resume
problem. (Suspected; requires repro.)**
An earlier framing blamed resume-spawns for failing to round-trip the spawn token. Review
disproved the mechanism: a resume mints a *fresh* token and registers the entry with it
(`session-action-handler.ts`), and a freshly spawned resume pi has `isFirstRegister = true`, so
the token should be sent. The mechanism consistent with the observed state — `spawnToken` present
on the entry but `piPid` absent — is a **race between `session_register` and
`headlessPidRegistry.register()`**: pi boots inside the keeper and its token-bearing register is
processed before the entry exists, so all three tiers miss; a later token-less re-register then
links the entry via cwd-FIFO, which never captured `piPid`. This is not resume-specific and is
recorded as a hypothesis to confirm before any token-path edit.

### Scale of the affected path

Measured across two server logs: **76,162** cwd-FIFO fallthrough log events, **99.7 %** carrying
no spawn token, spanning 279 sessions and 30 cwds, with 109 distinct sessions in a single shared
cwd. Source: the `console.error` in `event-wiring.ts`'s three-tier link block, which fires when
`msg.spawnToken || msg.pid !== undefined` and *before* `linkSession`'s outcome is known. It
therefore counts fallthrough **attempts**, not mis-maps, and omits the token-less-and-pid-less
case entirely. The number bounds the exposed population; it is not a mis-map count.

### Explicitly ruled out during investigation

- **Not a rogue/duplicate server.** One server process owns both `:8000` and the pi gateway
  `:9999`, matching `server.pid`.
- **Not `register_rejected`.** Zero occurrences across both server logs.
- **Not a general bridge-reconnect failure.** A keeper-backed session was verified `ESTABLISHED`
  to the gateway across a restart.
- **Not keeper env-forwarding.** A healthy keeper-backed session shows the same post-consumption
  env state as the degraded one.

### Known-unexplained (deliberately not specified here)

One keeper-backed session (keeper `abe06e02`, pi 76302) holds zero TCP connections and never
re-registers, while a comparable session reconnects normally. Root cause is not established. It
may share a cause with defect 3's re-register path, which is why both are investigation tasks. No
requirement is written against it — specifying a fix for an unexplained symptom is how the wrong
mechanism gets enshrined.

## What Changes

- **Capture `piPid` from the identity-bearing tiers (token, pid), never from cwd-FIFO.** That tier
  matches on arrival order, so the entry it picks is not known to belong to the registering
  session — even when only one candidate exists, since a lone unlinked entry may belong to a
  session that has not registered yet. Capturing there would stamp a foreign PID permanently and
  give `killBySessionId` false confidence, which is strictly worse than the absent value it
  replaces. Entries linked only by cwd-FIFO get their PID from the keeper's sidecar.
- **Have the keeper record pi's PID** in a second, post-spawn sidecar, since the existing sidecar
  is written before pi exists. Discovery reads it.
- **Use the keeper's sidecar to fill an absent `piPid`**, which is how reclaimed and
  cwd-FIFO-linked entries obtain an identity at all. The sidecar fills; it does not arbitrate
  against a live identity-bearing capture.
- **Make the inert pi-liveness check real**, so repair cannot persist a PID naming a dead process.
  This narrows the PID-reuse hazard rather than closing it — an already-reused live PID still
  passes a liveness test.
- **Report cwd-FIFO ambiguity** using the same predicate that gates capture.
- **Confirm or refute defect 3** with a repro of the register-ordering race before touching the
  token path.

### Out of scope

- Redesigning the two-channel (keeper dispatch / bridge WS) architecture.
- Adding a server→pi "re-open your bridge WS" RPC.
- Changing which entry cwd-FIFO *links* — only capture is gated, so session attachment behaviour
  is unchanged.
- Changing `scripts/rebuild-and-restart.sh` sequencing. Its restart→`sleep 1`→reload ordering
  surfaced these defects but did not cause them.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `headless-spawn` — identity-bearing-tier-only `piPid` capture, sidecar fill for absent values,
  liveness checking, and positional-resolution observability.
- `rpc-keeper-sidecar` — keeper writes a pi-PID sidecar after spawn; startup discovery reconciles
  the registry against it and performs a real liveness check.

## Discipline Skills

- `systematic-debugging` — defect 3 and the non-reconnecting bridge are unconfirmed; both must
  reach evidence-backed root cause before any code change. An earlier mechanism for defect 3 was
  already disproved by review, which is precisely why the repro gates the fix.
- `doubt-driven-review` — this change alters which pi process a kill or dispatch reaches. The
  first design draft would have cemented a foreign PID under ambiguity; the discipline caught it,
  and the same scrutiny applies to the corrected capture gate.
- `observability-instrumentation` — the existing fallthrough signal counts attempts, not mis-maps;
  the replacement must be a rare, actionable signal rather than more volume.
- `review-code` — non-trivial change spanning the registry, keeper discovery, and `keeper.cjs`.

## Impact

- **Affected code**: `packages/server/src/spawn-process/headless-pid-registry.ts`,
  `packages/server/src/rpc-keeper/keeper-manager.ts`,
  `packages/server/src/rpc-keeper/keeper.cjs` (new post-spawn sidecar write + unlink),
  `packages/server/src/spawn-process/process-manager.ts` (supply the `isPiAliveForSession` probe),
  `packages/server/src/event-wiring.ts` (three-tier link site).
- **Affected interface**: `KeeperWriter.discoverExistingKeepers`'s return shape gains pi's PID.
  Every test fake implementing that interface must be updated — a compile-time break, not a
  runtime one.
- **Affected data**: `~/.pi/dashboard/headless-pids.json` (entries gain `piPid` where it can be
  established) and a new per-session `*.pi-pid` sidecar in `~/.pi/dashboard/sessions/`. The
  suffix deliberately does not end in `.pid`, because the existing Windows keeper scan
  (`^pi-rpc-(.+)\.pid$`, greedy) would otherwise match it and invent a phantom keeper. The
  existing keeper `.pid` sidecar is unchanged byte-for-byte, so the startup orphan-cleanup reader
  is unaffected.
- **Migration**: none. Keepers already running never write the new sidecar; their entries behave
  exactly as they do today. Repair becomes available for keepers spawned after the upgrade.
- **Compatibility**: `PersistedEntry` fields remain optional, so pid files round-trip in both
  directions across the change.
- **Rollback**: revert the change. Reverted code still reads `piPid` — `linkByPid` Tier 2b and
  `getPid` both consume it — and the values written by this change are correctly derived, so they
  remain valid for the older code path. Orphaned `*.pi-pid` files are ignored by the reverted
  reader and are cleaned up by keeper shutdown.
- **Risk**: a wrong `piPid` is worse than none, because `killBySessionId` would act on it with
  full confidence. The identity-bearing-tier gate, the sidecar fill, and the liveness check exist
  specifically to bound that; all three must fail closed. The liveness probe in particular must
  treat a **missing** sidecar as "alive", since it gates a branch that kills the keeper — reading
  absence as death would destroy healthy sessions whose sidecar write failed or predates the
  change.
