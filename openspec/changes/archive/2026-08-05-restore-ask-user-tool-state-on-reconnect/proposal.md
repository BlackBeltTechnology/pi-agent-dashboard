# Restore ask_user tool state on bridge reconnect

## Why

A session parked on `ask_user` stops looking parked as soon as its bridge reconnects. The card reverts to `Thinking...`, the purple input-stripes disappear, and it never floats to the top of the active tier — while the prompt dialog itself is still sitting there, fully rendered, waiting for an answer.

Reproduced on session `019fcec6-4587-7e2c-bcec-f8e61bc0ce1b`. Its transcript ends at `assistant → toolCall:ask_user` with no matching `toolResult`, so the session is genuinely blocked. `/api/sessions` reports:

```
{ status: "streaming", currentTool: null }
                        ^^^^ should be "ask_user"
```

The browser shows the split brain directly: the prompt widget (Cancel / Next →) renders, the header and footer both say `Thinking...`.

**`currentTool` is written from live events only.** `extractSessionUpdates()` (`packages/server/src/session/event-status-extraction.ts`) sets it from `tool_execution_start` and clears it on `tool_execution_end`, `agent_start`, and `agent_end`. It is called from two places in `event-wiring.ts` — the ordinary path (`:615`) and the `skipReplayInsert` fast path (`:563`) — and `onUnregister` broadcasts a third `currentTool: null` on session death (`:481`). The `prompt_request` handler (`:1452`) touches none of this: it calls `browserGateway.trackPromptRequest()` and fans the message out to subscribers, nothing more.

The reconnect path in `packages/extension/src/bridge.ts` then does this, **in this order**:

| step | what is sent | effect on `currentTool` |
|---|---|---|
| 1 | `replaySessionEntries()` | transcript messages only — no tool lifecycle events |
| 2 | pending `prompt_request` per `promptBus.getPendingRequests()` | none — no server handler touches session state |
| 3 | `replay_complete` | re-broadcasts whatever accumulated (still `null`) |
| 4 | synthetic `agent_start` when `isAgentStreaming` | **explicitly sets `currentTool: null`** |

The prompt survives the reconnect and the tool state does not. The original `tool_execution_start` is never replayed, and it cannot be — it is not a transcript entry.

### The blast radius is wider than the label

Two live consumers key off `currentTool`, and they fail in **different shapes**:

- **Edge-triggered** — `isUnreadTrigger()` trigger 2 and the `questionFirst` reorder in `event-wiring.ts` both fire on `before !== after`. A reconnected prompt never marks the session unread and never moves to the top of the tier.
- **Level-triggered** — the embed-lifecycle reaper reads the *value*: `quiescence.ts:108` (`if (s.currentTool != null) return skip("current-tool")`) and `embed-lifecycle-controller.ts:63`. A reconnected prompt makes a blocked session look reapable.

### The reaper is already broken against its own spec

`embed-session-lifecycle` requires that a session with "no pending `ask_user` interaction" is a precondition for a phantom reap, and states outright: *"ask_user-blocked session is never phantom-reaped."* The implementation wires that gate to the wrong registry — `embed-lifecycle-controller.ts:73` sets `hasPendingAsk: deps.hasPendingUiRequest`, which reads `pendingUiRequests` (the extension-UI-RPC map), **not** the PromptBus map. A session blocked on a PromptBus prompt can therefore be phantom-reaped today, in violation of an already-accepted requirement. The reaper defaults to `enabled: false`, so this is latent for desktop and live for embed / chat-gateway deployments.

This change fixes that gate explicitly rather than letting a non-null `currentTool` veto the reap by accident.

### The server already holds the missing fact

`browser-gateway.ts` maintains `pendingPromptRequests: Map<sessionId, Map<promptId, msg>>`, populated by `trackPromptRequest` and cleared by `clearPromptRequest` on `prompt_dismiss` / `prompt_cancel`. Because PromptBus is first-response-wins and the bridge's `onDashboardDismiss` fires when a prompt resolves through *any* adapter (`prompt-bus.ts:207`, unconditional), that registry empties on answer as well as on cancel. It is already the server's authoritative "is this session blocked on a prompt" signal — it is simply write-only, with no read accessor.

### One registry hole must be closed at the same time

`respond()` deletes the pending entry and calls `clearTimeout(entry.timer)` **before** it sends `prompt_dismiss` (`prompt-bus.ts:194-207`). If the socket drops inside that window: the dismiss is lost, the timeout that would have fired a cancel is already cleared, and `getPendingRequests()` is now empty so the reconnect re-sends nothing. The gateway map has no TTL and no other clearing path. Without a fix, the derivation would turn that into a **permanent phantom** — a card stuck on "Needs you" with no dialog, and (with the reaper gate above) a session that can never be reclaimed, until the server restarts.

## What Changes

