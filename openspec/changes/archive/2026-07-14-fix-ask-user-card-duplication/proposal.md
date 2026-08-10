## Why

A live `ask_user` prompt paints **two stacked cards** in chat:

1. The **tool card** — `ToolCallStep` → `AskUserToolRenderer` (role `toolResult`,
   `toolName: "ask_user"`). Renders a method badge + **title** + **message/description**.
   `ChatView` passes `showResultBody={... || msg.toolName === "ask_user"}`, forcing
   the body open.
2. The **interactive dialog** — the paired `interactiveUi` message →
   `ConfirmRenderer` / `SelectRenderer` / `MultiselectRenderer` / `InputRenderer`.
   In the **pending** state these also render the **title** + **message**, plus the
   answer widget.

So while a prompt is pending, both the **title** and the **message** are duplicated
across two bordered cards — it reads as a bug (see the captured screenshot in the
change discussion). The `interactive-ui-dialogs` spec already intends the tool step
to be a collapsed summary line, but `AskUserToolRenderer` diverged into a full
expanded card and `showResultBody` forces it open.

There is a trap in the naive fix: the resolved interactive renderers **drop
`params.message`** (the `interactive-renderers` spec only requires `message` in the
*pending* state). And on history reload the server replays only *pending* prompts —
for an already-answered `ask_user` the `interactiveUi` message is gone, so the tool
card is the **only** surviving record of the question + answer. So the tool card
cannot be blanket-removed; suppression must be conditional on a live paired
`interactiveUi` message.

## What Changes

- **Suppress the `ask_user` tool card when a paired `interactiveUi` message is
  present.** In `ChatView`, when rendering a `toolResult` with
  `toolName === "ask_user"`, return `null` if the current message list contains an
  `interactiveUi` message whose `toolCallId` matches. The interactive card becomes
  the single card for that question. When no paired `interactiveUi` message exists
  (history reload of an answered prompt), the tool card renders as today — it stays
  the sole record.
- **Carry the description into the resolved interactive card.** `ConfirmRenderer`,
  `SelectRenderer`, `MultiselectRenderer`, and `InputRenderer` render
  `params.message` as a markdown body in the **resolved** state too (currently
  pending-only), so the description survives after the user answers.

Net effect: exactly one card at every moment (pending → answered), title and
description shown once, description never lost.

## Mockups

[`mockups/ask-user-card-duplication.html`](mockups/ask-user-card-duplication.html) —
self-contained static mockup on the dashboard's `studio` (dark) theme tokens. Three
columns:

- **Current (the screenshot)** — the two stacked cards; the duplicated title is
  outlined red, the tool-card-only description is outlined yellow.
- **Proposed · A (chosen)** — the interactive dialog is the single card, pending →
  answered, with the description preserved in the resolved state.
- **Proposed · B (rejected)** — a single merged morphing card, kept for reference; not
  adopted because it rewires the `event-reducer` ordering path.

Serve locally with `mcp__pi__serve_mockup{dir: "…/mockups"}` or open the file directly.
Scored PASS on contrast / responsive / hierarchy / token-fidelity / anti-slop
(dashboard mockup rubric).

## Discipline Skills

- `doubt-driven-review` — the suppression hinges on the `toolCallId` pairing and the
  history-reload edge case; verify the reconstructed-answer path is unaffected before
  it stands.

## Capabilities

- `interactive-ui-dialogs` — the `ask_user` Tool Call Rendering requirement (tool
  card suppression when a paired interactive card exists).
- `interactive-renderers` — resolved renderers show `params.message`.

## Scope

- Client-only. No bridge, server, or protocol changes.
- Files: `packages/client/src/components/ChatView.tsx`, `ConfirmRenderer.tsx`,
  `SelectRenderer.tsx`, `MultiselectRenderer.tsx`, `InputRenderer.tsx`.
- Backward compatible: history-reload rendering of answered prompts is unchanged
  (no paired `interactiveUi` → tool card still renders).
