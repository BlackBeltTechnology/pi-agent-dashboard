# Proposal

## Why

The editor pane header puts nine controls in one row, with no grouping, and they act on four different things:
- the pane: Files toggle, close;
- the project: search;
- new tabs: live preview, new terminal;
- the active document: path, open in system app, reveal in file manager, reload.

The document's own controls are split across two rows with the tab strip between them: path, open, reveal and reload in the header; Preview / Edit-in-handler in a separate row under the tabs. Search sits at the far right, away from the tree, and its results open over the document instead of next to the tree. Several icons are misleading: `mdiApplicationOutline` (open in system app) reads as "maximize", the globe for live preview reads as "language", and reload sits next to ✕. The icons are bare 17 px glyphs with no padding, so their targets are under the 24 px minimum (WCAG 2.5.8). Most have a `title` but no accessible name.

Users with many open documents also have no way to close several tabs at once, and no way to find a tab other than scanning the strip.

The design was explored on a mockup board and approved on 2026-10-22 (decisions D1–D5 on the board).

## What Changes

- **Pane bar replaces the header row and the tab strip:**
  - left: the labelled **Files** rail toggle;
  - then the tabs;
  - **`+`** directly after the last tab, a "New tab" menu: Terminal, Live preview, Open file… (Cmd-P);
  - right edge: **`⌄` Search tabs**, then **✕ close editor pane**.
- **Document bar** under the pane bar replaces the header path and the `FileModeSwitcher` row. For the active **file** tab it holds:
  - a breadcrumb: each folder segment reveals that folder in the tree; the file name opens the `⋯` menu;
  - the handler mode switcher (Preview / Edit in <handler>);
  - Reload;
  - Open in default app (`mdiOpenInNew`) and Reveal, labelled for the server host's platform (Finder / Explorer / file manager), still gated on `capabilities.systemOpen`;
  - a `⋯` menu: Show in file tree, Copy full path, Copy relative path, Copy file name.
- **Document bar for other tabs:**
  - Url tabs keep Open in system browser.
  - Terminal, diff, live-server and plugin tabs show a title line only.
  - Below a 640 px pane width, Open and Reveal fold into `⋯`.
- **Search moves into the rail as a view.** The rail header gets a **Files | Search** switch. Cmd-P and Cmd-Shift-F open the rail in Search view, revealing it if collapsed, without changing the stored rail preference; Esc closes it. Results no longer cover the document. Folder panes, which have no file search today, show no Search view, no Open file… item and no search shortcuts.
- **Bulk close.**
  - Right-clicking a tab offers Close, Close other tabs, Close tabs to the right, Close all tabs, Show in file tree and Copy path.
  - A bulk close that would end a terminal or discard a handler with confirmed unsaved edits shows **one** summary confirm: Cancel · Close all but these N · Close all & discard. A handler that has not reported its state closes silently in a bulk close (decided 2026-10-22); single close keeps prompting for it.
  - A bulk close with nothing to lose closes without asking.
- **Search tabs (Chrome-style):**
  - `⌄` opens a popover with focus in a filter field.
  - The filter matches the tab label plus its location (folder, url or live target, "terminal", plugin label); every word must match; case- and accent-insensitive.
  - Keyboard: ↑ ↓ to move, Enter to activate, Esc to close. Each row has a close button and an unsaved dot.
  - With a query, the bulk action becomes "Close N matching tabs", using the same confirm.
  - With no match, Enter hands the text to project file search.
- **Every pointer target** in the new chrome is at least 24 px (icon buttons 28 px) with an accessible name; a tab's × shows on keyboard focus. Menus follow the arrow-key menu model.
- Mockup: mockups/editor-pane-toolbar (in this change)

## Non-goals

- **Toolbars inside viewers stay where they are:**
  - the markdown / csv / adoc Preview-Edit + Save row;
  - the `LiveServerViewer` address bar;
  - the PDF viewer controls.

  Merging them into the document bar is a follow-up.
- **The status footer** (viewer · language · path) stays as it is; dropping its duplicate path is a follow-up.
- **A keyboard shortcut for Search tabs.** It needs a collision audit against browser, Electron and existing pane shortcuts first.
- **The browser tab's own toolbar** (URL, Input, Fit / 1:1, Bring to front, Done) stays in its body.
- **Chat-side layout, the split divider, peek handles,** including the not-yet-rendered `EDITOR` pane caption.
- **Server endpoints.** No API change; `open-in-system` and `reveal-in-file-manager` are reused as they are.

