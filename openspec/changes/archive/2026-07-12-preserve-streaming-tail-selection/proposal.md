## Why

Follow-up to `preserve-chat-selection-during-churn` (Path B, D4). That change
keeps finished-card selections alive but leaves the **streaming tail** at
baseline: a selection anchored inside the actively-streaming card collapses
because `MarkdownContent` re-renders and replaces its Text nodes on every chunk,
and the tail `<div>` unmounts at `message_end` (`streamingText` cleared). The
DOM-freeze approach was rejected there as unviable (the node detaches at turn
completion regardless of buffering).

## What Changes

Introduce a **node-stable streaming render** for the tail so committed text
nodes are not replaced chunk-to-chunk:

- Render the streaming markdown incrementally (append-only DOM for the committed
  prefix; only the growing suffix re-renders), OR keep the tail mounted across
  turn completion by rendering it unconditionally and swapping content in place,
  so a selection's anchored nodes survive both a chunk append and the
  streaming→committed transition.
- Reconcile with the existing `isSelecting` gate: while a tail selection is
  held, buffer chunks and flush on collapse without dropping non-chunk
  mutations (`tool_execution_start` flush, `message_end`).

Non-goals: finished-card selection (already handled); copy fidelity (separate
follow-up `chat-copy-fidelity-intercept`).

## Impact

- `packages/client/src/components/ChatView.tsx` — streaming tail render path.
- `packages/client/src/components/MarkdownContent.tsx` — node-stable incremental
  render for the streaming prefix.
- Tests: a selection anchored in the streaming tail survives a chunk append and
  the turn-completion unmount/commit swap.
