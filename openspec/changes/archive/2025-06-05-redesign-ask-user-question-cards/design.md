# Design

## Context

`ask_user` interactive cards render via per-method components in
`packages/client/src/components/interactive-renderers/` (`ConfirmRenderer`,
`SelectRenderer`, `InputRenderer`, `MultiselectRenderer`, …) wired through
`registry.ts`. Each receives `InteractiveRendererProps` with `status`
(`pending` | `resolved` | `cancelled` | `dismissed`), `params`, `result`,
`onRespond`, `onCancel`.

The single-question redesign (vertical rows, answered-context, Yes/No) is
**purely client-side** and low risk. The hard decision is the batch wizard.

## Decision 1 — Batch needs a new single-request `batch` protocol method

### Current behavior (the blocker)

`packages/extension/src/ask-user-tool.ts` handles a batch by **looping on the
bridge side**, doing one blocking `await ctx.ui.<method>(...)` per sub-question:

```
ask_user batch ──▶ bridge loop
   await ctx.ui.input(...)   ──▶ prompt_request 1 ──▶ client card 1 ──▶ answer
   await ctx.ui.select(...)  ──▶ prompt_request 2 ──▶ client card 2 ──▶ answer
   await ctx.ui.confirm(...) ──▶ prompt_request 3 ──▶ client card 3 ──▶ answer
```

The client only ever sees **one independent card at a time** and has no idea the
cards belong to a batch. The bridge consumes each answer and moves to the next
question. A wizard that lets the user **review and edit earlier answers before
submitting** is therefore impossible on this transport — by the time question 3
is asked, answers 1 and 2 are already returned to the model's tool call stream.

### Options considered

| Option | Mechanism | Recheck/Edit | Cost |
|---|---|---|---|
| **A — new `batch` method** | bridge sends ONE `prompt_request {method:"batch", questions:[...]}`; client renders wizard, returns one response `{answers:[...]}`; bridge awaits once | ✅ full | shared protocol + bridge + new renderer |
| B — client groups sequential cards | client sniffs the `"<title> — <sub>"` prefix and stacks cards into a pager | ❌ cannot edit a consumed answer | fragile title-sniffing, no real review |

### Chosen: Option A

Only Option A delivers the requested "recheck the answers" flow. It is the one
architectural change that crosses the `shared` protocol and the bridge.

### Wire shape (additive)

- New interactive method literal: `"batch"` added to the method union in
  `packages/shared/src/*`.
- Request params for `batch`:
  ```ts
  { method: "batch", title: string, message?: string,
    questions: Array<{ method: "confirm"|"select"|"multiselect"|"input";
                       title: string; message?: string;
                       options?: string[]; placeholder?: string }> }
  ```
- Response result for `batch`:
  ```ts
  { answers: Array<
      { confirmed: boolean } | { value: string } | { values: string[] }
    > }   // index-aligned with questions[]
  ```
- Bridge: `ask-user-tool.ts` builds the `questions[]`, issues ONE UI request via
  the proxy, awaits the `{answers}` result, and maps it back to the existing
  text + `details` return shape (unchanged for the model). Cancellation returns
  the existing "User cancelled batch …" summary.

Single-method calls are untouched on the wire — no migration risk.

## Decision 2 — Answered cards keep context, not just the answer

`status !== "pending"` currently collapses to a one-liner with only the picked
value. New rule: **collapse emphasis, not information.** Answered
`select`/`multiselect`/`confirm` render the full option set, dimmed, pick(s)
highlighted; `input` renders the value in a read-only field. This applies in the
batch answered summary too (read-only Q→A list, multiselect answers as pills).

**Many options:** always render all, no `+N more`, no fold. Decided explicitly —
faithfulness to what was asked beats scrollback compactness. An optional
click-header-to-fold on the batch summary is allowed but not required.

## Decision 3 — `confirm` = Yes / No

Rename `Allow`/`Deny` → `Yes`/`No` (green/red retained). The same
`ConfirmRenderer` is also reachable by genuine permission gates; per-call label
overrides (`confirmLabel`/`denyLabel`) are **deferred** until a permission prompt
actually needs the stronger wording. Default is Yes/No.

## Risks / trade-offs

- Adding a `batch` method touches `shared` + bridge + client together; the three
  must ship in one change (they already are). Mitigated by additivity: old
  methods unchanged, only a new arm added.
- Tall answered cards for very long option lists are accepted by Decision 2.
- Wizard state (per-step answers held client-side until Submit) lives only in the
  `BatchRenderer` component; if the session disconnects mid-wizard the request is
  re-driven from the pending `prompt_request` like any other interactive card.
