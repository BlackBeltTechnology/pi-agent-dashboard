## Why

This is **Phase 2, Step B** of `reduce-chat-render-cpu-umbrella`: true windowing of the chat transcript via `@tanstack/react-virtual`. The umbrella deferred it explicitly (umbrella task 4.5: "if Step A misses the budget, scope Step B as a follow-up change with delta specs against `chat-transcript-virtualization`; do NOT start it inside this change"). This change is that follow-up.

**Why Step A (`content-visibility: auto`) is not enough by itself.** `content-visibility` skips *layout and paint* for off-screen rows but keeps every node **mounted** in the DOM. The baseline trace attributes large costs to quantities that scale with mounted-node count, not painted-node count:

- **GC 20.7 s** (93 399 events, heap 81 → 190 MB peak) — driven by ~47 k retained nodes and their React fibers.
- **25 827 event listeners** — one set per mounted message/tool card, regardless of visibility.

Only true windowing (unmount off-screen rows) bounds these. Step B is therefore not merely a fallback if Step A "misses the budget on layout" — it is the *only* lever for the GC/listener layer. The decision gate between A and B (umbrella Decision 3) should be read against **all** trace metrics, not just layouts/s.

## What Changes

Replace the fully-materialized `groupedMessages.map(...)` render in `ChatView.tsx` with a `@tanstack/react-virtual` windowed list operating in **v3 chat mode** (`anchorTo: 'end'`, `followOnAppend`, dynamic measurement). The row model is unchanged — the virtualizer windows the *existing* heterogeneous rows (burst groups, collapsed groups, single messages), each already carrying a stable `id` key.

Four concrete workstreams, each a first-class task area:

1. **Chat-mode scroll config that satisfies `chat-scroll-lock` exactly.** Map the hand-rolled `stickToBottomRef` / 50px near-bottom / scroll-to-bottom button / `scrollToTurn` behaviors onto virtualizer config. The 50px threshold from `chat-scroll-lock` overrides the guide's default `scrollEndThreshold: 80`.
2. **`scrollToTurn → scrollToIndex` mapping.** The `ChatViewHandle.scrollToTurn(turnIndex)` public API currently does `container.querySelector('[data-turn="…"]')`, which fails when the target turn is unmounted. Replace with a `turnIndex → rowIndex` map (a turn spans multiple `groupedMessages` rows) driving `virtualizer.scrollToIndex(rowIndex, { align })`. The `ChatViewHandle` signature stays identical.
3. **Height-stability strategy for async/variable rows.** `measureElement` measures a row on mount, but markdown/mermaid render async, images load without intrinsic size, and tool groups expand on click. Above-viewport late resizes cause scroll-offset corrections (jitter). Strategy: reserve intrinsic size for images/mermaid, keep the streaming tail always-rendered and never virtualized, and re-test scroll anchoring against real message-height distributions.
4. **Per-session scroll persistence in virtual coordinates.** Today ChatView persists raw `scrollTop` across session switches. With windowing, persist `{ anchorRowIndex, offset }` and restore via `scrollToIndex`.

## Capabilities

### Modified Capabilities
- `chat-transcript-virtualization`: upgrade the off-screen requirement from "content-visibility skips layout/paint" (Step A) to "off-screen rows are unmounted (windowed)", additionally bounding DOM node count, listener count, and GC pressure by the viewport working set. Scroll/streaming semantics requirements are tightened to name the specific `scrollToTurn`, per-session-restore, and always-render-streaming-tail invariants.

### Unchanged (must be preserved, not modified)
- `chat-scroll-lock` — 50px lock threshold, scroll-to-bottom button, multi-batch `event_replay` race behavior. Windowing must reproduce all three requirements' scenarios.
- `chat-view`, `chat-display-preferences`, `chat-markdown-rendering`, `chat-math-rendering` — rendered output per row is untouched; only *which* rows are mounted changes.

## Impact

- Code: `packages/client/src/components/ChatView.tsx` (the transcript list + `ChatViewHandle` internals + scroll effects), `package.json` (add `@tanstack/react-virtual`). No server, protocol, or persistence-format changes.
- Behavior: DOM node count, listener count, and GC bounded by viewport working set regardless of session length; scroll/streaming/jump-to-turn behavior identical to before.
- **Known regression — find-in-page (Cmd-F).** Unmounted rows are unreachable by the browser's native find. This is inherent to windowing and NOT present in Step A. Must be called out for the ship decision; a follow-up (in-app search over the transcript, or a "expand all for print/search" escape hatch) is out of scope here.
- Risk (highest in the umbrella): scroll anchoring across variable async heights, `ChatViewHandle` contract, and the `chat-scroll-lock` race. Mitigated by dynamic measurement + always-rendered streaming tail + the existing `chat-scroll-lock` scenario suite as the regression gate.
- Dependency/sequencing: lands **after** `reduce-chat-render-cpu-umbrella` (needs Phase 4 memoization + the `chat-transcript-virtualization` capability to exist, and honest post-Phase-1/3 trace numbers to justify entering Step B). Reversible: revert the diff → back to Step A's `content-visibility` list.

## Discipline Skills

- `performance-optimization`: enter only on a measured Step-A-misses-budget signal; verify DOM/listener/GC reduction against a re-recorded trace, not intuition.
- `doubt-driven-review`: scroll-anchoring + `ChatViewHandle` rewrite is the irreversible-feeling structural step — review the `turnIndex → rowIndex` mapping and the `chat-scroll-lock` reproduction before it stands.
- `code-simplification`: prefer configuring TanStack chat mode over re-deriving scroll math by hand; delete the superseded `stickToBottomRef` machinery rather than layering on top of it.
