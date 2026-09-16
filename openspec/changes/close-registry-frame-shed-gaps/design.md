## Context

See `proposal.md` — Why. Current mechanics (`packages/server/src/pairing/browser-gateway.ts`):

- `frameClassOf(msg)` → `{cls, key}`; `default:` is `transcript`. `broadcast()` window-projects `sessions_reordered` BEFORE serialization, derives `dirtyId` only for `session_updated`, then `fanout(serialized, stateKey?, dirtyId?)`; `fanout` sees strings only.
- `StatusDebt = { ids: Set<string>, timer }` per socket; `recordStatusDebt(ws, id)` at the shed site; `flushStatusDebt(ws)` every `STATUS_RECONCILE_INTERVAL_MS` (250 ms) rebuilds `session_updated {status, currentTool}` from `sessionManager.get(id)`; missing session → debt discarded. `dropStatusDebt` on close/error/stalled-terminate.
- Client: `session_added` is an upsert (`next.set(id, session)`), `session_removed` marks `status: "ended"` if held, `sessions_reordered` merges (held ids absent from the order stay at the tail).
- Paging: `SessionList` owns `pagingInflight: Set<cwd>` + 15 s timers; releases when `pagedCount[cwd]` advances. `useMessageHandler` `sessions_page_result` merges sessions/order and advances `pagedCount` by `sessions.length`.

## Goals / Non-Goals

**Goals:** no registry broadcast can be lost silently; the paging affordance never loops on the same offset; both changes are additive to `/api/health`.

**Non-Goals:** reclassifying `session_updated` (partial merge — latest-wins would drop fields); reordering guarantees between a deferred `sessions_reordered` and an immediate `session_added` (the client already tolerates unknown ids and tail-keeps held ids, so either order converges).

## Decisions

### D1 — `sessions_reordered` → `state`, key `sessions_reordered:<cwd>`

One `case` in `frameClassOf`. Correctness argument: at the choke point the frame is already the full visible ordering for that cwd (D4 projection), so per-cwd latest-wins loses nothing. Every reorder producer routes through `broadcast()` (`broadcastToAll` delegates; `ctx.broadcast` is wired to `browserGateway.broadcast`), so no path reaches `sendTo` unprojected — verified in review.

Interleaving with transcript frames: a deferred reorder flushed after a later `session_added` for the same cwd omits the new id → the client keeps it at the tail (existing rule). **Accepted trade-off (review finding):** the original claim "the next reorder or snapshot places it" is too strong — with `completedFirst` off, no reorder fires for an ordinary alive-session spawn (`event-wiring.ts` gates move-to-front on `completedFirst`), so a tail-displaced session can STAY at the tail until the next snapshot, which may be indefinite. The card is visible and correct; only its ordering is stale. Still strictly better than today's silent shed (card absent entirely), so accepted, not fixed.

*Alternative rejected:* debt-register the reorder — it has no per-session id to reconcile from; the frame IS the state.

### D2 — Debt register gains a kind + optional `spawnRequestId`

`StatusDebt.ids: Set<string>` → `entries: Map<string, { kind: "updated" | "added" | "removed"; spawnRequestId?: string; sawAdd: boolean }>`. `sawAdd` is set the moment an `added` is recorded for that id and survives the kind being superseded by `removed`; it is the register's memory that the client was never successfully told this session exists.

**Precedence — restated (review finding: the original text self-contradicted, asserting `removed > added` while also saying `added` overwrites `removed`).** The flush rebuilds from CURRENT server state, so the kind only has to record *what shape of frame is owed*, not replay history — except for the one bit (`sawAdd`) that records whether an add ever failed to reach this socket. The rule is therefore **last-write-wins on the lifecycle kinds, with `updated` unable to downgrade**:

- a newly recorded `added` or `removed` always overwrites whatever was there (last lifecycle event is the true one);
- a newly recorded `updated` overwrites only an existing `updated` (never downgrades a pending `added`/`removed`).

This is coherent, and add-then-remove / remove-then-re-add both resolve to the last event — which is what the client needs.

