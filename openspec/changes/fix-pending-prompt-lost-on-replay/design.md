## Context

See proposal.md — Why. Design-relevant current state, verified on disk (symbols, not line numbers — the latter rot):

- `browser-gateway.ts` `sendTo(ws, msg, ctx?)` early-returns whenever `ws.bufferedAmount > MAX_WS_BUFFER` (4 MB default), counting via `recordDroppedFrame`. `sendToSubscribers` / `sendToSession` loop `sendTo`, so the live prompt fan-out is guarded. `broadcast`/`fanout` is a **separate** path with its own copy of the guard — a frame class on `sendTo` does not cover it (nothing in scope needs it to).
- `replayPendingUiRequests` sends two legs: `pendingUiRequests` → `extension_ui_request`, and `pendingPromptRequests` → the tracked `prompt_request`. The first leg is **dead**: `trackUiRequest` is only declared and exposed (`browser-gateway.ts`, `handler-context.ts`) with no production caller since the PromptBus migration, so `pendingUiRequests` is always empty. Only the prompt leg matters. `replayNotifyLog` is a sibling replaying retained notify rows (cap 50) — transcript history, not a blocking frame.
- A bridge `prompt_request` is handled in `event-wiring.ts`, which does several things before delivery: `trackPromptRequest`, `sessionManager.update({ currentTool: "ask_user" })`, unread stamping, session reordering, and collection into `replayPromptIds` during a replay window — then ends in `browserGateway.sendToSubscribers(sessionId, msg)`.
- The subagent-resync precedent lives in a **different** path: the requester branch is inside `broadcastEvent` (for `event` forwards carrying `__resyncRequestId`), using `ResyncRequesterRegistry` (`record` / `take` / `forget`, TTL 30 s, bounded) and `resyncRequestIdOf`. `take()` **consumes** the token, and that branch also suppresses delivery to a requester that is mid-replay.
- `PromptBus.getPendingRequests()` returns `{ request, component, placement }` for entries with a resolved component; its only caller is `onReconnect` in `bridge.ts`. Entries without a resolved component were never emitted to a dashboard (the emit is gated on the same condition).
- Client state is wiped at **five** sites, each today carrying only `carryPendingPrompt` (or nothing): `useMessageHandler` `event_replay` arm + `session_state_reset` arm; `useSessionState` `applyReplay` + `session_state_reset`; and `App.tsx`'s refresh reset, which installs a bare `createInitialState()`.
- An interactive request is **two** pieces of state: an `interactiveRequests` entry and a paired `messages` row (`ui-<requestId>`, role `interactiveUi`). `derivePendingFreeFloating` resolves `toolCallId` by scanning `messages`; the assistant-`message_end` reorder emits trailing `interactiveUi` rows after claimed rows. Dedup in `addInteractiveRequest` is `requestId`-keyed.
- `reconcileAndRecomputeOnReplayExit` reconciles against the collected `replayPromptIds` set (empty only when the bridge re-emitted nothing inside the window) and its recompute is **one-directional**: non-empty registry ⇒ `"ask_user"`; empty ⇒ the event-derived value is left untouched.

## Goals / Non-Goals

**Goals:**

- A blocking prompt is deliverable on a saturated socket, on both the subscribe path and the resync path.
- A browser can rebuild pending-prompt state from the bridge without a reconnect and without a page reload.
- Local client state stops destroying prompts it has already rendered.
- The desynced state is visible rather than silent.

**Non-Goals:**

- No change to the `MAX_WS_BUFFER` value, to replay windowing, or to the shedding policy for transcript/telemetry/notify frames.
- No persistence of pending prompts across a server restart. The bridge holds the unresolved promise; if the bridge dies the prompt is genuinely gone.
- No change to prompt answering, timeout, or dismissal semantics.
- No removal of the dead `extension_ui_request` / `trackUiRequest` path (noted in the proposal; deleting it is out of scope per the surgical-changes rule).
- No change to `reconcilePromptRequests`' reconcile semantics (D10).

## Decisions

