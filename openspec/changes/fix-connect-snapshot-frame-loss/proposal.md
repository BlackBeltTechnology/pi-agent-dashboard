## Why

On every browser connect the gateway sends `sessions_snapshot` first — measured **4,076 sessions ≈ 4.16 MB**, ~4,000 of them `ended` — which alone overshoots the 4 MB `MAX_WS_BUFFER` back-pressure cap. Every frame queued behind it is then silently shed by `sendTo`, including the per-cwd `openspec_update` connect snapshot (30 KB total across all cwds; the gateway comment promises *"exactly one per cwd, never silently omit"*). Nothing re-emits a shed state frame: the poll broadcasts only on JSON change, so a cwd whose OpenSpec data is static — a worktree that finished planning — never recovers. Symptom: the OPENSPEC subcard is missing from session cards, non-deterministically, for the life of the page. `/api/health` shows 69,723 dropped server→browser frames, 7,343 of them recorded without a `sessionId` (the `fanout` path — state and session-registry broadcasts; today's instrumentation cannot split those two).

Two structural faults, not one bug:

1. **Class-blind shedding.** `sendTo`/`fanout` drop whatever crosses the threshold. Transcript frames are recoverable (history backfill, replay); state frames (`openspec_update`, `git_head_update`, prefs, reachability, …) are idempotent snapshots with no recovery path.
2. **Unbounded bootstrap frame.** `sessions_snapshot` grows with lifetime session count and is emitted before every small state frame.

## What Changes

### Frame delivery policy (server → browser)

Every frame the browser gateway sends has a class:

- `transcript` — per-session event stream. Subject to the `MAX_WS_BUFFER` shed exactly as today.
- `blocking` — the existing pending-prompt critical-frame exemption. **Unchanged**: 4 frames/delivery, ceiling `MAX_WS_BUFFER + 1 MB`, dropped above the ceiling.
- `state` — idempotent snapshot keyed by `(type, entityKey)` where `entityKey` is the frame's entity id (`cwd` for `openspec_update` / `git_head_update` / `sessions_page_result`, `terminalId` for `terminal_added` / `terminal_updated` / `terminal_removed` — all three share one key so latest-wins preserves lifecycle order, `""` for singletons such as `sessions_snapshot`, `pinned_dirs_updated`, `display_prefs_updated`). A `state` frame is **never shed and never exempt**: while the socket is over the threshold it is *deferred* into a per-socket pending map (latest wins per key) and flushed, in key-insertion order, once the socket's buffered amount falls back under the threshold — checked on each send-completion callback **and** by a short timer while the map is non-empty (`ws` has no drain event; the timer covers a socket that drains with no further sends).
  - Memory bound: the pending map holds at most one frame per key, **and** its total bytes may not exceed `MAX_WS_BUFFER`. A socket whose pending map would exceed that ceiling is terminated as stalled; the browser's existing reconnect path rebuilds state from a fresh bootstrap. Worst case per socket = `MAX_WS_BUFFER` (threshold) + one state frame (the under-threshold send that crosses it) + `MAX_WS_BUFFER` (pending map) + 1 MB (blocking slack) — bounded because the largest state frame is itself bounded by the snapshot rule below.
  - `/api/health#droppedFrames` gains `coalescedState` (pending entries overwritten by a newer frame — informational) and `stalledSocketsTerminated`. No `state` drop counter exists because no path drops a state frame.
- Session-registry broadcasts (`session_updated`, `sessions_reordered`, …) keep today's class (`transcript`-like shed). Reclassifying them is a follow-up, not this change.

### Connect bootstrap order

Every connect-bootstrap frame the gateway emits today — `pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, per-cwd `openspec_update`, per-cwd `git_head_update`, `terminal_added` — is classified `state` and emitted **before** `sessions_snapshot`. The `gateway.onConnect` emissions (`servers_discovered`, recovery offer) keep their current class and position; they are not session-registry sends. `sessions_snapshot` is `state` (singleton key) and is the **last** bootstrap frame. The existing invariant "exactly one `sessions_snapshot` per connect, before any other *session-registry* send" holds — none of the frames moved ahead of it are session-registry sends.

### OpenSpec state: connect push + pull

- The connect push keeps its current scope (the known set: pinned dirs ∪ cwds of non-ended sessions, ≈17 today); what changes is only its class (`state`).
- New browser→server message `openspec_get { cwd }`. Server behaviour, via a new `directoryService.getOrPollOpenSpec(cwd)`:
  1. cache hit → unicast `openspec_update` with the cached payload;
  2. cache miss → immediate unicast placeholder `{ initialized:false, pending, changes:[], hasOpenspecDir, readiness }` (readiness fold included — `ABSENT` when no `openspec/`, else `PENDING`); then, if `openspec/` exists, **one** poll through `pollDirectoryGated` (mtime-respecting, serialized by the existing spawn semaphore, no scheduler/jitter involvement). The poll result — success or the finalized non-initialized payload the fold produces on CLI failure — is unicast to the requester unconditionally, and broadcast to other browsers only if it differs from the prior cache (the existing compare-before-broadcast discipline, reused not duplicated).
  - `openspec_get` never force-polls (`openspec_refresh` keeps that role) and never adds the cwd to the scheduler's known set.
- `openspec_get` carries a client `requestId`; replies are `openspec_get_result { requestId, cwd, data, final }` (the client applies `data` to `openspecMap` exactly as an `openspec_update`; `final:false` marks the placeholder, `final:true` the poll outcome). Gates before any spawn: `openspec.enabled === false` → `GLOBAL_OFF` placeholder, no poll; cwd in `openspec.optOutDirectories` → `OPTED_OUT`, no poll; **cwd not present in the session registry (any status) and not pinned → `ABSENT` placeholder, no poll** — the server spawns only for cwds it already tracks sessions for, so a remote client cannot point it at an arbitrary path.
- Client: the pull is a **reconciliation**, not a mount effect — whenever `(rendered cwd set) − (openspecMap keys) − (in-flight set)` is non-empty, the client sends `openspec_get` for each missing cwd. It re-evaluates on connection open (every reconnect), on `sessions_snapshot`, and on any change to the rendered set or `openspecMap`. **At most one in-flight per cwd**, released on the `final:true` reply, on a 15 s timeout, or on reconnect (the in-flight set is cleared when the socket opens). The manual refresh control remains the force-poll escape hatch.

### `sessions_snapshot` windowed (C2)

- `sessions` = every non-ended session + `ended` sessions inside a fixed window: the **newest 120 ended overall** plus the **first 3 of the ended sequence per session group that has a non-ended session or is pinned** (constants; sized in design with a 10 % margin). "Session group" is the key the sidebar already groups by (pin > worktree main path > cwd), so worktree sessions window and page inside their parent group. The snapshot carries `endedTotals` for **every** cwd with ended sessions (≈418 today, ~25 KB) so a cwd whose sessions are all outside the window still renders a stub folder group with an ended expander — nothing becomes unreachable.
- `orders` is windowed identically — it never references an id absent from `sessions`. The live `sessions_reordered` broadcast is projected through the same window, and the client ignores order ids it does not hold (defensive on both sides).
- New pair `sessions_page { cwd, offset }` (offset = paged ended sessions already held for that cwd) → `sessions_page_result { cwd, sessions[], order[], hasMore }`; pages walk the cwd's ended sequence with the window excluded, so no session can be stranded between window and cursor. The client **merges** a page into its map and appends the page's `order` after its current per-cwd order, de-duplicating ids already held; pages are requested sequentially per cwd. **Trade-offs**: (a) an ended session the user had manually interleaved among active ones re-appears at the tail after paging; (b) paged-in sessions are discarded on the next `sessions_snapshot` (reconnect) — the expander shows the window again and the user re-pages.
- **Hard bound**: `sessions_snapshot` ≤ **400 KB** at ≤ 25 non-ended + 4,000 ended sessions across 400 cwds — enforced by an L1 test over a synthetic registry built from measured row shapes. (Measured today: live row 6.7 KB, ended row 1.0 KB; 10 live, 4,066 ended, 418 ended cwds.)

### `sessions_snapshot` row slimming (C3) — `notifyLog` only

Measured: `notifyLog` is **63.5 % of a live row and 12.5 % of an ended row**, and it is already replayed to a browser on subscribe (`replayNotifyLog`) — the card never reads it. Snapshot and page rows omit `notifyLog`; no new message is needed. Live `session_updated` frames are untouched. **Trade-off**: a browser bundle from a *previous* release left open across the upgrade sees an empty notify log for an unsubscribed session until it subscribes or reloads. No other field is slimmed in this change.

### Out of scope

Bridge protocol, pi extension, OpenSpec poll scheduler, mtime gate. An active (non-ended) session card displays exactly what it does today.

### Compatibility

- Bridges: untouched.
- Older browser bundles (tab left open across a server upgrade): state-first ordering and deferral are harmless; the windowed snapshot is a subset, so the old bundle lists only windowed ended sessions until reload — **accepted trade-off** (the dashboard serves its own bundle; reload converges). Unmatched message types are ignored by the client switch (it has no `default` branch and needs none).

## Capabilities

### New Capabilities
- `ws-frame-delivery-policy`: frame classes (`transcript` | `blocking` | `state`), the shed / exemption / deferral rule per class, per-key + per-socket byte bounds, stalled-socket termination, the connect-bootstrap ordering invariant, and the `coalescedState` / `stalledSocketsTerminated` counters.

### Modified Capabilities
- `browser-gateway-decomposition`: on-connect bootstrap emits every state frame before `sessions_snapshot`; snapshot `sessions` + `orders` windowed with `endedTotal`; ≤ 400 KB bound.
- `server-openspec-polling`: connect snapshot delivered as `state`; `openspec_get` / `getOrPollOpenSpec` cache-hit, cold-cache placeholder (with readiness), single gated poll, unicast-always / broadcast-on-change.
- `session-listing`: snapshot carries windowed ended sessions; `sessions_page` merges (tail-append order); live `sessions_reordered` windowed; the atomic-replace requirement is restated as "replace on snapshot, merge on page"; client OpenSpec-entry reconciliation pull.
- `shared-protocol`: new messages `openspec_get` / `openspec_get_result` (with `requestId`, `final`), `sessions_page` / `sessions_page_result`; `endedTotals` on the snapshot; snapshot/page rows omit `notifyLog`.

Not modified (verified still literally true): `app-decomposition` (snapshot remains the sole post-reconnect authority; pages merge afterwards) and `pending-prompt-recovery` (state frames are deferred, never *exempt*, so "above which no frame is exempt" holds; blocking bounds unchanged). `ws-frame-delivery-policy` cross-references both.

## Impact

- `packages/server/src/pairing/browser-gateway.ts` — `sendTo`/`fanout`/`broadcast` take a frame class; per-socket pending-state map, byte ceiling, flush on send completion, stalled-socket termination; connect handler reordered; counters.
- `packages/server/src/routes/system-routes.ts` — `/api/health#droppedFrames` surfaces `coalescedState`, `stalledSocketsTerminated`.
- `packages/server/src/directory-service.ts` — `getOrPollOpenSpec(cwd)` wrapper over `pollDirectoryGated` + cache compare.
- `packages/server/src/browser-handlers/directory-handler.ts` — `openspec_get` handler.
- `packages/server/src/browser-handlers/session-meta-handler.ts` — `sessions_page` handler.
- `packages/server/src/session/session-manager.ts`, `session-order-manager.ts` — windowed snapshot / windowed orders projection, `endedTotal`; `sessions_reordered` projection.
- `packages/shared/src/types.ts` — frame-class type, new messages, `endedTotal`, `hasMore`.
- `packages/client/src/hooks/useMessageHandler.ts` — `sessions_page_result` merge; order-id filter; unicast `openspec_update` already handled.
- `packages/client/src/components/session/SessionList.tsx`, `SessionCard.tsx`, folder card, `App.tsx` — missing-entry `openspec_get` with per-cwd in-flight guard; ended-list expansion → sequential `sessions_page`.

## Discipline Skills

- `performance-optimization` — measured regression (4.16 MB frame vs 4 MB cap); the 400 KB snapshot bound and the per-class counters are the measurement gates.
- `observability-instrumentation` — `coalescedState` / `stalledSocketsTerminated` on `/api/health`, rate-limited log line per class; the fix must be provable at runtime.
- `doubt-driven-review` — the delivery-policy change touches a memory-protection guard; reviewed before it stands (plan-proposal step 2).
- `review-code` — non-trivial multi-package change; inline review before commit.
- `security-hardening` — triggered: `openspec_get` is a new browser-triggerable CLI-spawn path (reachable via zrok). Mitigations stated in WHAT: spawn only for a cwd already present in the session registry or pinned (never an arbitrary path); `openspec.enabled` and opt-out gates honoured; serialized by the existing `maxConcurrentSpawns` semaphore; at most one gated poll per request, never a force-poll. Note: the existing `openspec_refresh` handler has **no** cwd check today — flagged as a follow-up, not fixed here.
