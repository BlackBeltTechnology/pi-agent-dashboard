# Design: add-file-download

## Context

- **Raw route.** `GET /api/file/raw` streams a file's bytes behind `networkGuard`, cwd admission and containment (`packages/server/src/routes/file-routes.ts:1410-1460`). It always sets `Content-Disposition: inline` (`file-routes.ts:1478`) and adds `RAW_SANDBOX_CSP` + `nosniff` for scriptable types (`file-routes.ts:1479-1486`).
- **Existing attachment header.** The EML-attachment route already builds an ASCII + `filename*` attachment header inline (`file-routes.ts:1996-2005`). It does not neutralise `\`.
- **Raw URLs and download links.** The client builds raw URLs with `rawUrl()` (`packages/client/src/components/preview/raw-url.ts:7`). Existing download links use the `download` attribute only: `FallbackPreview.tsx:22-28`, and `TruncationBanner.tsx:35` via its `downloadHref` prop.
- **Auth and grants live only in fetch.** Cross-origin API bases authenticate with a bearer that only the global `fetch` wrapper adds (`packages/client/src/lib/pairing/device-auth.ts:9-20`). Same-origin browsers use an httpOnly cookie. The access-grant channel header is likewise fetch-only, so a plain link navigation carries neither.
- **Document bar.** `MoreMenu` (`packages/client/src/components/editor-pane/DocumentBar.tsx:128`) renders through `MenuPopover`/`MenuItem` (`MenuPopover.tsx:23-58`), which already implement the menu keyboard model. Its copy items are at `DocumentBar.tsx:183-185`, and `isFile` is computed at `DocumentBar.tsx:208`.
- **File-tree rows.** Rows render `RowCopyAffordance` (`EditorFileTree.tsx:107`; dir rows `:329`, file rows `:454`), a custom portal popup without the menu keyboard model. The glyph is `opacity-0 group-hover:opacity-100 focus-visible:opacity-100` (`EditorFileTree.tsx:194`).
- **Tab context-menu precedent.** The tab strip opens a context menu on secondary click and the keyboard context-menu keys (`EditorTabs.tsx:135`, `EditorTabs.tsx:200`).
- **Dirtiness.** Buffer dirtiness is computed inline for `unsavedPaths` (`EditorPane.tsx:579-588`): a built-in buffer via `unsavedStore`, or a handler instance's `dirty`.
- **Electron.** Remote server windows handle `will-download` with a save dialog (`packages/electron/src/lib/server-windows.ts:801-804`). The local main window uses Electron's default download behaviour.

## Goals / Non-Goals

**Goals**
- Save any workspace file from the viewer `⋯` menu and from the file tree.
- Download honours the same auth and grant semantics as viewing.
- Row actions are reachable by mouse, keyboard and touch.

**Non-Goals**
- Folder / zip download.
- Unsaved buffer contents.
- URL, terminal, plugin and `source:` tabs.
- Changing the existing fallback/truncation links.
- Android/Capacitor shell download handling.

## Decisions

### D1 — Server attachment mode via `download=1`
`/api/file/raw` reads an optional `download` query value. The exact value `"1"` switches `Content-Disposition` to the attachment form (D2) using the basename of the resolved, contained path. Every other value, and absence, keeps `inline`. Nothing else changes: admission, containment, Content-Type, scriptable-type CSP, nosniff, cache and Range all run as today. Download therefore never grants more than inline viewing.

### D2 — One shared header helper
Extract `contentDispositionAttachment(name: string): string` (server, pure, unit-tested) and use it at both the raw route and the EML-attachment site (`file-routes.ts:1996-2005`):
- `filename="…"`: replace every char outside printable ASCII `0x20-0x7E` (so CR/LF too), plus `"` and `\`, with `_`.
- `filename*=UTF-8''…`: percent-encode every byte outside RFC 5987 `attr-char` = `encodeURIComponent(name)` with `'`, `(`, `)`, `*` additionally encoded. `encodeURIComponent` leaves `!` and `~` as-is, and both are legal `attr-char`.