`broadcast()` derives `dirty` for the three types (`session_added` → `{id: msg.session.id, kind: "added", spawnRequestId: msg.spawnRequestId}`; `session_removed` → `{id, kind: "removed"}`; `session_updated` → `{id, kind: "updated"}`). Note `session_added` carries the id at `msg.session.id`, NOT at a top-level `sessionId` — any shared dirty-derivation or shed-site helper MUST NOT assume `msg.sessionId` (it would record `undefined`).

**`sendTo` shed site must be amended too (review finding — this was missing and breaks self-healing for exactly the new kinds).** The reconcile frames are emitted through `sendTo`, whose shed branch today re-records only `if (msg.type === "session_updated") recordStatusDebt(ws, msg.sessionId)`. Without extending that branch to `session_added` / `session_removed` (each with its correct id accessor and kind), a reconcile of a new kind that is itself shed is lost — violating the self-healing requirement. `sendTo` re-records the SAME kind it was sending.

`flushStatusDebt` dispatch, in this order:

1. `kind === "removed"`, `s = sessionManager.get(id)`:
   - `s` absent → send `session_removed {sessionId}`.
   - `s.status !== "ended"` → the id was re-registered after the shed removal and is live again → the removal is superseded → send `session_added {session: s, reconciled: true}`.
   - `s.status === "ended"` and `entry.sawAdd` → this session's `session_added` was ALSO shed, so the browser holds no row and a `session_removed` would no-op into silence → send `session_added {session: s, reconciled: true}` carrying the ended record, so the session still appears (in its ended tier).
   - `s.status === "ended"` and not `sawAdd` → the browser holds the row; the removal is still true → send `session_removed {sessionId}`.
2. else `s = sessionManager.get(id)`; `!s` → send `session_removed {sessionId}`.
3. else `kind === "added"` → send `session_added {session: s, spawnRequestId?, reconciled: true}` built from the same record-shaping helper `broadcastSessionAdded` uses, so the record shape cannot drift.
4. else → `session_updated {status, currentTool, hostPressure}`.

**Why this shape (three review cycles).** Cycle 1 found the original `!s → removed / added → added / else → updated` table had no branch for an owed `removed` whose record still exists, so it emitted `session_updated` and left a ghost ended card. Cycle 2 disproved the obvious fix (send `session_removed` unconditionally): if the id is re-registered while the removal is owed and the new `session_added` is DELIVERED, the unconditional removal lands afterwards and marks a LIVE row ended with no successor — the exact unbounded-stale bug this change exists to kill. Cycle 3 then disproved the fix for THAT (a monotonic registration epoch): its map had no defined lifetime, `getRegistrationEpoch` had no defined value for a missing entry (design and spec mandated different frames for that corner), and `restore()` re-enters an id without `register()`, so the premise "epoch advanced ⇔ new life" was false.

The record's own status already carries the signal the epoch was being invented to carry: `register()` sets `status: "active"` unconditionally, and `unregister()` sets `status = "ended"` while KEEPING the record. So `status !== "ended"` means "re-registered since" and `status === "ended"` means "the removal still stands" — read at flush time, which is consistent with this design's rebuild-from-CURRENT-state principle rather than comparing a value captured at shed time. No manager API, no new map, no `restore()` coupling (a restored row is forced ended, which resolves correctly).

Cycle 3's `unregister()` reading also corrects the narrative: because `unregister()` keeps the record, `s` almost ALWAYS exists at flush. The `s.status === "ended"` branch is the hot path for a shed removal; `s` absent is the rare one (archive deletes the record).

`sawAdd` closes the one case the epoch handled better: a session created AND ended entirely inside one flood window, where both its `session_added` and its `session_removed` were shed. Without the flag the flush would send `session_removed` for an id the browser never heard of — a silent no-op, and the session would be missing from the sidebar until the next snapshot. `sawAdd` is exactly the condition "the add never reached this socket", so it is a 1-bit answer requiring no server-side per-socket held-set.

**Invariant this rule depends on:** `register()` is the only path that puts a non-ended status on a record. A task asserts it, so the rule cannot silently rot if a future path starts reviving records without registering.

