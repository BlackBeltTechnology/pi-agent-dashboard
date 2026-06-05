# Redesign ask_user question cards

## Why

The `ask_user` interactive cards have two concrete usability problems, both
observed live in the dashboard:

1. **`select` with long options is unreadable.** Options render as horizontal
   `flex flex-wrap` blue buttons. When labels are long (e.g. a design decision
   with a code fragment and a trailing rationale), they wrap unpredictably into a
   multi-row block with no scan order, and `Cancel` hides among the colored
   blocks. A real example: a 4-option "Final direction for the worktree
   openspec-init step" prompt where each option is a full sentence.

2. **Answered cards lose context.** Once a `select`/`multiselect` resolves, the
   card collapses to a one-line summary showing *only the chosen value(s)*.
   Scrolling back through history, "TypeScript" alone tells you nothing about
   what else was offered or rejected.

Separately, **batch `ask_user` has no first-class UI**. Today the bridge
decomposes a batch into sequential single-question dispatches; the client renders
each as an independent card and the user cannot review or revise earlier answers
before the batch completes.

Mockups (faithful to dashboard CSS tokens) are saved under `mockups/` in this
change folder: `question-cards.html`, `batch-wizard.html`.

## What Changes

### Single-question cards (client-only)

- **Vertical option rows** for `select` and `multiselect`: replace the
  horizontal wrapping buttons with full-width, one-per-line rows. Each row may
  show an optional description sub-line (text after the first ` — ` / ` · `
  separator in the option) and a number / `Esc` hotkey hint.
- **Answered cards keep full context**: a resolved `select`/`multiselect` card
  SHALL render the *entire* option list, dimmed, with the chosen option(s)
  highlighted — never collapse to just the picked value. **All options shown as
  asked; no `+N more` expander and no folding**, however long the list.
- **`input` answered state** shows the question as the label and the entered
  value in a read-only field; an empty submit reads as `(left blank)` (distinct
  from `Cancelled`).
- **`confirm` labels become `Yes` / `No`** (was `Allow` / `Deny`), keeping
  green/red coloring. Rationale: `ask_user` confirm is a generic yes/no question,
  not a permission gate.

### Batch as a wizard (client + bridge + shared protocol)

- A batch `ask_user` SHALL render as a **single wizard card**: a stepper header,
  one question per page, `Back` / `Next`, and a final **Review** page listing
  every answer with per-row `Edit` that jumps back to that step.
- A batch step MAY be a `multiselect`, yielding **multiple answers for one
  step**; those render as a pill group in the step, Review, and answered states.
- The answered batch collapses to a **read-only Q→A summary** (no Back/Next/Edit)
  that preserves every question and answer.
- This requires a **new single-request `batch` prompt method** in the protocol:
  the bridge sends all questions in one `prompt_request`, the client collects all
  answers and returns them as one response, and the bridge awaits once. The
  current sequential decomposition cannot support "review and edit before submit"
  because each answer is consumed before the next question is asked. See
  `design.md`.

## Impact

- Affected specs:
  - `interactive-renderers` — vertical rows, answered-context, Yes/No,
    BatchRenderer wizard.
  - `ask-user-tool` — single-request batch dispatch.
- Affected code:
  - `packages/client/src/components/interactive-renderers/SelectRenderer.tsx`,
    `MultiselectRenderer.tsx`, `InputRenderer.tsx`, `ConfirmRenderer.tsx` —
    pending + answered redesign.
  - New `packages/client/src/components/interactive-renderers/BatchRenderer.tsx`
    + `registry.ts` registration for `batch`.
  - `packages/extension/src/ask-user-tool.ts` — dispatch batch as one
    `batch`-method UI request instead of a sequential per-question loop.
  - `packages/shared/src/*` — add `batch` to the interactive method union and the
    request/response payload shapes (`questions[]` in, answers `[]` out).
- Backward compatibility: single-method calls (`confirm`/`select`/`multiselect`/
  `input`) are unchanged on the wire. Only batch gains a new method.
