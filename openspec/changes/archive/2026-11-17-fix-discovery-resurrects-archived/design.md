## Context

See proposal.md — Why. Three sites seed a folder's on-disk history into the live
set from `.jsonl` headers (`discoverSessionsForCwd`,
`packages/server/src/session/session-discovery.ts:94`, which lists every `.jsonl`
in the folder's sessions dir, reads only headers, and writes nothing):

| Site | Trigger | Archive guard | Seeding call |
|---|---|---|---|
| `packages/server/src/session/session-bootstrap.ts` `discoverAndBroadcastSessions` | boot, every known dir | yes, `sessionArchive?.has(hist.id)` (`:35`) | `sessionManager.restore()` |
| `packages/server/src/event-wiring.ts` `isNewCwd` branch (`onDirectoryAdded(...).then`, ~`:2052`) | first resident session registers in a cwd | **no** | `register` → `unregister({witnessed:false})` → `update({hidden:true})` |
| `packages/server/src/browser-handlers/directory-handler.ts` `pinDirectorySideEffects` (~`:89`) | folder pinned | **no** | `register` → `unregister({witnessed:false})` |

Each site's only resident check is `!sessionManager.get(hist.id)`. An archived
session is evicted from the live set by design (`session-archive` "Archived
sessions are not resident"), so it always passes at the two unguarded sites.

How the sidecar gets erased: `register()` fires `onChange`
(`packages/server/src/session/memory-session-manager.ts:507`), whose handler
queues a debounced save of `sessionToMeta(session)` for the header-only record
(`packages/server/src/server.ts:1033`). `unregister()` then fires `onEnded` →
`metaPersistence.setLiveness` (`packages/server/src/event-wiring.ts:636-669`),
which cancels the queued save and uses the queued record as its base
(`packages/server/src/persistence/meta-persistence.ts:122-128`), writing it over the
sidecar with no archive carry-forward. (The debounced save alone carries
`archived`/`archivedAt` forward from disk, `meta-persistence.ts:93-102`; the eager
path does not.) `update()` then stamps `closedReason: "unknown"`
(`memory-session-manager.ts:590-594`). That matches the fingerprint on the 210 live
sidecars. `restore()` (`memory-session-manager.ts:514-517`) only runs
`ensureEndedAt` and inserts; it fires no hook and writes nothing.

Boot restores every sidecar-backed session from all dirs, and writes a sidecar for
any meta-less `.jsonl` (`meta-json-session-cache` "All directories scanned
regardless of pin status", "Session file without meta file"). So after boot, a
non-resident id that has a sidecar is either archived or one whose sidecar the
scan could not use.

## Goals / Non-Goals

**Goals:**
- One seeding implementation; the guard lives in it, not at call sites.
- Seeding never writes a sidecar and never stands in for an existing one.
- Resume placement still works for a seeded session.

**Non-Goals:**
- Changing `discoverSessionsForCwd`. It stays a pure header lister.
- Making the routine sidecar save merge instead of overwrite.
- Repairing already-resurrected sessions (done operationally; see proposal).

## Decisions

### D1 — Shared helper `seedDiscoveredHistory`

New module `packages/server/src/session/seed-discovered-history.ts` exporting
`seedDiscoveredHistory(discovered, deps): DashboardSession[]` with
`deps = { sessionManager, sessionArchive }` (`sessionArchive` required: all three
sites have it — `event-wiring.ts:301`, `browser-handlers/handler-context.ts:97`, and
the bootstrap deps — at runtime, though typed optional there; an absent index
would silently reinstate the bug). A call site whose context lacks the index
fails closed: it seeds nothing. It
filters `discovered` through the D3 guard, seeds the rest, and returns the seeded
sessions. Callers own the listing (boot calls `directoryService.discoverSessions(cwd)`;
the on-demand sites already hold the `sessions` returned by
`directoryService.onDirectoryAdded`) and their own broadcast channel
(`browserGateway.broadcastSessionAdded` at boot and in event-wiring,
`ctx.broadcast({type:"session_added"})` in the pin handler). The on-demand sites
keep their `openspec_update` broadcast unchanged.

The seeding body is lifted from `session-bootstrap.ts:36-76` unchanged (stats
extraction, `deriveEndedAt`, `dataUnavailable: true`, `hidden: false`). The
helper is synchronous: no `await` between the guard and `restore()`, so a bridge
registration cannot interleave and be replaced by a header-only record.

*Alternatives:*
- Add the missing `sessionArchive.has()` guard at the two sites only. This is the
  smallest diff, but it leaves three copies, and the copies already drifted once (the
  guard reached one of three). Rejected by the user in planning.
- Delete the two on-demand loops (boot covers every dir). Rejected: they are the
  only path that surfaces a sidecar-less transcript written after boot (e.g. a pi
  run without the bridge, copied-in history).
- Filter in `discoverSessionsForCwd`. Rejected: it is shared with non-seeding
  callers and has no archive-index access.

### D2 — Seed through `restore()`, never `register`/`unregister`/`update`

`restore()` fires no `onChange`/`onEnded`/`onUnregister`, so there is no queued
save and no eager `setLiveness`. A discovered transcript is history, not a
lifecycle event. The boot path already proves this seam.

Consequences, intended:
- No `dispatchPluginSessionEnded` (`event-wiring.ts:754`) for seeded history. A
  transcript found on disk is not a session death. Boot `restore()` never fired
  it, and with the D3 sidecar guard no plugin-owned session (always sidecar-backed)
  is ever seeded on demand.
- No `closedReason` on seeded history. `restore()` is not a terminal transition,
  and `session-death-attribution.test.ts` (E17 `:180-192`, E12 `:197-209`) already accepts history seeds
  without a reason (boot does the same today).
- A sidecar-less seed stays sidecar-less until the next boot scan writes one
  (previously the on-demand sites created it via the save path).
- No order-map entry at seed time, the same as boot seeds today. The startup
  reconcile (`server.ts:1148+`) runs before async boot discovery.

*Alternative:* keep `register`/`unregister` with a "no persist" flag. Rejected:
it adds a flag to a hot API for one caller class.

### D3 — Guard: resident, archive index, or existing sidecar

Skip an id when `sessionManager.get(id)` is set, `sessionArchive.has(id)`, or its
sidecar (`<jsonl>.meta.json`) exists. The index check is in-memory and catches
archived ids. The sidecar check (one `existsSync`) catches everything else that
is sidecar-backed: an archived id missing from the index, or a sidecar the boot
scan rejected. In both cases a header-only seed would be lossy and must not stand
in for the real record. What remains seedable is exactly the sidecar-less
transcript.

### D4 — Resume placement keys on the register's prior status

`server.ts` keeps `endedSessionIds` (`packages/server/src/server.ts:1148`). It is
snapshotted from `listAll()` at boot and grown only on an alive→ended `onChange`
(`:1043-1051`). The resume branch (`:1057`) needs `wasEnded`. A `restore()`d
ended session added after the snapshot (an on-demand seed, an unarchive via
`session-archive.ts:383`, or a late boot seed) is not in the set, so resuming it
would skip Resume placement and leave its `pendingResumeIntents` entry
unconsumed.

`register()` already reports the replaced record's status to `onChange`
(`memory-session-manager.ts:372,507-510`, `priorStatus`). Change the check to
`wasEnded = endedSessionIds.has(id) || ctx?.priorStatus === "ended"`. This is one
line, adds no API, and fires on the exact ended→alive register. Update the
now-inaccurate comment at `server.ts:1145-1147` and the replica of this logic in
`packages/server/src/__tests__/session-order-reboot.test.ts:101-118`.

This stays inside `session-filtering` "Ended→alive sessionOrder mutation gated
by user intent": the branch still consults `pendingResumeIntents`, and a
null-intent reattach still does not reorder. Its reboot scenarios are unchanged,
because scan-restored ids are already in the boot snapshot. `session-ordering`
"Reattach placement policy applied on register" runs in `onSessionRegistered`,
not in this branch, so it is untouched.

Effect beyond seeds: resuming an unarchived session, or a late-boot-seeded one,
now gets Resume placement too. This is intended, since they are ended sessions like
any other.

*Alternatives:* a new `onRestored` hook on the manager feeding the set. Rejected:
it is a larger API for a rare path, and it fires for every `restore()` caller.
Firing `onChange` after `restore()` is rejected because it drives the save this
change avoids.

## Risks / Trade-offs

- [A sidecar the boot scan rejected (corrupt) is now never surfaced by on-demand
  discovery] → Intended: the scan's own repair path owns it, and a header-only
  seed would overwrite it on the next save.
- [On-demand seeds flip `dataUnavailable` false→true] → This matches boot. The
  client already renders boot-seeded history with `dataUnavailable: true`.
- [`endedSessionIds` is never pruned on remove/archive] → Pre-existing. The D4 check
  does not depend on pruning.

## Migration Plan

No data migration. Server-only change: restart the server after landing
(`npx tsx .pi/skills/implement/scripts/restart-server.ts`). To roll back, revert;
no persisted format changes.