**`hostPressure` stays in the rebuild (review finding — omitting it re-breaks a fixed bug).** The current flush sends `updates: { status, currentTool: … ?? null, hostPressure: … ?? null }`, and the `?? null` is load-bearing (`See change: fix-false-unresponsive-badge`): `hostPressure` is pushed on a TRANSITION only, so a shed pressure frame has no successor and the false-unresponsive badge stays lit until reconnect. The earlier `{status, currentTool}` shorthand in this design and in the spec delta was an omission, not a decision. Unchanged from today.

A shed reconcile re-records with the same kind (existing self-heal). Counters `statusReconcileQueued`/`statusReconcileSent` count all kinds — no new health field; the `DroppedFrameStats` doc comment that calls them "shed `session_updated` captures" is updated to say registry frames.

**Reconciled `session_added` carries `reconciled: true` (additive optional field on `SessionAddedMessage` in `packages/shared/src/browser-protocol.ts`).** The client's `session_added` handler runs a spawn cascade: consume `pendingSpawnsRef`, `clearSpawningCwd`, then `navigate()`. `pendingSpawnsRef` entries have NO TTL, so a late reconcile would yank the user off whatever session they had navigated to. On `reconciled: true` the client performs the cleanup half (consume the pending spawn, clear the spawning placeholder — otherwise the placeholder spinner never stops) and SKIPS `navigate()`.

**`reconciled` suppresses ALL navigating tiers, not just the first (review finding).** The cascade navigates via three tiers — exact `spawnRequestId` match, the legacy cwd fallback, and the worktree fallback. A reconciled add with no `spawnRequestId` (a server-initiated spawn) would still navigate through tiers 2 and 2.5. `reconciled: true` gates the navigation for every tier.

**Cleanup on a reconciled add is `spawnRequestId`-scoped only (review finding D-5).** The cwd-matching tiers clear `spawningCwds` by cwd and first-match-wins by path key. A reconciled add for a removed-then-re-registered session carries no `spawnRequestId` by construction, so running the cwd-tier cleanup would clear an UNRELATED concurrent user spawn's placeholder in the same cwd — and that unrelated spawn would then lose its own auto-navigate. So a reconciled add performs pending-spawn/placeholder cleanup ONLY on an exact `spawnRequestId` match; with no request id it is a pure upsert that touches no spawn state.

Client upsert check: the `session_added` handler replaces the map entry wholesale AND runs a sibling loop clearing `resuming: false` on other sessions in the same cwd — so a reconciled duplicate add can corrupt sibling `resuming` state. Task 2.1 verifies both the record-field question and this sibling side effect, and makes the handler merge (`{...existing, ...msg.session}`) plus scope the sibling loop so a reconciled add cannot disturb it.

*Alternative rejected:* `session_added`/`session_removed` as `state` with key `session:<id>`. Deferred-not-shed sounds better, but a deferred `session_added` carries the record as it was at broadcast time, so a `session_updated` (transcript, immediate) can arrive first and be applied to a row that does not exist yet, then the stale add overwrites the fresher status. The debt register rebuilds from current state at flush and has no such inversion.

### D3 — Paging: reply generation + exhausted set, derived in `useMessageHandler`, owned in `App.tsx`

`sessions_page_result` handler bumps `pageReplyGen: Map<key, number>` and sets/clears `pageExhausted: Set<key>` from `hasMore`. `SessionList` receives both: the release effect keys on `pageReplyGen` instead of `pagedCount`; `requestEndedPage` and the affordance predicate additionally require `!pageExhausted.has(key)`. `pagedCount` semantics (offset) unchanged.

**Key space (review finding).** `sessions_page_result.cwd` and the keys of `endedTotals` are BOTH the sidebar group key (pinned directory, else worktree main path, else session cwd) — the `session-listing` spec already states this, and the client derives it via `endedTotalsGroupKey`. `pageReplyGen` and `pageExhausted` MUST be keyed in that same space. Using a raw session `cwd` for one and a group key for the other makes the exhausted mark unclearable; a test pins the equivalence for a worktree session.

