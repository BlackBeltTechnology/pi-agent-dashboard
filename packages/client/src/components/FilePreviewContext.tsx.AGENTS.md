# FilePreviewContext.tsx — index

Owns hoisted file-preview open-state above chat message list. Exports `FilePreviewTarget` type, `FilePreviewContext` (nullable), `FilePreviewProvider` (owns `useState<FilePreviewTarget|null>`), `useFilePreview()` (throws outside provider), `FilePreviewHost` (renders single `FilePreviewOverlay` from `target`). Mounts once in `ChatView`. Overlay survives streaming tokens, react-markdown reparse, streaming→committed swaps, new messages. See change: fix-file-preview-survives-message-churn.
