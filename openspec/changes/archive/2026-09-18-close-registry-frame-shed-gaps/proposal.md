## Why

`fix-connect-snapshot-frame-loss` gave every server→browser frame a delivery class and `fix-backpressure-status-and-subagent-frames` made a shed `session_updated` a reconciled debt. Two gaps were deliberately left and filed:

- **#648** — `sessions_reordered`, `session_added`, and `session_removed` are still `transcript`-class: shed silently under back-pressure, unrecoverable (no seq, no backfill, no later frame guaranteed to supersede). A shed `session_added` is the worst case: the card never appears until reconnect.
- **#649 (1)** — the sidebar's per-group paging in-flight mark is released only when `pagedCount[cwd]` advances. On the accepted D5 drift (a session removed below the cursor shrinks the pageable set) the server answers `sessions: []`, nothing advances, and "More" is dead for the 15 s timeout — then re-requests the same offset forever. Items (2) and (3) of #649 are already fixed on `develop` (`retryTick`, `requestId` match).

## What Changes

- **`sessions_reordered` becomes `state`-class**, delivery key `sessions_reordered:<cwd>`. It is already a window-projected FULL per-cwd ordering snapshot at the `broadcast` choke point, so latest-wins per cwd is exact; the client's reducer already tolerates unknown ids and keeps held ids at the tail.
- **Shed `session_added` / `session_removed` join the reconcile debt register.** The per-socket record keeps identifiers only, now tagged with the owed kind per id (last-write-wins across `added`/`removed`; an `updated` never downgrades a pending lifecycle kind) plus the `spawnRequestId` of a shed `session_added` (a short string, not a payload). The entry also keeps one bit — whether a `session_added` for that id was itself shed while the debt stood — which survives the kind being superseded. On drain the reconcile emits, from CURRENT server state: `session_removed` when the record is gone, or is ended and the browser was known to have received its add; `session_added` rebuilt from the full record (with the recorded `spawnRequestId` and a `reconciled: true` marker) for an owed add, for a removal superseded by a re-registration (the record is no longer ended), or for a session whose creation AND ending were both shed (so it is presented rather than silently absent); and today's `session_updated` (`status`/`currentTool`/`hostPressure`) for an owed update. Distinguishing "re-registered" from "record outlived the removal" needs no new bookkeeping: `register()` sets `status: "active"` unconditionally and `unregister()` sets `status: "ended"` while keeping the record, so the record's own status is the incarnation signal, read at flush time. The shed site in `sendTo` re-records all three kinds, so self-healing covers the new kinds too; teardown release and the byte-free invariant carry over unchanged. `reconciled: true` tells the client to upsert and clear its spawn placeholder without stealing navigation.
- **Paging mark released on any reply.** The client keeps a per-group reply generation bumped by every `sessions_page_result` for that group key; the in-flight mark releases when the generation changes, not when the count advances. A reply with `hasMore: false` additionally marks the group exhausted so "More" is hidden until `endedTotals` for that key changes by any of its four mutation paths (ended transition, removal, archive, snapshot) — a snapshot clears it unconditionally, since a snapshot also resets the offset. Both marks are keyed in the same group-key space as `endedTotals`. The affordance can no longer loop unprompted on the same offset.

Out of scope: any change to the pending-state byte ceiling or the shed threshold; reclassifying `session_updated` (partial merge — the debt register is its correct treatment). Note that making `sessions_reordered` a `state` frame RETAINS it under back-pressure instead of dropping it, so pressure on the (unchanged) byte ceiling rises and shed reorders move from `droppedFrames.total` to `coalescedState` in `/api/health` — accepted and documented in design Risks rather than bounded.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ws-frame-delivery-policy`: "Every server-to-browser frame has a delivery class" — `sessions_reordered` moves to `state`; "A shed session_updated SHALL be reconciled from current state" — widened to cover `session_added` and `session_removed` and renamed accordingly.
- `session-listing`: "Browser pages older ended sessions on demand" — the in-flight mark releases on any reply for the cwd; a `hasMore: false` reply suppresses the affordance until the ended total changes.

## Impact

- `packages/server/src/pairing/browser-gateway.ts` (`frameClassOf`, `broadcast` dirty-id derivation, the `sendTo` shed-site re-record, `StatusDebt` shape, `recordStatusDebt`, `flushStatusDebt`, the `DroppedFrameStats` counter doc comment), its `AGENTS.md` sidecar, `packages/server/src/__tests__/browser-gateway-*` tests.
- `packages/shared/src/browser-protocol.ts` — additive optional `reconciled?: boolean` on `SessionAddedMessage`.
- `packages/server/src/session/memory-session-manager.ts` — no production change; a test asserts the invariant the reconcile rule leans on (registration is the only path that puts a record into a non-ended status).
- `packages/client/src/hooks/useMessageHandler.ts` (reply generation + exhausted set, reconciled-add handling, merge upsert), `packages/client/src/components/session/SessionList.tsx` (release on generation; hide "More" while exhausted), `packages/client/src/App.tsx` (thread the two maps; clear exhausted on `endedTotals` change), tests beside each.
- `/api/health` `DroppedFrameStats`: `statusReconcileQueued`/`statusReconcileSent` keep counting every kind (no new field).
- `docs/architecture.md` frame-delivery-policy section.

## Discipline Skills

- `doubt-driven-review` — reclassifying a registry frame changes ordering guarantees relative to `session_updated`, and the reconcile resolution rule is an invariant the compiler cannot check. Run to its 3-cycle bound during planning: cycle 1 caught a dropped `hostPressure` and a ghost-resurrection branch, cycle 2 disproved the first fix (it could end a live re-registered session), cycle 3 disproved the second (a registration epoch with an undefined lifetime and a `restore()` hole) and led to the status-based rule now in D2.
- `scenario-design` — ran at design stage; its HARD gate surfaced the `endedTotals` gap for a reconciled already-ended add. `test-plan.md` is the manifest and the sole source of the folded test tasks.
- `performance-optimization` — P1/P2 exist because D1 converts shed reorder frames into retained pending-state bytes, which feeds the socket-termination ceiling. Measure the coalescing invariant; do not tune the ceiling (declared non-goal).
- `review-code` — before commit. No untrusted input, endpoint, or latency budget is introduced.