**D1 — Frame class on `sendTo`, not a parallel sender.** `sendTo` gains an explicit frame class (`ctx.critical === true`); one send path keeps liveness, serialization and counters together. Alternative considered: exempt by message `type` inside `sendTo`. Rejected — the same `prompt_request` type also travels the live fan-out, where the guard should still apply under a genuine stall. The exemption belongs to the *call site* that knows the frame is bounded and blocking: the pending-prompt replay and the resync reply.

**D2 — Two bounds, not one: a per-delivery cap AND an absolute buffer ceiling.** A per-delivery cap alone bounds one replay but not the cumulative bytes a repeatedly-resyncing client can pin on a stalled socket — the affordance is click-repeatable and no rate limiting is added. So: each exempting delivery stops after **4 frames**, **and** the exemption only applies while `bufferedAmount` is under an absolute ceiling of **5 MB** (`MAX_WS_BUFFER` + 1 MB); past the ceiling even a blocking frame is dropped and counted. Worst-case added buffering per socket is therefore 1 MB, not unbounded. Both constants are fixed, not configurable. The specs state the bounds and the overflow behaviour rather than promising unconditional delivery — `concurrent-ask-user-prompts` allows multiple simultaneous prompts, so "the registry is always tiny" is an assumption, and an unconditional SHALL would be unimplementable against the cap.

**D3 — Scope the exemption to the pending-*prompt* leg only.** The `extension_ui_request` leg is dead and the notify log is transcript history by the same argument the guard exists for. Exempting either would widen a memory-safety carve-out for no behavioural gain.

**D4 — The resync reply is routed inside the existing `prompt_request` handler, not through `broadcastEvent`.** A re-emitted prompt is an ordinary bridge `prompt_request` carrying an echoed requester token; it must keep every side effect that handler performs (tracking, `currentTool`, unread, ordering, `replayPromptIds` collection) — only the final delivery call changes: when the token resolves to a live socket, deliver to that socket as a critical frame instead of `sendToSubscribers`. Reusing `broadcastEvent`'s requester branch is wrong twice over: prompts never travel that path, and it would skip tracking, leaving the server registry empty again. Unicast also removes the "unsolicited prompt frame disturbs another tab mid-answer" failure mode. Unknown/expired token → ordinary fan-out, as today.

**D5 — The requester lookup for prompt replies is non-consuming.** `ResyncRequesterRegistry.take()` consumes the token, which would route only the *first* re-emitted prompt and fall every subsequent one back to the guarded fan-out — unsatisfiable against `concurrent-ask-user-prompts` and against the "reply survives saturation" requirement, and not fixable by retrying (the bridge re-emits in stable insertion order, so the same first prompt would consume every new token). The registry gains a non-consuming `peek` used by the prompt path; `take` stays as-is for subagent event replies. Token lifetime remains the existing TTL plus `forget` on socket close. The prompt path also does **not** inherit `broadcastEvent`'s mid-replay suppression: mid-replay arrival is the expected timing for refresh, and a prompt reply has no event-store catch-up to fall back on.

**D6 — Resync asks the bridge, never the server's own registry.** The server registry is derived state and is exactly what fails in the wipe case; answering from it would reproduce the bug. `PromptBus.pending` is authoritative because each entry owns the unresolved promise the agent is blocked on. Known boundary: entries with no resolved component are skipped — those were never routed to a dashboard, so excluding them is correct, not a gap.

**D7 — Shared emitter in the bridge.** The `onReconnect` loop and the new resync handler emit identical frames; extract one function so the two cannot drift on `component` / `placement` / token fields.

