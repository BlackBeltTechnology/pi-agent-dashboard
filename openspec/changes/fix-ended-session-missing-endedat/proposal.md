# fix-ended-session-missing-endedat

## Why

`headless-reload` already requires a server-ended session to carry **both**
`status: "ended"` and `endedAt`. Nothing enforces it. On the live instance, 34 of
3,309 ended records carry no `endedAt`, and the population **regenerates on every
boot** because the paths that reconstruct sessions from disk omit the field.

```
total session records              3318
  ended, endedAt present           3275
  ended, endedAt MISSING             34   ← violate the invariant
  status != "ended" (live)            9
```

### This is NOT a liveness bug

Stated explicitly, because it is the obvious wrong reading and an earlier
audit of this very defect made it:

- Liveness is `status`-based everywhere. Server: `listActive()` filters
  `status !== "ended"` (`memory-session-manager.ts:185`). Client: the ended tier
  is `s.status === "ended"` (`SessionList.tsx:1404`, `SessionSidebar.tsx:50`).
- **No code treats a missing `endedAt` as live.** A record with
  `status: "ended"` and no `endedAt` is already in the ended tier and already
  excluded from every active count.
- Sessions restored by `session-bootstrap` are additionally `hidden: true`, so
  they are in the hidden tier as well.

An audit that filters `!endedAt` will report these 34 as "live". That filter
matches nothing in the product. Anyone measuring liveness must use `status`.

### What the missing field actually costs

1. **Order seeding for ids not yet stored.** `reconcileSessionOrder` seeds ended
   ids by `(endedAt ?? startedAt)` descending (`reconcile-session-order.ts:41`),
   and only for ids **absent** from the stored per-directory order. Without
   `endedAt` such a session is seeded by when it *started*. Ids already in stored
   order keep their position — so for the 34 records observed today, which have
   been seeded by previous boots, **this changes nothing**. The benefit applies
   to ids seeded from now on.
2. **The card time badge — on the bootstrap path only.**
   `session-card-time.ts:18` resolves `endedAt ?? lastActivityAt ?? startedAt`.
   Scanner-restored records already carry `lastActivityAt` from the transcript
   mtime, which is the *same* value this change would derive — so their badge is
   already correct. Only `session-bootstrap`-restored sessions, which set no
   `lastActivityAt`, fall through to `startedAt` and report the wrong "X ago".
3. **The specified invariant is silently violated**, so `headless-reload`'s
   requirement holds only where a developer remembered to set both fields.

**Honest scope:** for the 34 records that motivated this, the visible payoff is
near zero — they keep their stored order slots and most already render the right
time. The durable value is the invariant itself, correct seeding for future ids,
and the bootstrap badge. This is data hygiene, not a fix for a user complaint.

### Where it breaks

Sites that transition a `DashboardSession` to `ended` without a timestamp:

| Site | Context | Why it omits |
|---|---|---|
| `session-scanner.ts` `sessionFromMeta` | **the dominant path** — rebuilds a session from persisted meta on every boot, `endedAt: meta.endedAt` | faithfully reproduces a defective meta; the cache-fresh branch never rewrites it |
| `session-bootstrap.ts:47` | `restore()` of historical TUI sessions at boot | never reads persisted meta; passes no `endedAt` **and no `lastActivityAt`** |
| `session-scanner.ts:261` | `newMeta` in the no-usable-meta branch | sets `status: "ended"`; `endedAt` only survives via `...(meta ?? {})` |
| `session-action-handler.ts:227` | normalising a zombie's `active` before auto-resume | status-only update; the next branch can return early (`:229-231`) |

A fourth path supplies a **wrong** timestamp rather than omitting one: adding or
pinning a directory registers historical sessions and immediately unregisters
them (`directory-handler.ts:55-65`), and `unregister()` stamps `Date.now()`
(`memory-session-manager.ts:165-166`). For a session that ended weeks ago that is
reconstruction time, while the real evidence (`modifiedAt`) is already at hand in
`session-discovery.ts:126`.

