# chat-selection-copy.ts — index

Pure `buildSelectionClipboardText(range, container)`: rebuilds clipboard text for a transcript `copy`. `Range.cloneContents()` → block-aware serialization (BLOCK_TAGS newline, `

`→\n) gives exactly the selected chars for partial-node selections. Capping renderers opt full text into copy via `COPY_TEXT_ATTR` (`data-copy-text`); a FULLY-contained capped element (`compareBoundaryPoints` on `selectNodeContents`) substitutes its full text (prefix-guarded); partially-selected capped elements keep the clipped text. Returns "" for collapsed. Consumed by ChatView `onCopy`; AgentToolRenderer PromptBlock sets the attr. See change: chat-copy-fidelity-intercept.
