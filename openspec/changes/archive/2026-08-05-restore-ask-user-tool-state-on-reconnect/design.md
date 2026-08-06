## Context

`DashboardSession.currentTool` is derived from live pi events by `extractSessionUpdates()` in `packages/server/src/session/event-status-extraction.ts`:

```
tool_execution_start → currentTool = toolName
tool_execution_end   → currentTool = null
agent_start          → status = "streaming", currentTool = null
agent_end            → status = "idle",      currentTool = null
```

Verified call sites and writers (the first draft of this design claimed "exactly one place" — that was wrong):

| location | what it does |
|---|---|
| `event-wiring.ts:615` | ordinary event path — `extractSessionUpdates` → `sessionManager.update` |
| `event-wiring.ts:563` | `skipReplayInsert` fast path — same extractor, update only, then early `return` |
| `event-wiring.ts:481` | `onUnregister` — broadcasts `currentTool: null` on session death |

`ask_user` therefore reads correctly only while the original `tool_execution_start` is the most recent tool event *in this server process*. That event is not a transcript entry, so it is not replayed, and the bridge's reconnect sequence (`bridge.ts:1086-1118`) ends with a synthetic `agent_start` that clears the field.

Two consumers depend on the field, in **two different shapes** — a distinction the first draft missed entirely:

| consumer | location | shape |
|---|---|---|
| unread stamping | `isUnreadTrigger()` trigger 2 | edge: `after === "ask_user" && before !== "ask_user"` |
| `questionFirst` reorder | `event-wiring.ts` | edge: same before/after comparison |
| embed-lifecycle idle gear | `quiescence.ts:108` | **level**: `if (s.currentTool != null) return skip("current-tool")` |
| ephemeral idle count | `embed-lifecycle-controller.ts:63` | **level**: `s.currentTool == null` |

There is no `demandsAttention` predicate in the codebase. The first draft named one; `grep -rn demandsAttention packages/` returns nothing outside unarchived worktree spec docs.

Two registries answer "is a prompt pending?", and they are **not** the same map:

| map | written by | read by |
|---|---|---|
| `pendingUiRequests` | `trackUiRequest` (extension UI RPC) | `hasPendingUiRequest()` → the reaper's `hasPendingAsk` |
| `pendingPromptRequests` | `trackPromptRequest` (PromptBus) | **nothing** — write-only |

## Goals / Non-Goals

**Goals:**
- A session with ≥1 pending prompt reports `currentTool: "ask_user"` regardless of which live events this server process has seen.
- The state survives the reconnect sequence, including the trailing synthetic `agent_start`.
- The state clears when the last pending prompt clears, and recovers from a *lost* clear.
- A genuine in-flight non-`ask_user` tool still wins.
- Reconnect does not re-fire unread stamping or `questionFirst`; a genuinely new prompt still fires both once.
- The reaper never reclaims a prompt-blocked session — explicitly, not by accident.

**Non-Goals:**
- Changing `packages/extension/` or `packages/client/`.
- Persisting `currentTool`.
- Per-prompt fidelity in `currentTool`.
- Fixing unread/reorder for a prompt raised while the socket was down (pre-existing).

## Decisions

### D1 — Two mechanisms, because there are two code paths

The `prompt_request` / `prompt_dismiss` / `prompt_cancel` handlers are sibling `if (msg.type === …)` branches at `event-wiring.ts:1452-1464`, **outside** the `event_forward` block where the extractor runs. They never reach `extractSessionUpdates`. So the derivation cannot be a single fold:

- **M1 — the fold, on live events only.** `extractSessionUpdates` takes a `hasPendingPrompt: boolean` and rewrites a would-be `currentTool: null` into `"ask_user"`. It is applied **only when the session is not replaying**. During replay `currentTool` stays purely event-derived, and the replay exit (D4) is the single place the registry is consulted for a replayed session. The `skipReplayInsert` fast path (`:563`) runs only during replay and therefore gets **no** fold at all — a reviewer independently observed it was inert for this case anyway.
- **M2 — direct writes.** The three `prompt_*` branches update session state themselves: set on `prompt_request`, clear on dismiss/cancel when the registry is now empty.

The first draft described M1 as covering all six decisions. It does not, and D6-as-then-written had no mechanism behind it at all.

### D2 — What actually makes the edge disappear (corrected)

