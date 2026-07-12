## Why

Follow-up to `preserve-chat-selection-during-churn` (D5). Keeping a selection
alive does not guarantee a correct copy. Two pre-existing gaps remain:

- **Partial selections.** A `Range` can start/end mid-node inside rendered
  markdown; whole-message serialization over/under-copies. Mapping a DOM offset
  over *rendered* markdown back to a *source* offset is intractable without a
  source map.
- **DOM-capped renderers.** Some tool renderers cap content in the DOM (e.g.
  `AgentToolRenderer` renders `text.slice(0, 1000)`), so a fully on-screen
  selection over them already copies truncated text. The full prompt lives on
  `args.prompt`, not in `displayRows`/`state.messages` content — a generic
  data-model copy still sees 1000 chars.

## What Changes

Intercept the transcript container `copy` event and rebuild clipboard text for
the selected region:

- For partial rows, extract from the selected DOM via `Range.cloneContents()` →
  text — do NOT reconstruct from markdown source (no source map).
- Truly subsuming a capping renderer's truncation requires that renderer to
  expose its full text (e.g. `args.prompt`) to the copy path — per-renderer
  cooperation, not an automatic data-model read. Scope each capping renderer
  explicitly.

With this in place, the selection-preservation change's `rangeExtractor` need
only keep the visual highlight alive, not carry copy fidelity.

Non-goals: the copy-button payload (owned by `fix-table-copy-empty-clipboard`);
streaming-tail node stability (`preserve-streaming-tail-selection`).

## Impact

- `packages/client/src/components/ChatView.tsx` — container `copy` handler.
- Capping tool renderers (e.g. `AgentToolRenderer`) — expose full text to the
  copy path.
- Tests: partial-row copy fidelity; capped-renderer copy fidelity.

## Discipline Skills

None apply. Client-only fidelity fix: one pure DOM helper + a React `copy`
handler + a renderer opt-in attribute. No auth/untrusted-sink, latency budget,
new endpoint, migration, or irreversible step — the checkpoint-table triggers
do not fire.
