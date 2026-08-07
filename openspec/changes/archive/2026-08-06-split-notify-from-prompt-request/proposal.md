# Split `notify` out of the `prompt_request` protocol

## Why

A freshly spawned dashboard session shows **"Needs you"** within ~30s, before the
user has typed anything, and never stops showing it.

Root cause: `ctx.ui.notify` — a fire-and-forget toast — is shipped over the
`prompt_request` message type. A notification is not a request. Every consumer
downstream of that message treats it as an unanswered blocking ask.

```
 pi session starts (dashboard-spawned, --mode rpc)
        │
        │  an extension calls ctx.ui.notify("…")
        ▼
 packages/extension/src/bridge.ts:2317   proxied notify
        │  connection.send({ type: "prompt_request",
        │                    prompt: { type: "notify" },   ← NOT via PromptBus
        │                    placement: "inline" })
        ▼
 packages/server/src/event-wiring.ts:1556   prompt_request branch
        │  trackPromptRequest()        → pendingPromptRequests += 1
        │  if (!session.currentTool)   → currentTool = "ask_user"
        │  stampUnreadIfTriggered()    → false unread dot
        │  questionFirst               → card jumps to top of sidebar
        ▼
 packages/client/src/components/session/SessionCard.tsx:74
        currentTool === "ask_user" && !hasWidgetBarPrompt
        →  ● "Needs you"
```

### Why it never clears

`prompt_dismiss` is emitted **only** by `PromptBus` (`bridge.ts` `onDismiss`,
`prompt-bus.ts`). The notify proxy bypasses the bus entirely, so no dismiss is
ever sent. The registry entry lives until session death.

That would be cosmetic if the label were written once. It is not — the M1 fold
re-derives it on **every live event**:

`event-wiring.ts:706` computes `hasPendingPrompt` from the registry and
`event-status-extraction.ts:77` folds it in whenever the event-derived update
would *clear* `currentTool`:

```
 tool_execution_start{bash}  → currentTool = "bash"   (live tool wins, flag ignored)
 tool_execution_end          → currentTool = null …
                                └─ fold: pending ≥ 1 → "ask_user"   ◄── re-armed
 agent_end                   → currentTool = null …
                                └─ fold: pending ≥ 1 → "ask_user"   ◄── re-armed
```

So the card shows the real tool name *while* a tool runs and snaps back to
"Needs you" at every quiescent moment — for the life of the session. Confirmed
against a live session by the reporter.

### Blast radius

| Consumer | Effect of the phantom `ask_user` |
|---|---|
| `SessionCard` `ActivityIndicator` | "Needs you" + `--status-needs-you` |
| card stripes / dot / rail | `card-input-stripes`, needs-you dot |
| `FolderNeedsYouPill` | inflates the "N need you" folder rollup |
| `questionFirst` reorder | fresh session jumps the sidebar |
| `stampUnreadIfTriggered` | false unread badge |
| embed-lifecycle reaper | `hasPendingAsk` union → session **never reapable** |
| client `interactiveRequests` | entry added, never dismissed — client-side leak too |

The reaper row is the sharp one: a notify-only session is permanently "blocked"
and permanently unreclaimable.

## What changes

Give `notify` its own message type end to end, instead of overloading
`prompt_request`.

- **`packages/shared`** — new `NotifyMessage` (`type: "notify"`) on both the
  pi↔server protocol and the server↔browser protocol. `PromptRequestMessage`
  keeps its exact current shape.
- **`packages/extension`** — `bridge.ts` notify proxy sends `type: "notify"`.
- **`packages/server`** — `event-wiring.ts` routes `notify` straight to
  `sendToSubscribers` with **no** `trackPromptRequest`, no `currentTool` fold,
  no unread stamp, no `questionFirst` reorder.
- **`packages/client`** — a notify appends its `interactiveUi` row to `messages`
  (preserving transcript position) without adding an `interactiveRequests` entry.
  Both reducers — the main-app handler and the embed session-state handler — are
  separate switches and both need the case.
- **Durability** — the server gains a bounded per-session notify log replayed on
  browser subscribe. Today a notify survives a refresh *because of the bug*
  (`trackPromptRequest` + `replayPendingUiRequests`); removing the tracking
  without a replacement would make notifications ephemeral.
- **Skew** — three directions, resolved in design: new-server + old-bridge gets a
  permanent server guard; old-client + new-server is accepted (the client ships
  with the server); old-server + new-bridge is accepted and bounded (Decision 9).
- **Version-skew shim (not optional)** — the bridge ships to npm independently
  of the server. A server WILL pair with an older bridge that still sends
  `prompt_request { prompt.type: "notify" }`. The server keeps a guard that
  treats that shape exactly like the new `notify` message. See design.

## Capabilities

- `notify-message-channel` (new) — the dedicated notify transport, end to end.
- `prompt-derived-tool-state` (modified) — the `currentTool` derivation must stop
  counting a notify as a pending prompt.
- `bridge-extension` (modified) — its live requirement says the patched notify
  `SHALL forward a prompt_request` (`spec.md:662`). Without a delta the main spec
  tree would hold two contradictory SHALLs after archive.

## Prior art: this is a regression, not a new design

The archived `interactive-ui-dialogs` spec already types notify as its own thing:
`extension_ui_request` with `method: "notify"` and
`params: { message: string, level?: "info" | "warning" | "error" }`. The PromptBus
migration is what collapsed it onto `prompt_request`. This change restores the
separation on the current transport and reuses the already-specified `level`
union.

## Non-goals

- Changing how a notify *looks* in the UI. It renders today and must keep
  rendering — verified by the reporter.
- Touching real `ask_user` / PromptBus behaviour. `restore-ask-user-tool-state-on-reconnect`
  semantics stay byte-identical for genuine prompts.
- Retro-clearing already-stuck live sessions. They clear on a server restart or a
  bridge WS reconnect — **not** on a browser refresh, which re-sends the stuck
  entry via `replayPendingUiRequests`. See design Decision 5.

## Discipline Skills

- `doubt-driven-review` — a cross-package protocol change with a published-npm
  skew surface, reviewed before it stands.
- `review-code` — non-trivial change spanning shared/extension/server/client.
