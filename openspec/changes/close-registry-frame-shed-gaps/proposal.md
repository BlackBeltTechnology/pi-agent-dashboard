## Why

`fix-connect-snapshot-frame-loss` gave every server→browser frame a delivery class and `fix-backpressure-status-and-subagent-frames` made a shed `session_updated` a reconciled debt. Two gaps were deliberately left and filed:

- **#648** — `sessions_reordered`, `session_added`, and `session_removed` are still `transcript`-class: shed silently under back-pressure, unrecoverable (no seq, no backfill, no later frame guaranteed to supersede). A shed `session_added` is the worst case: the card never appears until reconnect.
- **#649 (1)** — the sidebar's per-group paging in-flight mark is released only when `pagedCount[cwd]` advances. On the accepted D5 drift (a session removed below the cursor shrinks the pageable set) the server answers `sessions: []`, nothing advances, and "More" is dead for the 15 s timeout — then re-requests the same offset forever. Items (2) and (3) of #649 are already fixed on `develop` (`retryTick`, `requestId` match).

## What Changes

- **`sessions_reordered` becomes `state`-class**, delivery key `sessions_reordered:<cwd>`. It is already a window-projected FULL per-cwd ordering snapshot at the `broadcast` choke point, so latest-wins per cwd is exact; the client's reducer already tolerates unknown ids and keeps held ids at the tail.
- **Shed `session_added` / `session_removed` join the reconcile debt register.** The per-socket record keeps identifiers only, now tagged with the strongest owed kind per id (`removed` > `added` > `updated`) plus the `spawnRequestId` of a shed `session_added` (a short string, not a payload). On drain the reconcile emits, from CURRENT server state: `session_removed` when the session no longer exists (regardless of kind), `session_added` rebuilt from the full record (with the recorded `spawnRequestId`) for an owed add, and today's `session_updated` (`status`/`currentTool`) for an owed update. Self-healing, teardown release, and the byte-free invariant carry over unchanged.
- **Paging mark released on any reply.** The client keeps a per-cwd reply generation bumped by every `sessions_page_result` for that cwd; the in-flight mark releases when the generation changes, not when the count advances. A reply with `hasMore: false` additionally marks the cwd exhausted so "More" is hidden until `endedTotals[cwd]` changes — the affordance can no longer loop on the same offset.

Out of scope: any change to the pending-state byte ceiling or the shed threshold; reclassifying `session_updated` (partial merge — the debt register is its correct treatment).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ws-frame-delivery-policy`: "Every server-to-browser frame has a delivery class" — `sessions_reordered` moves to `state`; "A shed session_updated SHALL be reconciled from current state" — widened to cover `session_added` and `session_removed` and renamed accordingly.
- `session-listing`: "Browser pages older ended sessions on demand" — the in-flight mark releases on any reply for the cwd; a `hasMore: false` reply suppresses the affordance until the ended total changes.

## Impact

- `packages/server/src/pairing/browser-gateway.ts` (`frameClassOf`, `broadcast` dirty-id derivation, `StatusDebt` shape, `recordStatusDebt`, `flushStatusDebt`), its `AGENTS.md` sidecar, `packages/server/src/__tests__/browser-gateway-*` tests.
- `packages/client/src/hooks/useMessageHandler.ts` (reply generation + exhausted set), `packages/client/src/components/session/SessionList.tsx` (release on generation; hide "More" while exhausted), `packages/client/src/App.tsx` (thread the two maps), tests beside each.
- `/api/health` `DroppedFrameStats`: `statusReconcileQueued`/`statusReconcileSent` keep counting every kind (no new field).
- `docs/architecture.md` frame-delivery-policy section.

## Discipline Skills

- `doubt-driven-review` — reclassifying a registry frame changes ordering guarantees relative to `session_updated`; reviewed before it stands (design D1 records the argument).
- `review-code` — before commit. No untrusted input, endpoint, or latency budget is introduced.