The first draft claimed the fold "runs before the snapshots are captured." That is impossible: `beforeSnapshot` is captured at `event-wiring.ts:610`, five lines *before* `extractSessionUpdates` is called at `:615`. `beforeSnapshot` reads **stored session state**, not the pending update.

The edge disappears for a different reason:

```
reconnect wire order:  prompt_request → replay_complete → agent_start
                            │                                 │
                       M2 writes "ask_user"                    │
                       into sessionManager                     │
                                                               ▼
                                          beforeSnapshot reads "ask_user"  (stored)
                                          M1 keeps update at "ask_user"    (folded)
                                          afterSnapshot  reads "ask_user"
                                          → before === after → no trigger
```

**This is load-bearing and the server does not control it.** M2's write must land before the synthetic `agent_start` arrives, which holds only because the bridge sends `prompt_request` first (`bridge.ts:1095-1118`). The invariant is now explicit, and the regression test in tasks §1 replays the sequence in that exact order so a future bridge reordering fails loudly rather than silently re-marking sessions unread on every reconnect.

If the order ever inverts, the failure is bounded and self-correcting per event, not corrupting: `agent_start` writes `null`, then `prompt_request` writes `"ask_user"`, producing one spurious unread + reorder per reconnect.

### D3 — Precedence: a live tool beats the registry

The fold applies only when the incoming update would leave `currentTool` empty. A `tool_execution_start` for `bash` writes `bash` and the registry is not consulted. The registry can legitimately lag — a prompt answered in the TUI clears via a `prompt_dismiss` that races the next `tool_execution_start` — and with this precedence the worst case is a stale `ask_user` for the width of one event, never a suppressed real tool.

The rule lives in `event-status-extraction.ts` as a pure function of `(event, hasPendingPrompt)`, unit-testable without a gateway, a socket, or a session manager.

### D4 — Both replay exits reconcile the registry, then **recompute** from it

**Problem this solves.** `respond()` deletes the entry and clears its timeout *before* sending the dismiss (`prompt-bus.ts:194-207`):

```ts
this.pending.delete(response.id);
clearTimeout(entry.timer);          // ← the 5-minute cancel is now gone
...
onDashboardDismiss(response.id);    // ← if the socket drops here, this is lost
```

A drop inside that window leaves the gateway map holding an entry that will never be cleared: the dismiss is lost, the timeout that would have fired a cancel is already cleared, and `getPendingRequests()` is empty so the reconnect re-sends nothing. The map has no TTL, and `onUnregister` does not clear it either (`browser-gateway.ts` — `clearPromptRequest` is the only remover), so the entry outlives the session.

The first draft's stated mitigation — "bounded by PromptBus's 5-minute default timeout, which fires a cancel" — is **false for this exact race**, because the timer is cleared before the send.

**Decision.** The bridge sends its complete pending set on every reconnect, so a replay exit treats the re-sent `prompt_request`s as a **snapshot**: `reconcilePromptRequests(sessionId, promptIds)` drops tracked entries not among them. Three properties are load-bearing, and the naive version of this decision had none of them:

0. **The recompute is well-defined only because the fold is live-only.** Had the fold run during replay, it would consult the stale registry on every stored event — an `agent_end` replay would write `currentTool: "ask_user"` *before* the reconcile ran, the reconcile would then empty the registry but leave that value behind, and with no trailing synthetic `agent_start` to correct it (`bridge.ts:1117` gates on `isAgentStreaming`, already cleared by `agent_end`) the result is a phantom card on a session the reaper then refuses to reclaim — a defect *created by the fix*. Worse, the obvious repair ("preserve the last-event-derived value") is unimplementable, because the fold has already overwritten the very value it would need to preserve.

   Excluding replay from the fold removes the contamination at its source. After replay, `currentTool` is exactly what the events say. The recompute is then unambiguous: **registry non-empty ⇒ `"ask_user"`; registry empty ⇒ leave the event-derived value untouched.** A session whose last replayed event was `tool_execution_start("Read")` keeps `"Read"`; one whose last event was `agent_end` keeps `null`.