**Clear rule — six mutation sites, plus an unconditional snapshot clear (review finding; the original named only two, a second cycle found a fifth, and the reconcile adds a sixth).** `endedTotals` is mutated at: `session_updated` → ended (+1), `session_removed` (±1, including live-removed +1), `session_archived` (−1), snapshot wholesale replace, the server-switch/disconnect reset in `App.tsx` (`setEndedTotalsMap(new Map())`), and — new in this change — `session_added` introducing a NOT-previously-held session whose record is already ended (+1). That last one exists because the reconcile can deliver an already-ended session as an add (the `sawAdd` branch); without it the row would render in the ended tier while the group's count ignored it. It is guarded on "not previously held" so a re-delivered reconcile cannot double-count. Wiring the clear as a *diff on the map* rather than as an enumerated list of call sites is the safer implementation, since it cannot miss a site. A change at any of them deletes that key from `pageExhausted`. The snapshot case clears **unconditionally**, not on a value diff: a snapshot also resets `pagedCount` to empty, so a reconnect whose totals happen to be identical would otherwise leave the key exhausted while the offset went back to 0, suppressing "More" for genuinely reachable sessions.

*Why not release inside the handler:* the mark and its timer live in `SessionList` state; crossing that boundary with a callback would couple the handler to a component. A generation counter is the minimal signal. Note the state itself (`endedTotalsMap`, `pagedCount`) lives in `App.tsx` and is threaded into the handler as setters, so the "clear on `endedTotals` change" step is wired where those setters are owned — the handler's updaters stay pure (StrictMode-safe).

## Risks / Trade-offs

- [Reconcile `session_added` for a session the browser holds resets fields the client had locally mutated on the record] → verified in 2.1; whether a row is held is not knowable server-side, so the client handler is made to merge over the existing row (`{...existing, ...msg.session}`), which is what an upsert should be anyway.
- [Debt entry grows from an id to id+kind+short string] → still O(ids), bounded by the session count; no payloads.
- [A `hasMore:false` reply while `endedTotals` is stale on the client keeps "More" hidden] → the exhausted mark clears on any of the four `endedTotals` mutations, and a snapshot always clears it unconditionally.
- [`endedTotals` is a PROXY for the pageable set, not the set itself] → a newly-ended session usually lands inside the visible window (pageable unchanged) yet bumps the total and clears the exhausted mark, costing one no-op re-request at the same offset. Accepted: it is convergent and rate-limited by real session events, and it is the only signal the client has. The "never loops" guarantee therefore means "never loops unprompted", not "never re-requests an offset".
- [A tail-displaced session can stay mis-ordered indefinitely] → see D1; visible-but-mis-ordered is accepted over today's invisible.
- [D1 shifts reorder frames from "shed and free" into `pendingState` retention] → **accepted, documented, not bounded.** A `state` frame is RETAINED per delivery key instead of dropped, so a saturated socket now holds one serialized ordering per group key. The base requirement "Memory on a stalled socket is bounded" terminates a socket that crosses the pending-state byte ceiling, so a socket with many group keys and large orderings can now be terminated where it previously survived by shedding. The ceiling and the shed threshold are NOT changed by this change (declared non-goal); the pressure on them rises. Accepted because retention is exactly the property that makes the reorder recoverable, and per-key coalescing caps retention at one frame per group key rather than letting it grow with the event rate.
- [Absence caused by ARCHIVE is treated as removal (review finding D-6)] → a session archived while a debt is owed leaves the manager (`remove()`), so the flush's "record absent" branch sends `session_removed`. `session_archived` is itself a transcript frame outside the debt register, so if it was ALSO shed the row settles into the ended tier rather than folding into the archive tier. Accepted for this change and covered by a scenario; bringing `session_archived` into the debt register is a separate gap, not reopened here.
- [Health-counter reclassification] → shed reorders previously landed in `droppedFrames.total`; as a `state` frame they now land in `coalescedState` instead. No field is added or removed, but a consumer watching `droppedFrames.total` sees a drop and `coalescedState` a rise. Called out here because it is visible in `/api/health` even though the counter set is unchanged.

## Migration Plan

Server change is protocol-compatible (frame types unchanged). Restart server, rebuild client. Rollback: revert; no persisted state.
