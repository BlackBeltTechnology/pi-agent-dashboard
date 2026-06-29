## Context

Tool output linkifies file paths → `FileLink` (renders a `<button>`, no `href`) and URLs → `UrlLink` (renders an `<a href target="_blank">`). Both are interactive widgets optimized for click-to-open. Interactive widgets hijack the drag gesture: a draggable `<a>` starts a native link-drag the moment the cursor crosses it, and a `<button>` does not contribute its inner text to a selection range. Result: users cannot click-drag to highlight a path/URL, so `Ctrl+C` and the browser's right-click "Copy" never get a usable selection. The existing "Selection and copy preservation" spec requirement only covered selections spanning a link from *surrounding* text — it never covered a drag that starts on or crosses the link itself, which is the failing case.

## Goals / Non-Goals

**Goals:**
- Click-drag highlight that starts on or crosses a file/URL link extends the text selection.
- `Ctrl+C` and native right-click "Copy" / "Copy Link Address" work on linkified text.
- Click-to-open behavior is fully preserved.

**Non-Goals:**
- No custom right-click context menu.
- No hover copy button / copy icon.
- No Electron native context-menu wiring (separate concern; the reporter is in a browser).
- No change to the tokenizer or click-routing logic.

## Decisions

**D1: `draggable={false}` on the `<a>` (UrlLink) and `<button>` (FileLink).**
Rationale: the native link-drag is the "mode change on hover" that kills the selection at the link boundary. Disabling HTML5 drag has zero effect on click — it only stops the drag-and-drop of the element — so dragging the cursor across the link now extends the text selection.
Alternative considered: render URL/file links as plain `<span>` and synthesize open on click. Rejected — larger blast radius, loses semantic `<a>`/button affordances and keyboard activation for no extra benefit.

**D2: `user-select: text` on the FileLink `<button>`.**
Rationale: a `<button>`'s inner text is not reliably part of a selection range across user agents. Explicitly opting the text in makes the button's label selectable. `UrlLink`'s `<a>` already inherits selectable text, so only the `draggable` flag is needed there.

**D3: Rely on native click-vs-drag disambiguation for open suppression.**
Rationale: browsers do not fire a `click` when the pointer interaction ends in a text selection. So a plain click still triggers `onClick` (open), while a drag that produces a selection suppresses it. No manual click-vs-drag detection needed.

## Risks / Trade-offs

- [Cursor still shows pointer on hover, which may suggest "click only"] → Cosmetic only; selection works regardless. Out of scope to change the cursor.
- [Per-UA variance in click suppression after selection] → Standard, well-supported behavior in Chromium/Firefox/WebKit; the reporter is on a desktop browser. Covered by spec scenarios.
- [`draggable={false}` could theoretically remove a wanted drag-the-link affordance] → No feature relies on dragging these links; none exists in the codebase.

## Migration Plan

Client-only attribute additions. No data, API, or protocol migration. Ships with the normal client build (`npm run build` + server restart). Rollback = revert the two component edits.
