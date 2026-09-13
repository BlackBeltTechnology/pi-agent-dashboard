## Context

Measured on the live dashboard (2026-09-12): 4,076 sessions (10 live, 4,066 ended, 418 ended cwds). `sessions_snapshot` = 4.16 MB; `MAX_WS_BUFFER` = 4 MB. Live row ≈ 6.7 KB (63.5 % `notifyLog`), ended row ≈ 1.0 KB. All per-cwd `openspec_update` connect frames together ≈ 30 KB. `sendTo` (`browser-gateway.ts:556-581`) and `fanout` (`:593-605`) shed any frame while `ws.bufferedAmount > MAX_WS_BUFFER`; the only carve-out is the `blocking` exemption (pending-prompt-recovery). The scheduler tick (`directory-service.ts:1246-1261`) broadcasts a cwd's result when the serialized payload changed **or** a transitional `pending:true` was emitted for it (`pendingWasEmitted`). `pollDirectoryGated` does not broadcast the result itself, but it does call `emitPendingIfDiscovered(cwd)`, which broadcasts a transitional `{ pending: true }` to all browsers when `<cwd>/openspec/changes` exists and the cache is not authoritative. `replayNotifyLog` already re-sends a session's notify log on subscribe. The in-memory registry is `session/memory-session-manager.ts`; `subscriptions` maps `ws → Set<sessionId>`.

