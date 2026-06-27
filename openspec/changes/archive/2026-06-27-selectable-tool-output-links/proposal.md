## Why

Auto-linkified file paths and URLs in tool output cannot be selected with the mouse to copy their text. The link elements hijack the drag gesture: a `<button>` (file links) swallows the drag, and a draggable `<a>` (URL links) starts a native link-drag the instant the cursor crosses it — so a click-drag highlight dies at the link boundary and `Ctrl+C` / right-click "Copy" never get a usable selection. Users reach for "right-click → copy the path" and get nothing.

## What Changes

- File links (`FileLink`'s `<button>`) and URL links (`UrlLink`'s `<a>`) stop hijacking the drag gesture, so a click-drag that starts on or passes over a link extends the text selection instead of dragging the link or pressing the button.
- Click-to-open behavior is unchanged: a plain click still opens the editor/preview (files) or the URL in a new tab; only a drag that produces a selection suppresses the open (native browser behavior).
- No new UI, no context menu, no copy button — the change restores the browser's built-in selection + copy machinery that the link widgets were standing in front of.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `tool-output-linkification`: the "Selection and copy preservation" requirement gains coverage for selections that start on or cross a link element (not just selections that span a link from surrounding text). Links MUST NOT intercept the drag-to-select gesture.

## Impact

- `packages/client/src/components/tool-renderers/FileLink.tsx` — add `user-select: text` and `draggable={false}` to the `<button>`.
- `packages/client/src/components/tool-renderers/UrlLink.tsx` — add `draggable={false}` to the `<a>`.
- No API, server, protocol, or dependency changes. Client-only, behavior-preserving for click-to-open.
