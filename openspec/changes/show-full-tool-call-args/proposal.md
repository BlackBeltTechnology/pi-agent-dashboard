## Why

Long tool-call argument strings (most painfully `bash.command`, but also `Agent.description`, `ask_user.title`, `read.path`, etc.) get **hard-sliced** in the collapsed `ToolCallStep` row — `String(args?.command).slice(0, 60)` in `ToolCallStep.tsx:29` and `slice(0, 50)` in `CollapsedToolGroup.tsx:19`. The remainder is dropped on the floor with no ellipsis, so the user sees:

```
$ test -e openspec/changes/archive/2026-05-28-bump-pi-compat-t
```

and has no way to tell that the actual command was `…-to-0-75`. Worse, clicking the chevron to expand doesn't help either: the expanded `BashToolRenderer.tsx:22` *also* applies `truncate` to the command span, so the full command is unreachable from the UI at any width.

We restore the user's ability to read what the agent actually ran:

1. **Drop hard `slice()` from collapsed summaries.** The existing CSS `truncate` class already handles overflow with a proper ellipsis — let it work against the actual available width instead of an arbitrary 50/60 char budget.
2. **Add `title={fullSummary}` to the collapsed row.** Desktop hover tooltip exposes the full text without any layout change. (Mobile is out of scope; this is a desktop affordance only.)
3. **Stop truncating the command inside `BashToolRenderer`.** Expanding the row should reveal the full command. Switch `truncate` → wrapping (`break-all`) so long commands break naturally; the surrounding panel is already `overflow-x-auto`.

## What Changes

- **`packages/client/src/components/ToolCallStep.tsx`**
  - Remove `.slice(0, N)` from the `toolSummaries` map for every entry (`bash`, `ask_user`, `Agent`, `get_subagent_result`, `steer_subagent`). The full string flows through; CSS `truncate` handles overflow.
  - Add `title={getSummary(toolName, args)}` to the row `<button>` so desktop hover shows the full summary.
- **`packages/client/src/components/CollapsedToolGroup.tsx`**
  - Same two fixes: drop `slice(0, 50)` from its local `toolSummaries`, add `title={getSummary(...)}` to the row.
- **`packages/client/src/components/tool-renderers/BashToolRenderer.tsx`**
  - Replace `truncate` on the command `<span>` with wrapping (`break-all whitespace-pre-wrap`) so the expanded view shows the full command on as many lines as needed.
- **No new dependencies, no protocol changes, no event-schema changes.**

## Capabilities

### Modified Capabilities

- `chat-view` — adds a requirement that the collapsed `ToolCallStep` summary preserves full argument strings (no hard `slice()`), exposes them via `title=` for desktop hover, and that expanded tool renderers do not re-truncate the same data.

### New Capabilities

None.

## Impact

**Affected code:**
- `packages/client/src/components/ToolCallStep.tsx`
- `packages/client/src/components/CollapsedToolGroup.tsx`
- `packages/client/src/components/tool-renderers/BashToolRenderer.tsx`

**Affected APIs:** none.

**Affected dependencies:** none.

**Affected behavior:**
- Collapsed row visual length is unchanged on overflow (CSS `truncate` still ellipsizes to the available width); only the *underlying* string is no longer pre-mutilated. On wider viewports, more of the command becomes visible automatically.
- Desktop hover on any collapsed tool-call row now shows the full summary as a native tooltip.
- Expanding a bash tool-call shows the **full** command, wrapped across lines if needed, instead of an inner-truncated single line.

**Risks:**
- A pathologically long `bash` command in the expanded view could grow the card vertically. Acceptable — that's exactly the user's stated need ("show whole line"), and the surrounding container already scrolls.
- Native `title` tooltips are styled by the OS, not Tailwind. That's fine for a v1 affordance; a custom tooltip is out of scope.
