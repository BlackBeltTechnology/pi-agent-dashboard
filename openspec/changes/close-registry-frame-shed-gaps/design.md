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

One `case` in `frameClassOf`. Correctness argument: at the choke point the frame is already the full visible ordering for that cwd (D4 projection), so per-cwd latest-wins loses nothing. Interleaving with transcript frames: a deferred reorder flushed after a later `session_added` for the same cwd omits the new id → the client keeps it at the tail (existing rule) → the next reorder or snapshot places it. No worse than a shed today; strictly better.

*Alternative rejected:* debt-register the reorder — it has no per-session id to reconcile from; the frame IS the state.

### D2 — Debt register gains a kind + optional `spawnRequestId`

`StatusDebt.ids: Set<string>` → `entries: Map<string, { kind: "updated" | "added" | "removed"; spawnRequestId?: string }>`. `recordStatusDebt(ws, id, kind, spawnRequestId?)` merges by precedence `removed > added > updated` (a later `added` after a recorded `removed` for the same id still wins because the record is replaced when the NEW frame is `added` and the session exists — see flush). Simpler statement used in code: on record, `removed` always overwrites; `added` overwrites `updated` or `removed`; `updated` never downgrades. `broadcast()` derives `dirty` for the three types (`session_added` → `{id: msg.session.id, kind: "added", spawnRequestId: msg.spawnRequestId}`; `session_removed` → `{id, kind: "removed"}`; `session_updated` → `{id, kind: "updated"}`).

`flushStatusDebt`: for each entry, `s = sessionManager.get(id)`; `!s` → send `session_removed {sessionId}`; `kind === "added"` → send `session_added {session: s, spawnRequestId?}` via the same builder `broadcastSessionAdded` uses (so the record shape cannot drift); else `session_updated {status, currentTool}` as today. A shed reconcile re-records with the same kind (existing self-heal). Counters `statusReconcileQueued`/`statusReconcileSent` count all kinds — no new health field.

Client upsert check: `session_added` handler replaces the map entry wholesale; client-local flags (`resuming`, loading-history) live in separate state keyed by id, not on the record — verified in task 2.1 before relying on it.

*Alternative rejected:* `session_added`/`session_removed` as `state` with key `session:<id>`. Deferred-not-shed sounds better, but a deferred `session_added` carries the record as it was at broadcast time, so a `session_updated` (transcript, immediate) can arrive first and be applied to a row that does not exist yet, then the stale add overwrites the fresher status. The debt register rebuilds from current state at flush and has no such inversion.

### D3 — Paging: reply generation + exhausted set, both owned by `useMessageHandler`

`sessions_page_result` handler bumps `pageReplyGen: Map<cwd, number>` and sets/clears `pageExhausted: Set<cwd>` from `hasMore`. Any change to `endedTotals[cwd]` (snapshot apply, `session_updated` → ended) deletes the cwd from `pageExhausted`. `SessionList` receives both: the release effect keys on `pageReplyGen` instead of `pagedCount`; `requestEndedPage` and the affordance predicate additionally require `!pageExhausted.has(cwd)`. `pagedCount` semantics (offset) unchanged.

*Why not release inside the handler:* the mark and its timer live in `SessionList` state; crossing that boundary with a callback would couple the handler to a component. A generation counter is the minimal signal.

## Risks / Trade-offs

- [Reconcile `session_added` for a session the browser holds resets fields the client had locally mutated on the record] → verified in 2.1; if any such field exists, the reconcile path sends `session_updated` for held-on-client is not knowable server-side — instead the client handler is made to merge over the existing row (`{...existing, ...msg.session}`), which is what an upsert should be anyway.
- [Debt entry grows from an id to id+kind+short string] → still O(ids), bounded by the session count; no payloads.
- [A `hasMore:false` reply while `endedTotals` is stale on the client keeps "More" hidden] → the exhausted mark clears on the next `endedTotals` change; a snapshot always resets it.

## Migration Plan

Server change is protocol-compatible (frame types unchanged). Restart server, rebuild client. Rollback: revert; no persisted state.
