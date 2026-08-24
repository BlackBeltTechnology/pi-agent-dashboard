## Context

`addInteractiveRequest` (`event-reducer.ts:1015`) appends each incoming
`prompt_request` to `SessionState.interactiveRequests[]` and pushes a matching
`role:"interactiveUi"` row into the message stream. It guards against
duplicates with two conditions ORed together:

1. `r.requestId === requestId` — the legitimate re-send guard (reconnect replay
   re-sends the pending burst; the bridge replays by id).
2. `r.status === "pending" && r.method === method && r.params.title === params.title`
   — a content fallback whose stated reason is "recursive proxy generates
   multiple requestIds for the same dialog."

Condition (2) is the bug: it ignores `params.message` (and `options`), so two
distinct prompts that share a title are treated as one.

## Goals / Non-Goals

**Goals**
- No concurrently-pending ask is ever dropped when its `requestId` is new.
- Concurrently-pending free-floating asks render as one cohesive panel.
- Each ask resolves independently by its own `requestId`; no change to
  PromptBus / server / bridge / protocol.

**Non-Goals**
- No request-level coalescing (Route A). No windowing. No fan-out from one
  batch response to many resolves.
- No change to atomic `ask_user{method:"batch"}` semantics.
- No change to tool-paired (`toolCallId`-bearing) ask placement.

## Decision 1 — Narrow the dedup key

Under the PromptBus, `request()` mints a fresh `crypto.randomUUID()` per prompt
and sends it to the dashboard exactly once (`prompt-bus.ts`). A *new*
`requestId` therefore always denotes a *new* prompt. The only legitimate
duplicate is a re-send of the **same** id (reconnect replay), which condition
(1) already covers.

**Chosen:** keep condition (1) (`requestId` equality) and **delete** the
content fallback (2).

Rejected sub-option — *widen* (2) to also compare `params.message` +
serialized `options`: this keeps a heuristic alive that the architecture no
longer needs and would still misfire if two truly-identical dialogs are
legitimately pending at once (two identical confirms from two parallel tools —
both must be answerable). Equality-on-id is both simpler and strictly correct.

**Guard on the rejected motivation — audit COMPLETE (doubt-driven-review).**
The comment blames a "recursive proxy" that emitted multiple ids for one
dialog. Traced every producer of `addInteractiveRequest`:

- `prompt_request` (`useMessageHandler.ts:1202`) — PromptBus, **LIVE**. Mints a
  unique `crypto.randomUUID()` per prompt; reconnect replay re-sends the SAME
  id (`bridge.ts:1198` `promptBus.getPendingRequests()`;
  `browser-gateway.ts:342` `pendingPromptRequests` replay). Same-id → guarded
  by condition (1).
- `extension_ui_request` (`useMessageHandler.ts:1155`) — **DEAD**. Its only
  emitter is `browser-gateway.replayPendingUiRequests` (line 332), which reads
  `pendingUiRequests`, whose only writer is `trackUiRequest` (line 390) —
  **never invoked anywhere** in `packages/server/src`. The extension emits it
  nowhere; `event-wiring.ts:1772` records "Legacy extension_ui_request/dismiss
  removed — replaced by PromptBus protocol."

**Conclusion:** no live path produces multiple requestIds for one dialog. The
content fallback (2) is provably dead weight; deleting it is safe. Condition
(1) still collapses same-id reconnect re-sends.

**Incidental dead code (out of scope — mention, do not delete here).**
`trackUiRequest` (`browser-gateway.ts:390`) carries the *same* title-dedup
defect server-side, but is never called, so it cannot fire. It, `pendingUiRequests`,
`replayPendingUiRequests`'s `extension_ui_request` branch, and the client
`extension_ui_request`/`ui_dismiss` handlers are orphans of the pre-PromptBus
protocol. Removing them is a separate cleanup change, not folded here (surgical-changes rule).

## Decision 2 — Grouped render, independent resolution

`interactiveRequests[]` already holds N pending entries, each resolvable by id.
The change is purely visual: instead of N scattered inline `interactiveUi`
rows, the concurrently-pending **free-floating** set renders inside one panel.

**Placement rule**
- Ask with `toolCallId` (paired to a tool row) → unchanged inline placement.
- Ask without `toolCallId` (free-floating; the `update_roles` case) → grouped
  panel.

**Layout: stacked, not wizard.** BatchRenderer is a linear stepper because a
single `method:"batch"` is one caller submitting all answers atomically. N
independent asks are not a linear flow — the user may answer in any order, and
each answer must fire its own `respond(requestId, …)` immediately. So the panel
is a vertical stack of independently-answerable cards, reusing the existing
per-type renderers (confirm / select / input / multiselect), not the
submit-all-at-once wizard.

**A real `type:"batch"` inside the panel.** An atomic batch prompt is one entry
in `interactiveRequests[]` with `method:"batch"`. It renders as its existing
BatchRenderer wizard, occupying one slot in the stack. It keeps its atomic
`{answers}` resolution; the surrounding stack does not change that.

**Late arrival / drop-out.** A prompt that arrives after the panel is open
appends to the stack. One that resolves or cancels (`prompt_dismiss` /
`prompt_cancel` → `dismissInteractiveRequest`) drops out of the stack. When the
pending set empties, the panel disappears. No windowing — the panel simply
reflects the current pending set each render.

## Data model

No type changes. The panel derives from existing state:

```
pendingFreeFloating = interactiveRequests.filter(
  r => r.status === "pending" && !toolCallIdOf(r)
)
```

`toolCallId` is already stored on the pushed `interactiveUi` message row
(`event-reducer.ts:1046`); the render layer reads it there or the request is
extended to carry it (render-only; not persisted to protocol).

## Risks

- **R1 — deleting (2) resurrects duplicate cards** if a non-bus double-send
  path survives. Mitigated by the Decision 1 audit; if found, fix at source.
- **R2 — placement regression** for tool-paired asks if the free-floating
  filter is wrong. Mitigated by explicit `toolCallId` presence check and a
  scenario asserting tool-paired asks stay inline.
- **R3 — reconnect replay** re-sends the pending burst; condition (1) must
  still collapse same-id re-sends so the panel does not duplicate on refresh.
  Covered by an explicit replay scenario.