## Capabilities

### New Capabilities
- `editor-pane-chrome`: the editor pane's control layout:
  - the pane bar, the new-tab menu and the document bar, including per-tab-kind content and narrow-width folding;
  - tab-set management: the tab context menu, bulk close with its summary confirm, and the Search-tabs popover.

### Modified Capabilities
- `editor-file-search`: the search panel is hosted as a Search view of the file rail instead of a panel over the viewer column. Opening it reveals a collapsed rail, and Esc restores the previous rail visibility and returns focus to the active viewer.
- `internal-monaco-editor-pane`:
  - the close/unsplit affordance moves from the "pane header" to the pane bar (per-session route requirement);
  - the labelled rail toggle sits at the left end of the pane bar (rail requirement);
  - manual refresh is the document bar's Reload, and the "+" exclusion is reworded so the New tab control is not a create-file affordance (read-only requirement);
  - system-open: lives in the document bar, "Open in default app", a Reveal label from the server-reported platform, containment by reference to `file-read-containment`, and the url action stated by contract instead of the literal `window.open` call.
- `editor-pane-file-handlers`: "Unsaved edits are guarded". One bulk-close summary confirmation is the guard for every listed instance, and an unknown state is treated as saved in a bulk close only.
- `split-editor-workspace`: the new-terminal affordance is the Terminal item of the New tab menu.
- `terminal-viewer-tab`: create comes from the New tab menu. Single close paths (incl. Cmd-W and context-menu Close) kill without confirmation, and bulk close follows the summary confirm.
- `folder-scoped-editor-pane`: the folder pane reuses the new chrome, without the file-search entry points it cannot serve.

## Discipline Skills

- `review-code`: non-trivial client change across ≥3 components, run before commit.
- `doubt-driven-review`: on design D-decisions, done during planning.
- No `security-hardening` trigger. There is no new endpoint, auth or secret path, and no new untrusted-input sink. The url tab's external open is unchanged, and its sink hardening is owned by `harden-client-sinks`. Bulk discard is a data-loss UX concern, covered by the summary confirmation.
- No `performance-optimization` or `observability-instrumentation` trigger: no latency budget, and the tab filter runs over at most a few dozen in-memory tabs.
- Subagent checkpoint: `react-expert` applies during the build (≥3 React components touched, hooks reworked).

## Impact

- **Client:**
  - `packages/client/src/components/editor-pane/`:
    - `EditorPane.tsx`: header → pane bar + document bar;
    - `EditorTabs.tsx`: inline in the pane bar, plus context menu;
    - `TabActions.tsx`: document-bar actions and labels;
    - `EditorSearchPanel.tsx`: rail-hosted;
    - `file-handler/FileModeSwitcher.tsx`: rendered inside the document bar.
  - New components: `DocumentBar`, `NewTabMenu`, `TabSearchPopover`, `TabContextMenu`, `BulkCloseConfirm`.
  - `lib/layout/editor-pane-state.ts`: new `closeTabs` action.
  - `file-handler/file-handler-store.ts`: `discard` doc comment widened. `use-file-handler-pane.ts`: shared `handlerCloseRisk`.
  - `split/SplitWorkspaceContext.tsx`: `hasFileSearch` flag. `EditorSearchPanel.tsx`: search mode becomes a controlled prop.
  - `hooks/useServerCapabilities.ts`: also reads the existing `/api/health` `platform`.
  - i18n keys.
  - The folder-scoped pane (`FolderEditorView`) reuses `EditorPane`, so it gets the same chrome.
- **Tests:**
  - Existing `EditorPane`, `EditorTabs`, `TabActions`, `FileModeSwitcher` and `FolderEditorView` tests are updated for the new locations.
  - Playwright specs that click the moved ids are updated: `terminal-tab`, `terminal-cap`, `live-server-downloads`, `editor-pane-file-handler`, `split-divider-drag`, `directory-home`, `lazy-feature-bootstrap`, `trust-mode-pair`.
  - Protected `data-testid`s are kept, at the locations given in design D12. Deliberate exception: `new-terminal-launch`, `live-preview-launch` and `editor-search-toggle` now exist only once their menu or rail view is open, and `editor-search-toggle` is absent in folder panes.
- **Coordination:** `harden-client-sinks` migrates `TabActions`' `window.open` to its safe-navigation helper. Whichever lands second rebases the call; the behaviour is unchanged.
- **Server / shared / extension:** none. Rollback is a client revert, with no persisted-state migration: `closeTabs` writes the same per-session state shape.
