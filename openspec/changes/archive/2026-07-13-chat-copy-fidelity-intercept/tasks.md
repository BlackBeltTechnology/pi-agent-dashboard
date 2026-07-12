## 1. Copy-event interception

- [x] 1.1 Add a `copy` handler on the chat scroll container that rebuilds clipboard text from the active selection.
- [x] 1.2 Partial rows: extract selected text via `Range.cloneContents()` → text (no markdown-source reconstruction).
- [x] 1.3 Capping renderers: expose full text (e.g. `args.prompt`) to the copy path per renderer (start with `AgentToolRenderer`).

## 2. Validate

- [x] 2.1 Test: partial-node selection copies exactly the selected characters.
- [x] 2.2 Test: selection over a DOM-capped renderer copies the full text once the renderer cooperates.