**D8 — The client must stop wiping prompts, at all five reset sites, carrying both halves of the state.** `carryInteractiveRequests` preserves unanswered `interactiveRequests` entries **and their paired `ui-<requestId>` rows**, mirroring `carryPendingPrompt`. Carrying the entry alone would render nothing (`MultiAskPanel` and the inline dialog both need the row, and `derivePendingFreeFloating` resolves `toolCallId` by scanning `messages`). Carried rows are appended at the tail of the rebuilt `messages`, which is where the existing reorder already places trailing `interactiveUi` rows; a carried row keeps its `toolCallId`, so if the replay rebuilt its tool card the normal pairing re-claims it. All five sites are in scope: both `useMessageHandler` arms, both `useSessionState` arms, and `App.tsx`'s refresh reset — `on-demand-session-replay` mandates a `session_state_reset` before a windowed full stream, so patching only the `event_replay` arms would leave the refresh path broken exactly on the large sessions this change targets. This is both the original defect and the precondition for the resync to be durable; sequencing alone would only narrow the race. Carried entries are still removed by answer / dismiss / cancel, so nothing is resurrected.

**D9 — Refresh fires the resync unconditionally.** No "only if desynced" precondition: the round trip is cheap, dedup is `requestId`-keyed, and the precondition would read the very state known to be wrong. A failed resync must not abort the transcript refresh.

**D10 — The desync detector is gated three ways.** `currentTool === "ask_user"` plus no matching request is true in legitimate transient states, so the detector additionally requires: session not ended (`session-status-visuals` already rules an ended session never "needs you"), no replay in flight, and the condition held for a **5 s** grace period, which covers the normal `tool_execution_start(ask_user)` → `prompt_request` window with margin. The replay-in-flight flag has a 15 s safety timer that can expire mid-replay on the 257k-event sessions targeted here, so the grace period — not that flag alone — carries the guarantee. Blind spot, bounded: because the replay-exit recompute is one-directional, a registry wipe leaves the last event-derived tool name, so the detector misses the wipe case only when that name is not `ask_user`; refresh (D9) covers it.

**D11 — `reconcilePromptRequests` is left as-is.** The wipe is mostly correct: `replayPromptIds` is populated by the live `prompt_request` handler during the replay window, so a prompt the bridge re-emits on reconnect *is* collected, and one emitted just after the exit is re-tracked by the live path. The residual window is a prompt tracked before the replay that the bridge re-emits outside the window. Suppressing the empty-set reconcile would resurrect prompts dropped via a lost `prompt_dismiss` — a worse failure, now that resync repairs a missing one on demand. Alternative considered: reconcile only against an explicit bridge prompt-snapshot signal. Deferred — a protocol change of its own, non-urgent once resync exists.

## Risks / Trade-offs

- **Exempted frames add buffering on an already-stalled socket** → bounded by D2's per-delivery cap *and* absolute ceiling; payloads are sub-kilobyte.
- **Resync could double-render a dialog** → prompt ids are stable across re-emission and dedup is `requestId`-keyed; covered by an idempotency scenario including in-progress answer composition.
- **Resync could resurrect an answered prompt** → it cannot: `PromptBus` deletes the entry on resolve/cancel, so it is absent from `getPendingRequests()`.
- **Carrying `interactiveRequests` could strand a zombie dialog** (a `prompt_dismiss` lost in the same saturation) → the dialog is now carried rather than accidentally cleared, so a lost dismiss stays visible longer. Answering a dead prompt is already tolerated (the bridge ignores an answer for an unknown id) and the one-directional detector does not repair this direction. Accepted: a stale dialog beats a blocked agent.
- **Carried rows land at the tail, so a tool-paired dialog can appear below its original position** after a reset until the reorder re-claims it → cosmetic ordering drift on a path that today renders nothing at all.
- **`peek` keeps a token alive for its full TTL**, so a late duplicate reply can still be unicast where `take` would have fanned it out → harmless for prompts (requestId-keyed dedup on the client) and bounded by the existing TTL + `forget`.
- **The detector's grace period trades latency for quiet** → a genuine desync surfaces a few seconds late; the alternative fires on every healthy `ask_user` start.

## Migration Plan

No data migration. Server + extension changes ship together.

- New server + old bridge: the bridge's message if-chain ignores the unknown `prompt_resync_request`; no reply, no error. The back-pressure fix and the client carry still apply.
- Old server + new client (rollback with open tabs): the old server's default forwarding path hands the unknown message to the bridge, which ignores it; behaviour degrades to today's.
- Rollback is a straight revert across the four packages; no persisted state changes shape.
