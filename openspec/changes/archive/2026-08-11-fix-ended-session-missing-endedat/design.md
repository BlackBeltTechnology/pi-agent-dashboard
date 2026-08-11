## Context

`DashboardSession` carries `status` and an optional `endedAt`. `headless-reload`
requires both for a server-ended session; nothing enforces it. 34 of 3,309 ended
records on the live instance carry no `endedAt`, and the set regenerates every
boot because the disk-derived paths omit the field.

Liveness is **not** affected: `listActive()` filters `status !== "ended"`
(`memory-session-manager.ts:185`) and the client's ended tier is
`s.status === "ended"`. No code treats a missing `endedAt` as live. The field
feeds two consumers only:

- `reconcileSessionOrder` seeds ended ids by `(endedAt ?? startedAt)` desc
  (`reconcile-session-order.ts:41`) — for ids **absent** from stored order.
- `session-card-time.ts:18` anchors the badge at `endedAt ?? lastActivityAt ??
  startedAt`.

Three `DashboardSession` sites end without a timestamp: `session-bootstrap.ts:47`,
`session-scanner.ts:261`, `session-action-handler.ts:227`. Two of them reach the
map through `restore()`, which is a bare `sessions.set` with no hook
(`memory-session-manager.ts:158-160`).

Constraints:
- `terminal-manager` mutates `TerminalSession` — a different type with no
  `endedAt`. Out of scope; adding the field would be a wire-protocol change.
- `server.ts:357-358` already sets both fields at boot but uses `Date.now()`.
- The store holds ~3,300 records; a bulk write is the only irreversible option
  available, and the design avoids needing one.

## Goals / Non-Goals

**Goals:**
- Make `ended`-without-`endedAt` unreachable, including via `restore()`.
- Derive supplied timestamps from evidence, never reconstruction time.
- Correct ended-tier order seeding and the card time anchor.
- Codify that liveness is `status`, so the field is not misread again.

**Non-Goals:**
- Detecting that a session died; the `live`/`liveEpoch` recovery marker.
- Terminal sessions.
- Any client or wire-protocol change.
- A bulk migration over the persisted store.

## Decisions

**D1 — Enforce inside the session map, covering `restore()` — but key the
timestamp on *observed vs reconstructed*, not on which function ran.**
The presence guarantee lives where records enter the map (`update()`,
`unregister()`, `restore()`). The *value* rule is keyed on whether the end was
**witnessed**:

| Situation | `endedAt` |
|---|---|
| Explicit end signal / user-initiated termination | time of the event (`Date.now()`) |
| Heartbeat or grace-period expiry — the end happened earlier and was only *detected* now | evidence-derived |
| Reconstructed from disk (bootstrap, scanner) | evidence-derived |
| Registered from history then immediately unregistered (directory add/pin) | evidence-derived |

So `unregister()` cannot decide by itself — it serves both the witnessed and the
inferred cases, and the caller must supply which. Routing witnessed endings
through evidence derivation would stale-date every session that ends normally;
routing inferred endings through `Date.now()` records a detection time as an end
time, which is the defect this change exists to remove.

Evidence precedence is fixed: recorded last activity → transcript last-write time
→ `startedAt`.

**D1a — `restore()` enforcement MUST NOT fire `onChange`.** `restore()` is
documented as not triggering `onChange` and is a bare `sessions.set`
(`memory-session-manager.ts:158-160`). At boot the restore loop runs before
`endedSessionIds` is seeded, so an enforcement helper that emits `onChange` would
see `isEnded && !wasEnded` for every restored session and trigger a
`moveToFront` + `sessions_reordered` broadcast for ~3,300 records — churning the
stored order this change is supposed to protect. This is a correctness
constraint, not a performance note.