1. **Reconcile precedes recompute.** The existing `replay_complete` broadcast already publishes `{status, currentTool}`, so the recomputed value rides it with no new broadcast site.
2. **Both exits, not one.** `replayingSessions` is cleared at `replay_complete` (`:896`) *or* by the 5-second safety timeout (`:947-949`) when `replay_complete` never arrives. Hooking only the first leaves the lost-dismiss entry alive on the timeout path — and with D5 the session then never reaps. The timeout block already re-broadcasts `{status, currentTool}`; it gets the same reconcile-and-recompute.
3. **Consume-and-clear applies to the collected snapshot set, never to the live registry.** Two different things are in play: the **collected promptId set** (ephemeral, per-replay, exists only to drive one reconcile) and the **live `pendingPromptRequests` registry** (durable, and separately read by `replayPendingUiRequests` at `browser-gateway.ts:275-283` to restore dialogs on a browser refresh). Draining the former is required so the two exits cannot race — a timeout at T=5s followed by a `replay_complete` at T=6s would otherwise reconcile against a set closed at 5s and drop a live prompt that arrived between them, since the `prompt_*` branches are **not** `replayingSessions`-gated. Draining the latter would silently destroy the browser-refresh dialog cache. The ordering is fixed: **reconcile → recompute → drain the collected set**; a drain that ran first would leave the recompute reading an empty registry and nulling a live prompt.

   Note the two exits are **not** symmetrically guarded today: the safety timeout is wrapped in `if (replayingSessions.delete(sessionId))` (`:948`) but `replay_complete` (`:897`) deletes unconditionally and re-broadcasts, so a late `replay_complete` after a fired timeout already re-sends a duplicate `event_replay`. That is pre-existing, but this change adds a second consumer of that path and so guards it rather than inheriting the duplicate.

**Trade-off:** `getPendingRequests()` filters to entries with `resolvedComponent && resolvedPlacement` (`prompt-bus.ts:245`). A prompt with no resolved dashboard component is not re-sent, so the reconcile drops it and `currentTool` clears while it is genuinely pending in the TUI. That equals today's behaviour for that subset — not improved, not regressed.

### D5 — Reaper gate becomes the union of both registries

`embed-lifecycle-controller.ts:73` currently wires `hasPendingAsk: deps.hasPendingUiRequest`, reading only `pendingUiRequests`. PromptBus prompts are invisible to it, so a prompt-blocked session can be phantom-reaped — violating `embed-session-lifecycle`'s existing *"ask_user-blocked session is never phantom-reaped."*

The derivation would mask this by accident: `currentTool: "ask_user"` makes `quiescence.ts:108` skip on `"current-tool"`. But that veto only covers the **idle gear**; `streamingGearVerdict` checks `hasPendingAsk` and not `currentTool`, so the phantom-reap path stays open. Relying on the accident would leave a real hole and couple two unrelated fields.

**Decision:** `hasPendingAsk: (id) => hasPendingUiRequest(id) || hasPendingPromptRequests(id)`. One line, makes the veto explicit, and satisfies the existing requirement rather than shadowing it.

**Why not unify the two maps?** They track different subsystems (extension UI RPC vs PromptBus) with different lifecycles and different clearing paths. Merging them is a larger refactor with no benefit to this change; the union at the single consumer is the minimal correct fix.

### D6a — M2 must be a trigger-complete writer

The unread and `questionFirst` evaluations live **inside** the `event_forward` block (`event-wiring.ts:630`, `:661`). M2 writes `currentTool` from the `prompt_*` branches, which never reach them. That makes M2 a *partial* writer, and partial writers break the edge:

If a `prompt_request` ever lands before its matching `tool_execution_start`, M2 sets `"ask_user"` with no trigger evaluation; the later `tool_execution_start` then finds `beforeSnapshot.currentTool === "ask_user"`, so `before !== "ask_user"` is false and **neither unread nor reorder fires for a genuinely new prompt** — a silent R5 violation.

That ordering holds today only because pi emits `tool_execution_start` before `execute()` calls `promptBus.request` — an undocumented, bridge-internal detail this change must not depend on, having already been bitten once by an unstated ordering assumption (D2).

**Decision:** the `prompt_request` branch evaluates the unread trigger and the `questionFirst` reorder itself, under the same `!replayingSessions` and `!isViewedByAnyone` gates. M2 becomes trigger-complete, so correctness no longer depends on which writer wins the race.

**Double-firing is prevented by the edge semantics already in place**, not by a new guard: once `currentTool` is `"ask_user"`, a later `tool_execution_start` has `before === after` and fires nothing. This holds **only if the branch captures its before-snapshot prior to its own write** — the same discipline the event path follows at `:610`.

The reorder block is safe to call from here: `resolveOrderKey`, `sessionOrderManager.moveToFront`, and the `sessions_reordered` broadcast read only `sessionManager` and `preferencesStore`, with no dependency on `eventStore` sequence numbers or any other `event_forward`-only state.

