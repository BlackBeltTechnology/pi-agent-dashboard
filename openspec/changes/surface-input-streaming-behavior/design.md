# Design — surface-input-streaming-behavior

> **Status: stub.** Decision 1 is the gating call; do not draft tasks.md until
> that's resolved.

## Context

Pi 0.77 added `InputEvent.streamingBehavior?: "steer" | "followUp"` (undefined when idle). The dashboard's pass-through pipeline already delivers the field to the client — it shows up inside rawEvent JSON cards today. The work is purely client-side: reducer + UI.

## Decision 1 — STATUS ROW vs. INLINE BADGE (OPEN)

```
OPTION A — STATUS ROW                  OPTION B — INLINE BADGE
─────────────────────                  ──────────────────────

User: "do X"                           User: "do X"
Assistant: …streaming…                 Assistant: …streaming…
User: "also Y"                         User: "also Y"   [steered]
[steering current turn]                Assistant: …(steered, restarts)…
Assistant: …(steered, restarts)…

  • New typed row inserted               • streamingBehavior stamped onto
    by reducer on input event              user-message row via correlation
  • No correlation with user-msg         • Reducer must remember "next
  • Reducer-state: stateless               message_start of role:user gets
    handler                                this field"
  • Renders: simple text affordance      • Renders: badge + tooltip on
                                           existing user-msg component
  • Scope: ~80 LOC                       • Scope: ~200 LOC
```

Recommendation: **Option A** for v1. Cheap, no event correlation, ships fast. Upgrade to B later if user feedback says the disconnected status row reads as noise.

Counterargument for B: the badge sits with the message it describes; a status row 2 lines above the message is less discoverable. If the design conversation surfaces a strong preference for inline, skip directly to B and accept the higher scope.

## Decision 2 — Source filter (OPEN)

InputEvent carries `source: "interactive" | "rpc" | "extension"`. Only `"interactive"` is user-typed text. Should the reducer render status / badges for the other sources?

- `"rpc"` — input arrived via the keeper socket (extension slash-command dispatch). Mid-stream RPC commands already render as command_feedback rows; adding a status here doubles the signal.
- `"extension"` — input synthesized by an extension calling `pi.sendUserMessage()` (e.g. flows step injecting a prompt). The user did not type it; surfacing "(queued)" here may confuse rather than inform.

Recommendation: filter to `source === "interactive"` only. Skip the rest.

## Decision 3 — Idle inputs (no streamingBehavior field)

When `streamingBehavior` is `undefined`, the input arrived while the agent was idle — the normal case. No reason to annotate; the subsequent `message_start { role: "user" }` already renders the user's message.

Decision: skip the input event entirely when `streamingBehavior` is undefined. The reducer's `input` handler becomes a no-op for the idle case.

## Decision 4 — Reconciliation with rawEvent fallback

Today `input` events render as rawEvent JSON cards (the catch-all in the reducer). Once this proposal lands, `input` is no longer "unknown" — the rawEvent fallback no longer fires for it. Confirm:

- `packages/client/src/lib/__tests__/event-reducer.test.ts` — search for tests that assert a rawEvent message is produced for `input`. None expected (the rawEvent test uses `"some_extension_event"` as fixture), but worth a grep before writing the reducer change.
- No screenshot / regression test depends on seeing the raw `input` JSON card.

## Risks

- **False positives if pi 0.77 emits `streamingBehavior` for non-mid-stream cases**: the contract is "field is set only when agent is streaming." Verify by reading pi's `_extensionRunner.emitInput` (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` — the line `this.isStreaming ? options?.streamingBehavior : undefined` strongly suggests the contract holds, but worth one trace through to confirm before relying on it).
- **rawEvent card regression**: if a test relies on rawEvent presence for `input`, it must be updated when the explicit handler lands. Mitigation: write the explicit reducer test FIRST; existing test failures surface the regression naturally.

## Rollback

Revert the reducer + UI changes. No persisted state, no protocol contract committed. The field continues to flow through the protocol — it just lands back in the rawEvent JSON card.
