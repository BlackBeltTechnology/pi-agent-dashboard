# Design — fix-file-preview-survives-message-churn

## Problem framing

State that must survive a frequently-reconciled list has to live **above** the
list. Today the file-preview open-state lives at the deepest leaf (`FileLink`),
inside a subtree (`MarkdownContent` → react-markdown) that gets rebuilt on every
content change. No key strategy rescues leaf state across a tree rebuild.

## Options considered

| Option | Survives msg churn | Effort | Notes |
|---|---|---|---|
| A. Stable `FileLink` keys | ❌ | low | react-markdown reparse + streaming→committed branch swap defeat it. Band-aid. |
| B. Hoist to `FilePreviewContext` at `ChatView`, single overlay | ✅ | medium | **Chosen.** Owner above message reconciliation. |
| C. Hoist to `App` / global store | ✅ (also across view switches) | medium-high | Overkill unless preview must persist when navigating away from chat. |

### Why B over C

Decision boundary: **should an open preview survive navigating away from the
chat view entirely** (e.g. switching sessions)?

- If "survives message updates within the same chat" is enough → provider at
  `ChatView` (Option B). Switching away unmounts `ChatView` and the preview —
  acceptable and arguably expected.
- If previews must persist across navigation → provider at `App` (Option C).

We choose **B**. The reported bug is strictly "new message closes my open
preview." Persisting across full view changes is a different, unrequested
behavior and adds global-state surface for no current need. C remains a clean
future upgrade (move the provider up one level) if that need appears.

## Target architecture

```
ChatView
 └─ <FilePreviewProvider>                 ← state lives here (above the list)
     ├─ groupedMessages.map → … → <FileLink onClick={() => open(path,line,cwd)} />
     └─ <FilePreviewHost/>                ← renders ONE <FilePreviewOverlay> from ctx.target
```

### Context shape

```ts
interface FilePreviewTarget { cwd: string; path: string; line?: number }

interface FilePreviewContextValue {
  target: FilePreviewTarget | null;
  open(target: FilePreviewTarget): void;
  close(): void;
}
```

- `FilePreviewProvider` owns `useState<FilePreviewTarget | null>(null)`.
- `useFilePreview()` hook returns the context value; throws if used outside the
  provider (standard guard).
- `FilePreviewHost` reads `target` and renders `target && <FilePreviewOverlay
  {...target} onClose={close} />`. Single instance.

### FileLink changes

- Keep `useFileOpenRouting` for the **editor-vs-preview routing decision**
  (`localEditorAvailable`, `editorName`, `openFile`) — that logic is unchanged.
- Remove the preview `useState` and the inline `<FilePreviewOverlay>` JSX.
- In the preview branch, instead of `setPreview(...)`, call
  `useFilePreview().open({ cwd, path, line })`.
- `cwd` is already available in `useFileOpenRouting`; pass it through to `open`.

### useFileOpenRouting changes

- Drop `preview` / `setPreview` / `closePreview` state and `PreviewTarget`.
- `openFile(path, line)` for the preview branch delegates to the context
  `open`. The editor branch (`POST /api/open-editor`) is untouched.
- Net: the hook becomes routing-only; it no longer holds UI state.

## Invariants preserved

- Editor routing (localhost + detected editor) still POSTs `/api/open-editor`,
  no overlay. (`tool-output-linkification` "Click routing — localhost editor".)
- Overlay dismissal: Esc + backdrop click still close via `onClose` → ctx
  `close`. (`FilePreviewOverlay` already uses `onCloseRef`.)
- Extension routing inside the overlay (`.md` → MarkdownContent, image → `<img>`,
  else line-numbered/highlighted) unchanged.
- Anti-traversal `/api/file` + `/api/file/raw` server contract untouched.

## New invariant (the fix)

- An open preview's React owner (`FilePreviewProvider`) is mounted above
  `groupedMessages.map`, so it does **not** remount when a message is appended,
  a message streams, or react-markdown reparses message content. The overlay
  persists until the user dismisses it or navigates away from `ChatView`.

## Testing strategy

- Unit/RTL: render `ChatView` (or a minimal provider+FileLink harness), open a
  preview, then push a new message into the store / advance streaming text;
  assert the overlay (`data-testid="file-preview-overlay"`) is still in the DOM.
- Unit/RTL: assert exactly one overlay node exists after opening two different
  file links sequentially (single-instance invariant).
- Regression: Esc and backdrop click still close (existing overlay tests
  continue to pass against the hoisted instance).
- Editor branch unchanged: localhost-with-editor click still calls
  `/api/open-editor` and renders no overlay.
