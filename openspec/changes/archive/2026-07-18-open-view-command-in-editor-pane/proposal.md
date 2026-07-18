# Open `/view` targets in the Monaco editor pane

## Why

`/view @path` and `/view <url>` today inject an **inline `PreviewCard` row into
the chat transcript** (server `ViewMessageStore` → `view_messages_update` →
`ChatMessage.view` → `PreviewCard` in `ChatView`). That inline surface predates
the split editor pane. Now that a full Monaco + rich-preview editor pane exists
(`internal-monaco-editor-pane`, `split-editor-workspace`), the natural home for
"look at this file/URL" is the editor pane — a resizable, tabbed, persistent
surface — not a size-capped card wedged into the message stream.

Two problems block a clean move:

1. **The editor pane can't render every kind `/view` accepts.** `fileKind()`
   (the pane's classifier) has **no** branch for `docx`, `pptx`, `xlsx`/`csv`
   (spreadsheet), `adoc`/`asciidoc`, or `eml` — all of which the inline
   `dispatchPreview` path *does* render. So `/view report.docx` routed naively
   to the pane would show raw bytes in Monaco. Closing this gap is a
   generalization of the in-flight `fix-eml-preview-in-editor-pane` change
   (which reconciles `.eml` only). **This proposal consumes and supersedes
   `fix-eml-preview-in-editor-pane`** (0/10, not started) and does all five
   rich kinds in one reconciliation.

2. **The `/view` composer handler lives outside `SplitWorkspaceProvider`**, so
   it cannot call `openInSplit` directly. Files ride the existing
   `/session/:id/editor?file=…` deep-link (already wired to `SplitRouteSync →
   openInSplit`). URLs get a small route extension (`?url=…`).

## What Changes

**Reroute `/view` → editor pane (files + URLs).**
- `onViewLocal` (App) stops sending `inject_view_message`; instead it
  `navigate`s to `/session/:id/editor` with `?file=<path>` (file target) or
  `?url=<url>` (URL target).
- The editor route gains a `?url=` param; `SplitRouteSync` calls
  `openUrlTarget(url)` when present (mirrors the existing `?file=` → `openInSplit`
  bridge). URLs render via the pane's existing `UrlViewer` (`dispatchPreview →
  PreviewBody`, identical to the old inline card — YouTube embeds included).

**Retire ONLY the `/view`-specific inline chat surface.**
- Remove server `ViewMessageStore`, the `inject_view_message` handler, and
  `view_messages_update` emission.
- Remove `ChatMessage.view?`, the `viewMessagesMap` merge in App, the
  `useMessageHandler` `view_messages_update` case, and the `<PreviewCard>` render
  call in `ChatView`.
- **Keep** the shared `preview/*` renderers, `dispatchPreview`, the `ViewTarget`
  union, `FilePreviewOverlay`, and the `/pi-view` / `…/view` overlay routes —
  they still serve FileLink clicks, canvas, and linkification. **`PreviewCard.tsx`
  the file is NOT deleted** — it exports `PreviewBody`, which `UrlViewer` /
  `PreviewOverlayView` / the new diff Preview import; only the in-chat
  `<PreviewCard>` usage + inline size caps are removed.

**Close the editor-pane rich-viewer gap (consumes `fix-eml`, generalizes to 5).**
- Add `docx`, `pptx`, `spreadsheet`, `asciidoc`, `email` to `ViewerKind` and
  `FileKind` in `shared/file-kind.ts`; classify `.docx`, `.pptx`, `.xlsx`/`.xls`,
  `.adoc`/`.asciidoc`, `.eml` (extension-only). Move `.csv` out of
  `TEXT_EXTENSIONS` → `spreadsheet` (editable).
- Register the five viewers in `viewer-registry.tsx`, each delegating to the
  existing shared `preview/*` component (`DocxPreview`, `PptxPreview`,
  `SpreadsheetPreview`, `AsciiDocPreview`, `EmlPreview`).
- Route the same five kinds in `FilePreviewOverlay` (the non-split FileLink /
  OpenFileButton surface) so it does not go blank when `/api/file` stops
  returning `content` for a reclassified extension.
- Add `ICON_BY_EXT` entries for the five extensions.

**`.csv` = spreadsheet, editable in Monaco (per the markdown pattern).**
- `.csv` classifies as `{ kind: "spreadsheet", viewer: "spreadsheet",
  editable: true }`; the tab offers a **Preview** (spreadsheet grid) / **Edit**
  (Monaco text) toggle, mirroring the existing markdown Preview/Edit toggle.
  **Behavior break:** `.csv` currently opens as Monaco text (`TEXT_EXTENSIONS`);
  after this change `/view data.csv` and file-tree `.csv` opens default to the
  grid. `SpreadsheetPreview` serves two paths: `.csv` = text (`/api/file`
  content), `.xlsx`/`.xls` = binary (existing parse endpoint).
- `/api/file` returns `content` when `editable === true` (so Monaco Edit can load
  CSV text) in addition to the existing `monaco`/`markdown` gate.

**System-open tab actions (gated on a server capability).**
- File tabs gain **Open in system app** + **Reveal in file manager**; URL tabs
  gain **Open in system browser**.
- File actions dispatch to new `POST /api/open-in-system` +
  `POST /api/reveal-in-file-manager` endpoints that spawn the OS opener on the
  server host (`open`/`xdg-open`/`start`, `open -R`/`explorer /select,`) via
  `execFile` with an argument array (no shell — injection-safe). They are shown
  only when the server advertises `capabilities.systemOpen` (a desktop-capable
  host; false in the headless Docker image / remote) — NOT a browser-side
  loopback check, which is wrong for the Docker forwarded-port case. The
  endpoints reuse the file-routes cwd-containment gate, refuse when `systemOpen`
  is false, and reject a non-loopback (or absent) request origin.
- URL action is a plain `window.open(url, "_blank")` — Electron rewrites it to
  `openExternal`, browsers honor it natively, so it works in every context with
  no gate and no server round-trip.

**Diff panel gains a rich "Preview" of the current file (4 modes).**
- The diff panel's segmented control becomes `Diff · File · Regions · Preview`.
- **Rename**: today's `Preview` (changed regions of the current file, additions
  tinted, gitDiff-derived) → **`Regions`**, function unchanged (still disabled
  without a parseable `gitDiff`).
- **New `Preview`**: renders the current on-disk file through the type-based
  renderer keyed by `fileKind(path).viewer` — the same `viewer-registry` dispatch
  a file-tree click uses (markdown→rendered, image, pdf, docx, pptx, spreadsheet,
  html, mermaid, monaco for code). Shows the current disk version of the file the
  diff was made against; available whenever the file is readable (in-cwd,
  `previewable !== false`), independent of `gitDiff`. This is what resolves the
  original "Preview disabled on an Edit diff" report.

## Impact

- **Affected specs:**
  - `file-and-url-preview` — MODIFIED `ViewTarget discriminated union` (drop the
    `ChatMessage.view?` inline-row field; `/view` routes to the pane); MODIFIED
    `Inline + overlay surfaces share renderers` (retire the in-chat `PreviewCard`
    surface); REMOVED `Inline size caps prevent runaway height`.
  - `internal-monaco-editor-pane` — MODIFIED `Shared fileKind classifier`
    (+5 rich kinds, `.csv` → spreadsheet), MODIFIED `viewer registry` (+5 viewers),
    MODIFIED `pane route` (`?url=`), MODIFIED `/api/file` (content when
    `editable`), MODIFIED `Preview/Edit toggle` (generalize to `.csv`); ADDED
    `/view opens its target in the editor pane`, ADDED `Oversized files fall back
    to a too-large notice`, ADDED `Editor-pane tabs offer system-open actions`.
  - `change-summary-table` — MODIFIED `Diff viewer Preview mode` (rename to
    `Regions`; add a new type-based `Preview` mode rendering the current file).
- **Affected code:**
  - `packages/client/src/App.tsx` (`onViewLocal` → navigate; drop
    `viewMessagesMap` merge), `components/CommandInput.tsx` (both file+url still
    parse; no inline send), `components/SessionSplitView.tsx` (`?url=` in
    `SplitRouteSync`), `components/ChatView.tsx` (drop `<PreviewCard>`),
    `hooks/useMessageHandler.ts` (drop `view_messages_update`),
    `lib/event-reducer.ts` (drop `ChatMessage.view`).
  - `packages/shared/src/file-kind.ts` (+5 kinds, `.csv`, MIME),
    `components/editor-pane/viewer-registry.tsx` (+5 viewers),
    `components/FilePreviewOverlay.tsx` (rich-kind branches),
    `lib/file-icon.ts` (+5 icons),
    `components/editor-pane/` markdown-toggle generalization for `.csv`.
  - `packages/server/src/view-message-store.ts` (**delete**),
    `browser-gateway.ts` / `browser-handlers/*` (drop `inject_view_message` +
    `view_messages_update`), `routes/file-routes.ts` (content when `editable`).
  - `packages/server/src/routes/` new `POST /api/open-in-system` +
    `POST /api/reveal-in-file-manager` (spawn OS opener; cwd-containment +
    loopback-origin gates), editor-pane tab-actions UI + `isLocalhost()` gate,
    URL `window.open` affordance.
  - `packages/client/src/components/DiffPanel.tsx` (rename `Preview`→`Regions`
    keeping its gitDiff function; add a new `Preview` mode rendering the current
    file via `fileKind`→`viewer-registry`; 4-mode toolbar).
- **Server response change:** reclassifying `.docx/.pptx/.xlsx/.adoc/.eml` makes
  `/api/file` stop returning `content` for them (viewer no longer
  `monaco`/`markdown`); `FilePreviewOverlay` is re-routed to rich renderers to
  avoid a blank regression. `.csv` still returns `content` via the new `editable`
  gate.
- **Consumes** `openspec/changes/fix-eml-preview-in-editor-pane` (removed; its
  10 tasks are folded into §3 here).
- **Security posture:** unchanged. Rich renderers (`EmlPreview`, `HtmlPreview`,
  `DocxPreview`, …) are reused verbatim with their existing sandbox / remote-block
  posture; no new bytes path.

## Discipline Skills

- `doubt-driven-review` — before removing `ViewMessageStore` + the inline
  surface, confirm no non-`/view` caller depends on it (irreversible deletion).
- `security-hardening` — touches untrusted-content render paths (`.eml`, `.html`,
  office previews) across three surfaces; verify reused sandbox/remote-block
  posture and no raw-bytes path is introduced.
- `review-code` — cross-cutting shared-type + registry + route change; review the
  diff before commit.