**`unregister()`'s `Date.now()` is correct where the server observes the end** — a
TUI quit, a heartbeat expiry, a terminated run. The distinction this change turns
on is *observed ending* vs *reconstruction*, not which function performs it.

**`restore()` is the reason a call-site fix is not enough**: it is a bare
`sessions.set` (`memory-session-manager.ts:158-160`) with no hook and no
`onChange`. Any invariant placed in `update()`/`unregister()` cannot see it, and
both disk-derived paths above go through it.

**Deliberately excluded — `terminal-manager.ts:300`/`:418`.** These mutate
`TerminalSession` (`packages/shared/src/terminal-types.ts`), a different type
with no `endedAt` field, held in the terminal manager's own map. Terminal entries
never reach the session manager or session listing. Enforcing the invariant there
would mean adding a field to a wire-visible type — a non-goal.

**One inconsistency to reconcile, not preserve:** `server.ts:357-358` stamps
`restored.endedAt ?? Date.now()` at boot. For a session that ended long ago,
`Date.now()` is not its end time, and it feeds the same order seed. It sets both
fields, so it does not violate the invariant — but it is the wrong timestamp.

**Not established:** which path wrote the 34 currently-observed records. The fix
is invariant-based and does not depend on knowing.

## What Changes

- **The invariant SHALL hold at every entry point into the session map**,
  including `restore()` — not only `update()`/`unregister()`. A session that is
  `ended` always has an `endedAt`.
- **The timestamp SHALL come from evidence, never from reconstruction time.**
  The scanner already derives `lastActivityAt` from the transcript's mtime
  (`readJsonlMtime`); the same evidence gives a defensible end time, falling back
  to `startedAt`.
- **`server.ts`'s boot normalisation SHALL use the same evidence-based
  derivation** instead of `Date.now()`, so one rule governs every reconstructed
  session.
- **`endedAt` SHALL NOT be used as a liveness signal.** Liveness is `status`.
  Codifying this prevents the recurring misreading described above.
- **No bulk migration.** Fixing the derivation repairs the **in-memory** view on
  the next start, which is what every consumer reads. The persisted meta does
  **not** self-heal: the scanner rewrites meta only in its stale-cache and
  no-meta branches, and an ended transcript's mtime never advances, so a
  cache-fresh defective record is re-read verbatim forever. Accepted — the
  in-memory record is corrected on every boot, and a one-shot write over ~3,300
  files is not worth it for a field that is re-derived anyway.
- **NOT in scope, and why:**
  - *Detecting that a session died* (lost bridge, killed process) and the
    `live`/`liveEpoch` recovery marker. That is the mechanism that could strand a
    session as genuinely live; it is a separate concern and there is currently no
    evidence of it misbehaving — all 9 live sessions hold real bridges.
  - *Terminal sessions* — different type, no `endedAt`, see above.
  - *Any client or wire-protocol change.*

## Capabilities

### Modified Capabilities

- `session-listing` — a session that is `ended` always carries an evidence-based
  `endedAt`, including records rebuilt from disk; `endedAt` is not a liveness
  signal.

## Impact

- **Users:** ended sessions sort by when they ended rather than when they
  started, and their cards report the correct "X ago". No change to which
  sessions appear live.
- **Data:** no bulk write. Records converge as they are re-scanned or restored.
- **Risk:** the derivation must not regress sessions that already have a correct
  `endedAt` — the rule only fills an absent value.
- **Blast radius:** `packages/server` session manager, scanner, bootstrap, and
  the boot normalisation in `server.ts`. No client or protocol change.

## Discipline Skills

- `doubt-driven-review` — an earlier draft of this proposal asserted a
  user-visible liveness failure that the code contradicts; the review caught it
  before implementation. The same trap is why the "not a liveness bug" section
  is stated explicitly rather than assumed.
- `review-code` — the invariant drifted because several state-transition sites
  each looked locally correct.
