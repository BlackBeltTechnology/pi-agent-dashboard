# Design — keeper-backed session identity capture

## Context

`headless-pid-registry.ts` resolves a `session_register` to a registry entry through three
tiers: `linkByToken` (spawn-correlation token), `linkByPid`, and `linkSession` (cwd-FIFO).
Only Tier 1 records `entry.piPid` (line 399). Because `cleanupOrphans` reclaim copies `piPid`
only when it is already set (line 586), an entry that misses Tier 1 once loses pi's identity
permanently, and Tier 2b — which matches on `entry.piPid` — can never fire for it again. That
circularity is the defect.

Facts that constrain the solution (all verified in code):

- **The keeper writes its sidecar before pi exists.** `keeper.cjs` writes
  `String(process.pid)` (line 352) and only then assigns `piChild = spawnPi()` (line 360).
  Pi's PID is not knowable at sidecar-write time.
- **The keeper never respawns pi.** Pi exit leads to `shutdown()`; a replacement is a whole new
  keeper. There is no in-keeper respawn loop.
- **Reclaim drops `sessionId` deliberately**, so immediately after any restart every keeper
  entry in a cwd is unlinked at once — the state cwd-FIFO cannot disambiguate.
- **The existing pi-liveness gate is inert.** `getKeeperManager()` calls `createKeeperManager()`
  with no options (`process-manager.ts:96`), so `isPiAliveForSession` defaults to `() => true`
  (`keeper-manager.ts:182`). Step 3 of the documented startup scan ("verify the pi PID is
  alive") does not currently verify anything.
- **The cwd-FIFO log is conditional.** `event-wiring.ts` logs only when
  `msg.spawnToken || msg.pid !== undefined`, and it fires *before* `linkSession`'s outcome is
  known. Token-less *and* pid-less fallthroughs are silent.

## Decision 1 — the keeper records pi's PID in a second, post-spawn sidecar write

**Chosen:** after `piChild = spawnPi()` succeeds, the keeper writes pi's PID to a **separate
sidecar file** named `<sockPath>.pi-pid` on Unix and `pi-rpc-<sessionId>.pi-pid` on Windows.
Server-side discovery reads it.

**The `.pi-pid` suffix is load-bearing, not cosmetic.** The existing Windows keeper-sidecar scan
matches `^pi-rpc-(.+)\.pid$` with a greedy group. A file named `pi-rpc-<sid>.pi.pid` **would
match it**, yielding a phantom keeper whose `sessionId` is `<sid>.pi` and whose "keeper PID" is
actually pi's PID — discovery would then track a session that does not exist. Ending the name in
`-pid` rather than `.pid` cannot match that pattern. Because filename discipline alone is a
fragile guarantee, the scan additionally SHALL skip any pi-PID sidecar explicitly, so a future
rename cannot silently reintroduce the collision.

**Rejected — extend the existing `.pid` file in place.** Pi's PID does not exist when that file
is written (line 352 precedes line 360), so the value would have to be appended later. The
existing reader would not crash on that — it does `Number.parseInt` on the leading integer and
ignores the remainder — but every future reader would have to know that a one-line file means
"pi unknown" while a two-line file means "pi known", which is exactly the partial-state
distinction a separate file encodes for free. A separate file makes presence itself the signal:
absent means "not yet known", present means "pi's PID, written after a successful spawn".

**Rejected — process-tree scan.** Enumerating the keeper's children (`pgrep -P`, WMI/CIM) is
cross-platform-fragile — Windows has no portable API for a detached process's children — and
gives a wrong answer if the keeper ever has more than one child. This is why the spec deltas in
this change describe the sidecar, **not** a process tree.

**Rejected — infer from cwd.** That is the failing tier this change exists to retire.

**Write-point and failure behaviour.** The second write happens immediately after a successful
spawn, before `keeper ready` is logged. If it fails, the keeper logs and continues — pi is
running and must not be torn down over a diagnostic file. A missing file degrades repair to a
no-op, which is exactly today's behaviour, so failure is safe.

**Lifecycle.** The keeper unlinks the pi-PID sidecar in the same `shutdown()` path that already
unlinks the socket and its own PID sidecar, so a dead keeper cannot leave a file that outlives
the process it names.

**Migration.** Keepers already running when this ships never write the file. For them `piPid`
stays unknown and repair is a no-op — no worse than today. No backfill is attempted, because
the only available backfill mechanism is the process-tree scan rejected above.

## Decision 2 — capture `piPid` only from an unambiguous resolution

This is the correctness core of the change. Recording `piPid` on *any* resolution is unsafe:
after a restart every keeper entry in a cwd is unlinked, so cwd-FIFO can resolve session B's
register onto entry A. Capturing there would stamp a foreign PID permanently and give
`killBySessionId` false confidence — strictly worse than the absent value it replaces.

**Chosen:** capture at the single resolution boundary, gated on the resolution being
**identity-bearing**:

| Tier | Basis of match | Capture |
|---|---|---|
| 1 `linkByToken` | a unique per-spawn secret | yes |
| 2 `linkByPid` | the pid itself | yes |
| 3 `linkSession` (cwd-FIFO) | arrival order within a cwd | **never** |

**Why cwd-FIFO never captures, regardless of candidate count.** An earlier draft of this design
captured when exactly one unlinked keeper entry existed for the cwd, treating a single candidate
as unambiguous. That premise is false: a lone unlinked entry may belong to a *different* session
that has not registered yet, so the register being resolved is not necessarily that entry's own.
The hazard is not a function of how many candidates exist — it is intrinsic to matching on
position instead of identity. A one-candidate cwd is in fact the *common* shape of the classic
same-cwd race, so gating on `>= 2` would have let the most likely wrong capture straight through.
Tier 3 therefore never writes `piPid`; entries linked only that way get their PID from the
keeper's sidecar (Decision 3), which is identity-bearing by construction.

**Rejected — capture regardless of tier.** It cements a wrong PID precisely in the population
this change targets, and a never-overwrite rule would make it uncorrectable.

**Rejected — assign inside all three tier functions.** Three copies of the same guard is the
duplication that let one path drift; a fourth tier added later would silently reintroduce the
defect.

**On the "pid differs from spawn-time pid" condition.** For a keeper-mode entry `entry.pid` is
the *keeper's* PID and the register carries *pi's* PID, so they always differ. The condition is
therefore a type-correctness assertion, not a discriminator, and is documented as such rather
than presented as a safety property.

**When the register carries no pid at all**, there is nothing to capture; the entry is linked as
today and `piPid` stays unset, to be filled by discovery from the sidecar.

## Decision 3 — the sidecar fills an absent `piPid`; it does not outrank a live capture

**Chosen:** the keeper's pi-PID sidecar is the source for entries whose `piPid` is **absent** —
the reclaimed and cwd-FIFO-linked populations. It is *not* asserted to outrank a value captured
from an identity-bearing register.

**Why the earlier "authoritative overwrite" framing was wrong.** A previous draft said a persisted
`piPid` may be overwritten when the sidecar disagrees. Review showed that rule is unreachable: a
fresh capture only exists while pi is alive (the bridge runs inside pi), in which case the capture
and the sidecar name the same process and agree; after a restart the reclaimed entry has no fresh
capture to disagree with; and under PID reuse the stale entry and stale sidecar agree with each
other rather than disagreeing. A rule with no reachable trigger reads as load-bearing while doing
nothing. Worse, it inverted the trust order — `linkByToken` matches a unique per-spawn secret,
which is stronger evidence than a file that carries both a reuse window and an accepted
write-failure case.

**Consequence.** The sidecar's job is to *fill*, not to *arbitrate*. When `piPid` is already set
by an identity-bearing capture it is left alone. When it is absent and the sidecar is readable and
live, it is recorded.

Both paths **fail closed**: when the sidecar is absent, unreadable, or unparseable, `piPid` is left
exactly as it was and the condition is recorded. Nothing is guessed.

## Decision 4 — verify pi liveness instead of assuming it

The startup scan's step 3 is currently inert (`isPiAliveForSession` defaults to `() => true`).
Repair that writes a PID without a liveness check would happily persist a dead PID, which OS PID
reuse can later turn into a live unrelated process.

**Chosen:** give `keeper-manager` a **filesystem-based** probe that reads the pi-PID sidecar and
tests that PID for liveness, and use it as the default rather than `() => true`.

**Absence maps to "alive", not "dead" — this is safety-critical.** The probe gates a destructive
branch: `if (!isPiAlive(...)) { killKeeper; unlink }`. Decision 1 deliberately allows the sidecar
write to fail without tearing pi down, and every keeper spawned before this change has no sidecar
at all. If absence were treated as "pi is dead", discovery would SIGTERM a healthy keeper and its
live pi whose only fault was a missing diagnostic file — a regression against today's `() => true`
default. Absence therefore returns true; only a *present and parseable* sidecar naming a
*non-live* PID returns false.

**Why not inject a registry-backed probe.** The probe must answer for discovered keepers that have
**no reclaimed registry entry** — a persisted record that was missing or aged out — and the
registry cannot speak for those at all. (An earlier draft justified this by claiming the registry's
entries map is empty during discovery; that is false — `cleanupOrphans` reclaim runs before
discovery and populates it. The conclusion stands, but on the correct ground.) The probe therefore
lives where `sessionsDir` already lives, in `keeper-manager`, reading the sidecar directly. This
requires a new pi-PID path helper alongside the existing `pidPathFor` (which resolves the *keeper*
sidecar); the absence of such a helper today is why the default silently degraded to `() => true`.

**What this does not fix.** A liveness check rejects a PID naming a dead process. It cannot
detect a PID that has been *reused* by an unrelated live process — that PID passes the check.
The reuse hazard is narrowed to the window between pi's death and the keeper unlinking the
sidecar on shutdown, not eliminated. Stated here so the requirement is not read as closing it.

## Decision 5 — report ambiguity, not fallthrough volume

The existing `console.error` fires only when `msg.spawnToken || msg.pid !== undefined`, before
`linkSession`'s outcome is known — so it counts *attempts*, not mis-maps, and silently omits the
token-less-and-pid-less case. The measured 76,162 events are therefore an upper bound on
attempts, not a mis-map count.

**Chosen:** report when a cwd-FIFO resolution actually resolves a keeper-mode entry — that is,
whenever positional matching decided a keeper session's identity. Since Decision 2 makes Tier 3
never capture, the diagnostic is no longer doubling as a safety gate; its job is purely to make
the blind path visible.

**Known limitation, accepted deliberately:** the signal reports that a keeper session was resolved
positionally. It cannot say whether that resolution was *correct*, because nothing at that point
knows the true owner — that is the whole reason Tier 3 is untrusted for capture. Reading the
count as a mis-map count would overstate it. Sessions whose register matches nothing remain
unreported, as before.

**Rejected — log every fallthrough more loudly.** Raising severity on a high-volume signal buries
the real event.

## Non-goals

- Removing the cwd-FIFO tier. It remains the last resort; this change makes reaching it
  observable and stops it corrupting identity.
- Changing which entry cwd-FIFO *links*. Only capture is gated; linking behaviour is untouched,
  so this change cannot regress session attachment.
- Changing bridge reconnect or dashboard visibility behaviour.
- Fixing the suspected register-ordering race (see proposal); it is gated behind a repro.

## Risks

- **A wrong `piPid` is worse than none.** Mitigated by Decision 2 (only identity-bearing tiers
  capture), Decision 3 (sidecar fill for absent values), and Decision 4 (liveness check). This
  remains the primary target of the `doubt-driven-review` task.
- **PID reuse is narrowed, not closed.** A liveness check rejects a dead PID but accepts a reused
  live one. The residual window runs from pi's death to the keeper unlinking the sidecar during
  shutdown. Accepted: closing it would require a stronger identity than a PID (start-time or
  handle comparison), which the surrounding code does not carry today.
- **A failed sidecar write is permanent for that keeper's lifetime.** Decision 1 logs and
  continues, so pi keeps running; but that session then has no authoritative record, and any value
  captured for it can never be corrected by Decision 3. Accepted over the alternative — killing a
  healthy pi because a diagnostic file could not be written is a worse outcome — and the failure
  is logged so the session can be recognised as degraded.
- **Repair only runs where discovery runs.** `cleanupKeeperOrphans` executes once at startup, so
  an entry degraded mid-run stays degraded until the next restart. Decision 2's capture gate is
  the in-run path; the split is stated explicitly rather than described as "opportunistic".
- **Interface change.** `KeeperWriter.discoverExistingKeepers` currently returns
  `{ sessionId, keeperPid, sockPath }`, so today there is **no hook** at which reconciliation could
  happen. The return shape gains the pi PID, read from the sidecar inside the scan, giving
  `cleanupKeeperOrphans` a single place to record it. Whether test fakes break is determined by
  *which* declaration is tightened: adding an optional field to `KeeperManager`'s `KeeperEntry`
  alone does not break structurally-compatible fakes under TypeScript return covariance; requiring
  the field on the registry's own `KeeperWriter.discoverExistingKeepers` return type does. The
  implementation must pick one deliberately rather than discovering it from compiler output.
- **The reconciliation hook is currently unreachable and must be restructured.**
  `cleanupKeeperOrphans` only touches an entry under `existing && existing.keeperPid === undefined`.
  Reclaim restores `keeperPid` from the persisted file, so for every reclaimed keeper entry — the
  primary population this change targets — that guard is false and the body is skipped. Recording
  `piPid` there therefore requires widening that condition for the pi-PID branch specifically.
  Without that, Decision 3 is inert.
- **`KeeperEntry.sessionId` is a transport id, not pi's session UUID.** It is the keeper's argv
  session argument (a `randomUUID` minted at spawn), while registry entries and dashboard sessions
  are keyed by pi's session UUID. Any reconciliation keyed off that field must map through the
  registry entry (via keeper PID), not assume the two id spaces are the same. This also means an
  existing consumer that intersects this return against pi-session-keyed state cannot match —
  noted here because Decision 3 leans on the same return value.
- **`getPid` drift for cwd-FIFO-linked entries.** Because Decision 2 forbids capture on that tier,
  such entries keep `piPid` undefined until discovery fills it, so `getPid` returns the *keeper*
  PID — the documented "bridge has not connected yet" fallback — even though the bridge has
  connected. No current caller depends on the distinction, but any future caller expecting pi's PID
  there would be wrong.
- **Respawn is assumed absent.** `keeper.cjs` spawns pi exactly once, but it still carries
  `piLaunchCount` / respawn-scrub infrastructure. If respawn is ever reintroduced, the pi-PID
  sidecar must be rewritten on every spawn or it will name a dead process. Asserted by test so the
  assumption fails loudly rather than silently.
- **Ordering dependency.** Repair assumes reclaim (`cleanupOrphans`) has already run when
  discovery attaches. A future reorder would silently disable it; the dependency is asserted by
  test rather than left implicit.