- **`currentTool` becomes derivable from the pending-prompt registry, not only from live tool events.** When a session has ≥1 tracked pending prompt, its `currentTool` reads `"ask_user"`.
- **Two distinct mechanisms, because the handlers live in different code paths.** The `prompt_*` messages are sibling `if (msg.type === …)` branches *outside* the `event_forward` block, so they never reach the extractor. They get direct session-state writes. The extractor gets a fold. Conflating the two is what made the first draft of this proposal wrong.
- **The fold is applied at both `extractSessionUpdates` call sites**, not just the ordinary one, so the `skipReplayInsert` fast path cannot write a transient `null`.
- **`replay_complete` reconciles the registry against the bridge's re-sent set** rather than merging into it. The bridge sends its complete pending set on every reconnect, so treating that as a snapshot clears a phantom entry whose dismiss was lost, and keeps the registry from drifting from bridge truth.
- **The reaper's pending-ask gate becomes the union of both registries**, so the "never reap a blocked session" requirement is satisfied explicitly instead of by the side effect of a non-null `currentTool`.
- **The unread and reorder triggers stay edge-correct.** A reconnect must not re-mark a seen prompt unread or re-bounce it to the top; a genuinely new prompt must still fire both exactly once.

### Accepted behaviour changes

- **A flow-raised prompt now shows `⚡ ask_user` where it previously showed `Idle`.** A prompt raised without a corresponding `ask_user` tool call (a flow adapter, a plugin) will now set `currentTool`. `ActivityIndicator` suppresses the "Needs you" label for widget-bar-placed prompts, but then falls through to `if (session.currentTool)` and renders the tool name (`SessionCard.tsx:80`). This is a deliberate choice: the session **is** blocked on the user, and `Idle` was a lie. It is a client-visible change delivered with **no client code change**.
- **`currentTool: "ask_user"` can now coexist with `status: "idle"`.** Previously a non-null `currentTool` implied `streaming`. An `agent_end` arriving with a prompt still pending now produces that pair. No consumer asserts the old invariant, and the reaper's level-triggered read of `currentTool` treats it correctly.

### What this change does not do

- **No change to `packages/extension/`.** The fix applies to already-running sessions with no session reload. Reordering the bridge's steps 2 and 4 would fix only bridge-initiated reconnects and would ship as an extension change.
- **No client code change.**
- **No persistence of `currentTool` to disk.** The bridge's re-send is the source of truth.
- **No per-prompt fidelity.** Multiple pending prompts collapse to one `"ask_user"`.

### Accepted limitations

- **`getPendingRequests()` filters to entries with a resolved component and placement** (`prompt-bus.ts:245`). A prompt with no resolved dashboard component is not re-sent, so the snapshot reconcile drops it and `currentTool` clears while it is genuinely pending in the TUI. That equals today's behaviour for that subset — it is simply not improved.
- **A prompt raised while the socket was down never fires the unread or reorder trigger.** The `tool_execution_start` edge is replay-suppressed and the re-sent `prompt_request` lands inside the replay window. Pre-existing; out of scope.
- **A lost dismiss is only repaired at the next reconnect.** A session that goes permanently silent keeps a phantom entry — acceptable, since such a session is broken regardless of its label.

## Capabilities

### New Capabilities
- `prompt-derived-tool-state`: deriving a session's `ask_user` tool state from the pending-prompt registry, asserting it against the writers that would clear it, reconciling the registry against the bridge's authoritative set on reconnect, and clearing it when the last pending prompt resolves.

### Modified Capabilities
- `event-status-extraction`: the pure extraction layer gains the precedence rule between a live tool event and a derived pending-prompt state.
- `embed-session-lifecycle`: the existing "never reap an `ask_user`-blocked session" requirement gains an explicit source for the pending-ask signal — the union of both pending registries — closing a gap where a PromptBus-blocked session could be phantom-reaped.

### Unchanged Capabilities

`ask-user-card-indicator`, `session-card-status`, and `session-attention-routing` are **not** modified. Each already specifies the correct behaviour keyed on `currentTool === "ask_user"`; they were reading a field the server had wrongly cleared.

## Impact

**Code**
- `packages/server/src/session/event-status-extraction.ts` — precedence rule for live tool vs derived prompt state, kept pure.
- `packages/server/src/event-wiring.ts` — fold at both extractor call sites; direct writes in the `prompt_request` / `prompt_dismiss` / `prompt_cancel` branches; snapshot reconcile at `replay_complete`.
- `packages/server/src/pairing/browser-gateway.ts` — `hasPendingPromptRequests()` read accessor and a `reconcilePromptRequests()` snapshot setter over the existing map.
- `packages/server/src/embed-lifecycle/embed-lifecycle-controller.ts` — `hasPendingAsk` becomes the union of `hasPendingUiRequest` and `hasPendingPromptRequests`.

**Unchanged**
- `packages/extension/` and `packages/client/` — no code change in either.

**Behaviour**
- A session blocked on `ask_user` keeps its "Needs you" label, its input-stripes, its top-of-tier position, and its unread flag across a browser refresh, a bridge reconnect, and a server restart — and cannot be phantom-reaped.

## Discipline Skills

- `doubt-driven-review` — the first draft of this proposal asserted a consumer that does not exist, missed the level-triggered one that does, and described a mechanism that the code's statement order makes impossible. The corrected design still rests on a wire-ordering invariant the server does not control.
- `security-hardening` — not applicable; no untrusted input, auth, or secret path is touched.
- `systematic-debugging` — the reproduction is a specific live session and a specific 4-step sequence; verification must reproduce that sequence.
- `review-code` — non-trivial server state change touching the extractor, the gateway, the event wiring, and the reaper.
