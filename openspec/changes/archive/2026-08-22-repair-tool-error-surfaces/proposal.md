# Repair the tool-result error surfaces

## Why

Every error surface in the chat transcript is illegible in light mode, and the
headline card carries two further defects on top of contrast.

Reported as *"the bash tool result card error is completly red and unreadable"*,
then *"Split into sections, is the markdown there generated?"*. The headline case
is the `ctx_execute` runtime error card, and it stacks **three** defects:

1. **Contrast.** Its body measures **1.24:1** against its own background — text
   and fill are effectively the same colour.
2. **Flat red wash.** The whole body is `text-red-300`, so even in dark mode
   (where it measures a comfortable 10.23:1) it is one undifferentiated hue with
   no code structure.
3. **Raw markdown, never rendered.** The body is a context-mode result —
   a fenced ` ```shell ` command block plus `Exit code:` / `stdout:` / `stderr:`
   sections. It is emitted through `LinkifiedText`, which linkifies URLs and
   paths only, so the fence and the section structure render as **literal raw
   text**. The **success** path of the same component does the opposite:
   `CtxToolRenderer.tsx:239` renders fenced code through `CodeBlock` →
   `SyntaxHighlighter`, and `splitHeadingBlocks` splits the body into sections.
   A passing ctx call is highlighted and sectioned; a failing one — the case you
   most need to read — is a raw wall.

Defects 1 and 2 also affect five sibling single-line surfaces (below); defect 3
is specific to the ctx runtime error card.

`unify-message-severity-colors` already established the fix: a
`--severity-{error,warning,info,success}-{bg,fg,border}` triple set, derived via
`color-mix()` against each theme's own `--text-primary` / `--bg-tertiary`, and
gated at a 3:1 floor across 9 themes × 2 modes by
`tests/e2e/severity-contrast.spec.ts`.

It also already bans raw literals — but the requirement enumerates only
`Toast.tsx`, `SpawnErrorToastHost.tsx`, `SpawnErrorBanner.tsx` and
`extension-ui/ToastSlot.tsx` (later extended to `NotifyRenderer.tsx`). **The
tool-result renderers were never in that set.** They still ship hardcoded
`red-300` / `red-400` / `red-500` / `red-950` literals.

Those literals were chosen against a dark background, so the failure is perfectly
one-sided:

| Surface | Source | light | dark |
|---|---|---|---|
| ctx error body | `CtxToolRenderer.tsx:189` | **1.24:1** | 10.23:1 |
| ctx error label | `CtxToolRenderer.tsx:188` | **1.80:1** | 7.02:1 |
| bash exit badge | `BashOutputCard.tsx:46` | **2.12:1** | 5.89:1 |
| burst “N failed” | `ToolBurstGroup.tsx:383` | **2.27:1** | 6.28:1 |
| ask_user error text | `AskUserToolRenderer.tsx:221` | **2.27:1** | 4.87:1 |
| agent error text | `AgentToolRenderer.tsx:346` | **2.77:1** | 7.16:1 |
| tool-step status icon | `ToolCallStep.tsx:149` | **2.77:1** | 7.16:1 |

**7 of 7 fail the 3:1 floor in light mode. 0 of 7 fail in dark.** Ratios computed
by compositing each declared alpha over `--bg-primary` then applying WCAG 2.x
relative luminance. The tokenised equivalents measure 7.16:1 light / 6.94:1 dark.

### The second, non-contrast defect

The ctx error card's body is a **log dump** — a shell transcript, an exit code,
stdout and stderr. It is rendered `text-red-300`, so the entire block is one flat
red. Even in dark mode, where it measures a comfortable 10.23:1, it is still hard
to *read as code*: every token is the same hue and the structure is gone. Raising
the contrast alone would not fix the reported symptom.

The rule that resolves both: **severity belongs on the chrome, not the content.**
The border, fill and label carry the error signal; the message body stays in
normal code colours.

This is not a new invention. Six lines below the bug,
`CtxToolRenderer.tsx:194` already renders its `receivedArgs` block as
`text-[var(--text-secondary)] bg-[var(--bg-code)]`. The fix applies the rule that
same function already follows.

## What Changes

- Add the seven tool-result error surfaces to the governed no-raw-literals set,
  exactly as `NotifyRenderer` was added. *(defects 1–2)*
- Introduce the chrome-vs-content rule for multi-line error bodies: severity
  tokens style border / fill / label; the body uses `--text-secondary` on
  `--bg-code`. *(defect 2)*
- Render the ctx runtime error body's **structure** the way the success path
  already does: parse the fenced command, exit code, stdout and stderr into
  fields, and render the command through the existing `CodeBlock` and each
  stream as its own labelled section. *(defect 3)*
- Extend `tests/e2e/severity-contrast.spec.ts` to probe these surfaces, so they
  join the existing 9-theme × 2-mode gate rather than getting a parallel one.
- Add a static guard so a raw red literal cannot re-enter an error surface.

Mock: `mockups/tool-error-cards/index.html` — loads the running dashboard's own
compiled stylesheet and renders each BEFORE column with the class strings copied
verbatim from source, so the failure is reproduced rather than described.

## Impact

- `packages/client/src/components/tool-renderers/CtxToolRenderer.tsx` *(defects 1–3)*
- `packages/client/src/components/tool-renderers/parse-ctx-result.ts` *(defect 3: structured runtime-error fields)*
- `packages/client/src/components/tool-renderers/AskUserToolRenderer.tsx`
- `packages/client/src/components/tool-renderers/AgentToolRenderer.tsx`
- `packages/client/src/components/chat/ToolBurstGroup.tsx`
- `packages/client/src/components/chat/BashOutputCard.tsx`
- `packages/client/src/components/chat/ToolCallStep.tsx`
- Specs: `message-severity-tokens` (defects 1–2), `tool-renderers` (defect 3)
- Tests: `tests/e2e/severity-contrast.spec.ts`, `parse-ctx-result` unit tests,
  plus the renderers' unit tests
- No token is added or changed. No protocol, server or persistence change.

### Deliberately out of scope

`grep -rn 'red-[0-9]\{3\}' packages/client/src` returns roughly forty more hits —
preview panes, connectivity panels, destructive-action buttons, the composer stop
button. Those are not error *surfaces* and several (a red destructive button) are
correct as literals. This change governs the tool-result error surfaces only;
widening it would turn a legibility fix into an untestable repo-wide sweep.

## Discipline Skills

- `review-code` — six components across two directories; run before commit.
- `doubt-driven-review` — the chrome-vs-content rule is a new visual convention.
  Stress-test it before it becomes precedent for every future error surface.