Constraints: bridge protocol, poll cadence/jitter/known-set, mtime gate untouched (extracting the tick's per-cwd body into a shared function is behaviour-preserving); active card display unchanged; older browser bundles must degrade, not break; `ws` has no `drain` event.

## Goals / Non-Goals

**Goals:**
- No state frame is ever lost on a browser socket; memory per socket stays bounded.
- Connect bootstrap delivers every small state frame before the one large frame.
- `sessions_snapshot` bounded (≤ 400 KB at 25 live + 4,000 ended / 400 cwds) with nothing unreachable.
- A rendered card can always obtain its cwd's OpenSpec entry, including cold cache after restart.

**Non-Goals:**
- Reclassifying session-registry broadcasts (`session_updated`, `sessions_reordered`) as state — follow-up.
- Adding a cwd check to the existing `openspec_refresh` — follow-up (flagged).
- Slimming any field other than `notifyLog`.
- Changing the poll schedule, jitter, or mtime gate.

## Decisions

### D1 — Frame class is a static function of message type

`frameClassOf(msg): { cls: "state" | "transcript", key: string }` in `browser-gateway.ts`, a `switch` on `msg.type`; `key = entityKey ? \`${msg.type}:${entityKey}\` : msg.type` — the key always carries the type, so `openspec_update` and `git_head_update` for one cwd never collide, and `terminal_added|updated|removed` deliberately map to the shared prefix `terminal:<id>`. `state` types: `sessions_snapshot`, `pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, `openspec_update`/`openspec_get_result` (key `cwd`), `git_head_update` (key `cwd`), `sessions_page_result` (key `cwd`), `terminal_added`/`terminal_updated`/`terminal_removed` (key `terminal.id`). Everything else is `transcript`, except that a frame sent with `ctx.critical === true` is class `blocking` (the pending-prompt path) — so the three spec classes are exhaustive: `state` by type, `blocking` by the critical flag, `transcript` otherwise.
*Alternative rejected*: a `cls` field on the wire — leaks a server concern into the protocol and old bundles would carry an unknown field.

### D2 — Per-socket pending map with byte ceiling and two flush triggers

`PendingState = { map: Map<string, string /*serialized*/>, bytes: number, timer?: NodeJS.Timeout }` in a **new** side-table `pendingState: Map<WebSocket, PendingState>` (not `subscriptions`, whose value type is the subscribed-session set). Map key = the `key` from D1 (type-qualified); singleton types each get their own slot.
- `sendState(ws, key, serialized)`: if `ws.readyState !== OPEN` → return. If `MAX_WS_BUFFER === 0` (no-limit mode, used by tests) → plain send. If `bufferedAmount <= MAX_WS_BUFFER` and map empty → `ws.send(serialized, onSent)`; else defer: if `map.has(key)` subtract old bytes and `coalescedState++`; compute `len = Buffer.byteLength(serialized)`; if `bytes + len > MAX_WS_BUFFER` → `ws.terminate()`, `stalledSocketsTerminated++`, drop map; else set and start the timer if absent.
- Flush: `flush(ws)` guards `readyState === OPEN`, drains the map in insertion order while `bufferedAmount <= MAX_WS_BUFFER`, sending each with an `onSent` callback that re-calls `flush`. Timer: `setInterval(flush, 250 ms)` while map non-empty, cleared when empty. Order guarantee: a state frame never overtakes an earlier pending state frame (FIFO by first insertion; a superseded key keeps its slot).
- Transcript sends (`sendTo` non-state path, `fanout`) first attempt `flush(ws)` when the socket's pending map is non-empty, so a state frame that is already flushable is never overtaken by a later transcript frame; only if the map is still non-empty after that (socket still over threshold) does the transcript frame take the shed path.
- **Every** state-class send goes through `sendState`: `fanout`/`broadcast` per socket (incl. `broadcastOpenSpecUpdateImpl` with its pre-serialized string), the connect bootstrap, and handler unicasts (`openspec_get_result`, `sessions_page_result`) — `sendTo` itself dispatches on `frameClassOf(msg)` so a handler cannot accidentally route a state frame onto the shedding path.
- `ws.on("close")` / `error` clears the timer and map.
*Alternative rejected*: exempting state frames like `blocking` (unbounded, cycle-1 finding #1).

### D3 — Bootstrap reorder is a block move

In the `connection` handler, the `sessions_snapshot` block moves to after the `terminal_added` loop and after `gateway.onConnect(ws)`. Every other bootstrap send is unchanged in content; they now go through `sendState`. The "before any session-registry send" invariant is preserved: `sessions_snapshot` is still the first registry send.

### D4 — Snapshot window constants and `endedTotals`

**Group key, not raw cwd.** Every per-"cwd" structure in D4/D5/D9 — window buckets, `endedSequence`, `endedTotals`, `pageable`, `sessions_page.cwd`, stub groups — is keyed by the **session group key** `resolveOrderKey(session)` (pin > `gitWorktree.mainPath` > `cwd`; `packages/server/src/session/resolve-order-key.ts`), the same key the persisted orders already live under and that the client's `resolveSessionGroupPath` (`session-grouping.ts:91-104`) groups by. A worktree session therefore counts toward, and pages within, its parent group exactly as it renders today. The specs' `cwd` fields on `sessions_page`/`sessions_page_result` and the `endedTotals` keys carry this group key; the spec text says so.

`SNAPSHOT_ENDED_GLOBAL = 120`, `SNAPSHOT_ENDED_PER_GROUP = 3` in `memory-session-manager.ts` (the specs state the same numbers). **Ended sequence per group** `endedSequence(groupKey)` = the persisted order restricted to ended ids, followed by ended ids with no persisted position sorted by `startedAt` desc — byte-for-byte the ordering the client's `sortSessionsByOrder` (`session-grouping.ts:40-57`) renders today, so server and client agree on position. `snapshotVisibleIds(pinned)` (recomputed on every call) = all non-ended ∪ global newest-120 ended (by `endedAt ?? lastActivityAt ?? startedAt` desc, id tiebreak — `startedAt` is always set) ∪ per-group first-3 of `endedSequence(g)` for groups with a **non-ended** (`active | idle | streaming`) session or pinned. `buildSnapshot(pinned)` = `{ sessions: rows(visible), orders: order.filter(id ∈ visible), endedTotals }`; rows are `stripNotifyLog(session)`. **Live `sessions_reordered` projection happens at the gateway choke point, not in handlers**: `broadcast(msg)` in `browser-gateway.ts` — before serialization (`fanout` only sees strings) — on `msg.type === "sessions_reordered"` rewrites `sessionIds` through an injected `projectOrder(groupKey, ids)` = `ids.filter(id ∈ snapshotVisibleIds())`. All ten current broadcast sites (`session-meta-handler`, `terminal-handler`, `directory-handler`, `event-wiring` ×3, `server.ts` ×3, `session/reattach-placement.ts`) route through `broadcast`/`broadcastToAll` and are covered without touching them. The client's group key resolver is `resolveSessionGroupPath` in `packages/shared/src/session-group-path.ts` (imported by `session-grouping.ts`).
Budget (measured shapes, 25 live / 4,000 ended / 400 groups / **20 pinned**): live 25 × 2.5 KB (63 KB) + ended (120 + 3×(25+20)) × 0.9 KB (230 KB) + `orders` for ≤ 400 groups of windowed ids (≤ 40 KB) + `endedTotals` 400 entries (~25 KB) ≈ **358 KB** — 10 % margin under 400 KB. The L1 bound test builds rows from a fixture copied from a measured session (not a hand-made minimal object) and includes 20 pinned groups with ended history.

### D5 — `sessions_page` served from the in-memory registry

Handler in `session-meta-handler.ts`: `PAGE_SIZE = 50`. `pageable(g) = endedSequence(g).filter(id ∉ snapshotVisibleIds())` — the list of ended sessions a fresh snapshot would **not** carry. Request is `sessions_page { cwd: g, offset }` where `offset` = number of paged (non-window) ended sessions the client already holds for that group; reply = `pageable.slice(offset, offset + PAGE_SIZE)` as `{ sessions: rows.map(stripNotifyLog), order: ids in sequence order, hasMore: offset + PAGE_SIZE < pageable.length }`. Because the window is excluded from `pageable`, a user-reordered ended id outside the window sits at its sequence position and is reachable. `pageable` is not frozen per client. Two drift cases, both one-row and healed by reconnect, are accepted: (a) an ended session removed below the cursor, or a paged id re-entering the window (user reorders it into a group's first-3; a group becomes pinned/unpinned), shrinks `pageable` so the next page skips one row; (b) a window slide that pushes a row out into `pageable` re-delivers it (overwrite by id, harmless). Large-registry paging/stub scenarios are covered at L1 (handler + `useMessageHandler` + `SessionList` component tests over a synthetic registry); L3 only asserts the connect-time openspec coverage on the harness's small registry. Unicast through `sendTo` → `sendState` (key `sessions_page_result:<g>`).

### D6 — `openspec_get` → `directoryService.getOrPollOpenSpec(cwd)`

New method: `(cwd) => { hit?: OpenSpecData; poll?: Promise<OpenSpecData> }`.
- Gates evaluated in order: `!cfg.enabled` → `GLOBAL_OFF`; `isOptedOutCwd` → `OPTED_OUT`; `!tracked(cwd)` (not in `sessionManager.listAll()` cwds ∪ pinned) → `ABSENT`; `!hasOpenSpecRoot(cwd)` (`<cwd>/openspec/` — the root check the connect snapshot uses, **not** `hasOpenSpecDir` which requires `changes/`) → `ABSENT` with `hasOpenspecDir:false`. Gated results return `{ hit: placeholder(readiness) }` with no poll. A cwd with `openspec/` but no `changes/` proceeds to the poll, which yields the fold's `BROKEN · missing-changes-dir` exactly as the tick would.
- Cache hit (`caches.get(cwd)?.data`) → `{ hit }`.
- Else `{ hit: placeholder(PENDING), poll }`. `poll` is a **per-cwd in-flight promise** (`Map<cwd, Promise>`, entry deleted on settle — success or rejection — so a failed poll never poisons later requests; concurrent `openspec_get`s for one cold cwd share one poll) that runs `pollAndBroadcastIfChanged(cwd)` — a small extraction of the scheduler tick's per-cwd body (`prevJson` capture → `pollDirectoryGated` → `nextJson` compare → `pendingWasEmitted` → `onChangeCallback`). The tick calls the same function, so the compare-or-pending broadcast discipline has one implementation. `pollDirectoryGated`'s existing transitional `pending:true` broadcast (via `emitPendingIfDiscovered`) is retained — the spec's broadcast rule is scoped to the *final outcome*, which is change-gated. On CLI failure the fold's finalized non-initialized payload is what resolves.
- Handler: unicast `openspec_get_result { final: !poll }` for `hit` via `sendTo` (state class → `sendState`); on `poll` resolve, unicast `final: true` with the outcome; on `poll` **reject** (unexpected throw — `pollDirectoryGated` normally resolves the fold's finalized payload even on CLI failure), unicast `final: true` with a `BROKEN · cli-failed` placeholder so the requester always receives its final reply. The handler never broadcasts — the service already did if warranted.
*Alternative rejected*: `onDirectoryAdded` — also runs session discovery for the cwd; heavier than needed.

### D7 — Client reconciliation hook

`useOpenSpecReconcile({ renderedCwds, openspecMap, ws, status, snapshotGeneration })` in `packages/client/src/hooks/`: `inflight: Map<cwd, { requestId, timer }>`; `snapshotGeneration` is a counter `useMessageHandler` increments each time it applies a `sessions_snapshot`; effect on `[status === "connected", snapshotGeneration, renderedCwds, openspecMap]` sends `openspec_get` for `renderedCwds − settled(openspecMap) − inflight.keys`, where `settled` excludes entries whose `pending === true` (a `final:false` placeholder is not a settled entry, so a lost final reply is retried after the timeout rather than blocked forever); 15 s timeout per entry; on socket open clears `inflight`. `renderedCwds` = cwds of **non-ended** sessions currently rendered by `SessionList` ∪ pinned folder-card cwds ∪ the selected session's cwd (any status) — a `useMemo` over the already-computed groups (no per-card effect). Ended-session cards and stub groups do **not** trigger a pull: they render no OpenSpec section unless their cwd's entry exists for another reason. This caps cold-cache polls at the number of live cwds not already in the connect set (normally zero) plus one for the selected session, so `openspec_get` cannot stampede the shared semaphore on first render. `useMessageHandler` handles `openspec_get_result` by calling the same `openspecMap` setter as `openspec_update` and resolving the in-flight entry when `final`.

### D9 — Client paging, stub groups, order merge

- `useMessageHandler` gains `sessions_page_result`: `sessions` are set into the map (overwrite by id); `sessionOrderMap[cwd] = dedupe([...current, ...page.order])`; `pagedCount[cwd] += page.sessions.length`. `endedTotals` from the snapshot is stored in a new `endedTotalsMap` state, replaced on every snapshot and kept live: `session_updated` that transitions a held session to `ended` increments its cwd; `session_removed` of an ended session decrements. `pagedCount` resets on snapshot.
- `sessions_reordered` (live) is applied as `dedupe([...incoming, ...heldIdsNotInIncoming])` — held paged ids are kept at the tail instead of being evicted; ids not held in `sessions` are filtered out on apply ("ignore unknown order ids").
- `SessionList` group construction: a cwd with `endedTotalsMap.get(cwd) > 0` and no held session yields a **stub group** (header + ended expander only; no cards, no OpenSpec/KB/GIT sections). Stub groups are fed through the same `groupSessionsByDirectoryWithWorkspaces` path as an empty group for that group key, so workspace placement follows the preference exactly as a populated group would; in the unpinned recency sort an empty group sorts last (no recency key). The ended expander's label uses `endedTotals[cwd]`; a "more" affordance shows while `heldEnded < endedTotal`.
- Expander/more click: if `heldEnded < endedTotal` and `!pagingInflight.has(cwd)` → send `sessions_page { cwd, offset: pagedCount[cwd] ?? 0 }` and mark in-flight; cleared on `sessions_page_result` for that cwd, on a 15 s timeout, or on socket open.
- Reconnect: the snapshot replaces `sessions`/`sessionOrderMap`/`endedTotalsMap`, so paged rows vanish and the expander returns to its window state (documented trade-off).

### D8 — Health counters

`coalescedState` and `stalledSocketsTerminated` live beside the existing drop counters in the gateway's stats accessor; `system-routes.ts` surfaces them under `droppedFrames`.

## Risks / Trade-offs

- **Old bundle across upgrade**: sees only windowed ended sessions and empty notify logs for unsubscribed sessions until reload. Accepted; the server serves the bundle, reload converges.
- **Custom interleaving of paged ended sessions** is lost (tail-append); reconnect discards pages, and if the selected session was a paged row it is treated as removed until re-paged. Accepted; documented in proposal.
- **`endedTotals` counts hidden ended sessions**, so a cwd whose only sessions are hidden shows a stub group. Consistent with `endedTotals` semantics; noted.
- **Stall termination** closes a socket the browser may consider healthy (very slow network). The client's reconnect path is exercised anyway on every server restart; the bootstrap after reconnect is now small.
- **Flush timer** adds a 250 ms interval per socket only while its pending map is non-empty — zero cost in steady state.
- **`openspec_get` spawn path** is bounded by the semaphore, the tracked-cwd gate, per-cwd in-flight sharing, and the client's live-cwd-only pull rule; a hostile paired client can at most request one poll per tracked cwd at a time.
- **Window constants** are a judgement call sized to the measured registry; an L1 bound test pins the budget so a future row-shape growth fails loudly.