### D6b — Registry lifecycle: clear on unregister

`pendingPromptRequests` is removed from only by `clearPromptRequest`. Nothing clears it when a session dies, so a session that ends with a pending prompt leaks its entry for the process lifetime. Today that leak is inert — the map is write-only. **D5 makes it dangerous**: a leaked entry becomes a permanent `hasPendingAsk: true`, and the reaper's whole purpose is reclaiming exactly such sessions.

**Decision:** `onUnregister` clears the session's prompt registry, alongside the `currentTool: null` broadcast it already performs. Turning a read-only map into a load-bearing signal obliges this change to own its lifecycle.

**And it clears `pendingUiRequests` too.** That map has the structurally identical leak and is **already** wired to the reaper (`hasPendingUiRequest` → `hasPendingAsk`), so a session that dies holding an extension-UI request is *already* permanently unreapable in production today — all three gears honour pending-ask (`quiescence.ts:103,109,135,141`). Fixing one registry's lifecycle while leaving the identical, already-live hole open next to it would be indefensible. One extra line, same call site.

### D6 — A narrow read accessor, not the map

`hasPendingPromptRequests(sessionId): boolean` — a boolean, because every consumer here asks exactly that, and returning the map invites session-state and reaper code to reach into prompt payloads. It mirrors the existing `hasPendingUiRequest()` shape, which keeps the two predicates visibly parallel at the union site.

### D7 — Flow-raised prompts count, and the card changes

A prompt raised without an `ask_user` tool call (flow adapter, plugin) now sets `currentTool`. `ActivityIndicator` suppresses the "Needs you" label for widget-bar prompts, then falls through to `if (session.currentTool)` and renders `⚡ ask_user` (`SessionCard.tsx:73-81`) — it does **not** fall back to "Idle" as the first draft claimed.

Chosen deliberately: the session is blocked on the user, and `Idle` was a lie. Delivered with no client code change. The alternative — gating the derivation on `placement !== "widget-bar"` (the server does see `placement` on the message) — was rejected because it would make reconnect state differ from live state for widget-bar prompts that *do* have a tool call, trading a visible truth for a hidden inconsistency.

## Risks / Trade-offs

- **[Wire-ordering invariant is external]** → M2-before-`agent_start` is enforced by the bridge, not the server. Mitigated by the ordered regression test (tasks §1) and by the bounded, self-correcting failure mode described in D2.
- **[Two mechanisms can drift]** → M1 and M2 must agree on the precedence rule. Mitigated by both delegating to the same pure helper; the reaper union reads the same accessor.
- **[`currentTool: "ask_user"` with `status: "idle"`]** → a new field-value pair (an `agent_end` with a prompt still pending). No consumer asserts the old implication; the level-triggered reaper reads it correctly and conservatively.
- **[Registry entry with no re-send]** → D4's snapshot drops component-less prompts. Documented as an accepted limitation, equal to today.
- **[Test suite encodes old behaviour]** → existing tests assert `agent_start ⇒ currentTool: null`. Valid for the no-prompt case; complement, do not delete.
- **[R9 is conditional on registry accuracy]** → "byte-identical with no pending prompt" holds only while the registry is accurate. A stale entry makes M1 write `"ask_user"` where today writes `null`. D4's reconcile-and-recompute plus D6b's unregister cleanup are what make the precondition true; R9 cannot be asserted independently of them.
- **[Non-bridge session sources]** → a session source that never sends the `prompt_request` burst + `replay_complete` (headless / embed paths) never runs the reconcile, so it gets no phantom recovery. Its registry is also never populated, so the exposure is bounded to sources that use PromptBus without the reconnect handshake.

## Migration Plan

Server-only: `curl -X POST http://localhost:8000/api/restart` (jiti, no build). No extension reload, so sessions already parked on a prompt are repaired at their next bridge re-register. Rollback is a revert plus the same restart; no persisted state, no protocol change.

## Open Questions

- Should a prompt-blocked session report `status: "streaming"` at all? It is blocked, not working. Out of scope — this change corrects `currentTool` only — but the disagreement between the two fields is why the card can render "Thinking..." at all.
- `embed-session-lifecycle`'s spec text says "no pending `ask_user` interaction" without naming a source. This change names it (the union). If the two registries are ever unified, that requirement should point at the unified one.