**D2 — Evidence-based derivation, and the bootstrap path must stat its own file.**
`session-scanner` already reads the transcript mtime for `lastActivityAt`
(`readJsonlMtime`), so `lastActivityAt` is usable evidence there. But
`session-bootstrap` sets **no** `lastActivityAt`, so a `lastActivityAt ??
startedAt` rule would give bootstrap-restored sessions `startedAt` — the worst
fallback, and the one case where the badge is actually wrong today. Bootstrap
carries a `sessionFile` and must stat it. Deriving "evidence" differently per
path would leave the two disk paths disagreeing by however long a session ran.
Alternative: `Date.now()` — rejected, it asserts a session ended at boot when it
ended weeks earlier, and feeds the order seed.

**D2a — the `startedAt` fallback is not unconditionally safe.**
`extractTimestamp` returns `Date.now()` when a session filename fails to parse,
so for a malformed name the mandated fallback is itself reconstruction time.
Rare, but it is a hole in the rule and the implementation should not pretend
otherwise.

**D3 — Bring `server.ts:357-358` under the same rule.**
It currently stamps `Date.now()`. It satisfies the invariant but produces the
wrong instant, and it is on the boot path where D2 also applies. One rule for
every reconstructed session is simpler than two that disagree.

**D4 — No backfill; the in-memory view converges, the persisted meta does not.**
Fixing the derivation repairs the in-memory record on every boot, and that is
what every consumer reads. The persisted `.meta.json` does **not** converge: the
scanner writes meta only in its stale-cache (`jsonl mtime > cachedAt`) and
no-meta branches, and an ended transcript's mtime never advances — so a
cache-fresh defective file is re-read verbatim indefinitely. Accepted with eyes
open; an earlier draft of this design claimed the opposite. Alternative: a
one-shot migration over ~3,300 files — rejected as the only irreversible step in
the change, for a field that is re-derived at every boot anyway.

**D5 — State the liveness rule as a requirement.**
`endedAt` is not a liveness signal. This documents existing behaviour rather than
changing it; its value is preventing the misreading that produced an earlier,
incorrect version of this proposal. Alternative: introduce a new liveness
predicate — rejected; the client partitions on `status` and cannot consume a
server-only helper without a client change, which is a non-goal.

## Risks / Trade-offs

- **Derivation could overwrite a correct existing value.** → Fill only when
  absent; an explicitly supplied `endedAt` is always preserved.
- **Transcript mtime is a proxy, not a true end time.** → It is strictly better
  than `startedAt` (today's effective fallback) and than `Date.now()`. Accepted,
  and stated: the field means "best known end time", not a precise record.
- **Enforcing inside `restore()` changes a hot boot path.** → Check the
  status/`endedAt` conditional *before* any stat, so the common case costs
  nothing. Note the same enforcement sits on `update()`, which runs on every
  activity event (`event-wiring.ts:838`) — the cheap conditional must come first
  there too. Verify boot time on a store of this size.
- **Two orderings coexist after the fix.** → Newly seeded ended ids sort by
  derived end time while previously stored ids keep their `startedAt`-based
  slots. Consistent with the ordering spec, but the ended tier is not uniformly
  corrected and the proposal should not imply it is.
- **Derived and observed `endedAt` are indistinguishable afterwards.** → No
  consumer can tell an inferred mtime from a real end time, so the evidence rule
  is unauditable after the fact. Accepted; a precision marker would be a schema
  change (see Open Questions).
- **No backfill means old records stay wrong until touched.** → Accepted. They
  are already ordered by `startedAt` today; convergence is monotonic and no
  record gets worse.
- **`session-action-handler.ts:227` derives a timestamp for a session that may
  still be running** (`isSessionProcessGone` fails closed on unprobeable
  carriers). → The record is being normalised to `ended` regardless; the change
  only governs which timestamp it gets. If that normalisation is itself wrong,
  that is the liveness concern this change declares out of scope.

## Migration Plan

No migration. Land D1–D3 and records converge as they are restored or re-scanned.
Rollback is a revert; any `endedAt` already written remains valid.

## Open Questions

- Is transcript mtime the best available evidence, or does the session file carry
  an explicit last-entry timestamp worth parsing instead?
- Should a derived (inferred) `endedAt` be distinguishable from an observed one,
  so future consumers know its precision? Adding a marker would be a schema
  change — deliberately not proposed here.