For EML the only observable change is that `\` becomes `_` in the ASCII fallback, which tightens the existing anti-injection intent.

### D3 — Hybrid client delivery
`startDownload(target, { outsideCwd })` lives in a new client module next to `raw-url.ts`.
- **Link path.** Used when `getApiBase() === ""` (same-origin, cookie auth) **and** the target is inside the pane cwd. It creates a temporary `<a href={downloadUrl(target)} download>`, clicks it and removes it. The browser streams to disk with no memory cap. Failures surface only at browser level; that is an accepted trade-off, since in-cwd same-origin files are already admitted for viewing.
- **Blob path.** Used in every other case (a cross-origin/paired base, or an outside-cwd file). It calls `fetch(downloadUrl(target))` through the global wrapper, which adds the bearer and grant headers and may raise the grant prompt. A non-OK response or network error shows an error toast (`components/primitives/Toast.tsx`). On success it saves `URL.createObjectURL(blob)` under the basename via a temporary `<a download>`, then revokes the object URL. The whole file is held in memory; that is acceptable for this path's typical use.

`downloadUrl(target) = rawUrl(target) + "&download=1"`.

*Rejected:*
- **Link everywhere.** Loses the bearer and grant (silent 401/403).
- **Blob everywhere.** Memory cost for large in-cwd media.
- **A server download ticket.** Adds a new auth surface.

### D4 — Document bar Download
`MoreMenu` adds `MenuItem testId="doc-download"` after the copy items for file tabs. For outside-cwd tabs it uses the same target the viewer used, so admission is identical. Extract the inline dirty expression from `EditorPane.tsx:579-588` into a local `isTabDirty(tab)` helper shared by `unsavedPaths` and the new `DocumentBar` prop `dirty`. `MenuItem` gains an optional `hint?: ReactNode`, rendered as a muted second line. When `dirty`, the Download item carries the hint "Unsaved changes not included" and stays enabled. Both Download items (`doc-download`, `tree-row-download`) show a leading `mdiDownload` icon. The hint uses `--text-tertiary` (`--text-muted` fails contrast). This is as accepted in mock `mockups/2026-11-23-file-download`.

### D5 — File-tree row actions menu on `MenuPopover`
`RowCopyAffordance` → `RowActionsMenu`:
- **Rendering.** It renders via `MenuPopover`, so it gets focus on the first item, ↑/↓/Home/End, Escape back to the trigger, and outside-click dismissal. A non-item header shows the absolute path. Rail-scroll dismissal is kept.
- **Glyph.** `mdiDotsHorizontal`, `aria-label` "Row actions", `aria-haspopup="menu"`, `aria-expanded`. Its class adds `[@media(hover:none)]:opacity-100` so touch devices see it.
- **Items.** Copy full / relative / name (✓ then close, as today). On file rows (`isDir=false`) it adds `tree-row-download`, which calls `startDownload` (in-cwd, so the link path is used on same-origin) and closes at once.
- **Opening.** The row container gets `onContextMenu` (preventDefault + open, anchored to the glyph). The row button handles `ContextMenu` and Shift+F10 keys, mirroring `EditorTabs.tsx:200`. `MenuPopover` gains an optional `returnFocusTo?: HTMLElement` (default `anchorEl`). A keyboard-opened row menu passes the row button, so Escape returns focus to the row that opened it.

Rows are app controls, like tabs, so taking over the native context menu follows the tab precedent. The tree shows no unsaved hint: the tree is not tab-aware. This is an accepted inconsistency; the document bar is where edits live.

### D6 — i18n
Reuse `common.download`. Add `editor.rowActions`, `editor.downloadUnsavedHint` and `editor.downloadFailed` to every locale table. Calls keep `t(key, undefined, default)`.

## Risks / Trade-offs

- **No in-app error on the link path.** A file deleted between listing and click gives a browser-level failed download. This is accepted for simplicity.
- **Blob memory.** A large outside-cwd or cross-origin file is held in memory. These are rare cases.
- **Native context menu.** It is unavailable on tree rows.
- **CSP.** A `blob:` URL used as a download anchor `href` is a download navigation, not a script load, so the baseline policy's `script-src` (which bans `blob:`) is untouched. No CSP directive changes.

## Migration / Compatibility / Rollback

The query parameter is additive and optional. The EML header change is fallback-only tightening. There is no persisted state and no migration. Rollback is a plain revert.
