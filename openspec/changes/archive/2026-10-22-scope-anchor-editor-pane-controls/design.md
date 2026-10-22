# Design

## Context

See proposal.md (Why) and the approved board `mockups/editor-pane-toolbar/index.html` (states 0, A, B1–B9, decisions D1–D5).

Current state:

- **Header:** `EditorPane.tsx` renders a single header row (`packages/client/src/components/editor-pane/EditorPane.tsx:295-366`). It holds the Files toggle (`tree-toggle`), the active path, then bare icon buttons: live preview (`live-preview-launch`), new terminal (`new-terminal-launch`), search toggle (`editor-search-toggle`), `TabActions`, reload, close. Icons are `size={0.7}` with no padding.
- **Status footer:** viewer, language and path, shown under the body (`EditorPane.tsx`, "Status footer" block at the end of the render).
- **Tab strip:** `EditorTabs` renders its own row (`EditorTabs.tsx:135`, `role="tablist"`, `overflow-x-auto`).
  - Close paths: `×`, middle-click (`EditorTabs.tsx:168`), Cmd/Ctrl-W (`EditorTabs.tsx:120-126`).
  - The `×` is `size={0.5}` and `opacity-0` until group hover (`EditorTabs.tsx:203-210`).
  - Labels: terminal labels come from `terminalTitle`. Plugin labels come from `pluginLabel`, which returns a React node (`<EditorPaneTabLabelSlot …>`, `EditorPane.tsx:91-97`). There is no plain-text plugin label.
- **Single close** (`EditorPane.tsx:377-391`):
  - a terminal tab calls `terminal.closeTerminalTab(id)`, which dispatches `closeByPath` and then kills the terminal (`lib/layout/use-terminal-pane-tabs.ts:244-250`);
  - a handler tab first awaits `fh.guardTabClose(i)`;
  - anything else dispatches `closeTab`.
  - A kill-only `killTerminal(id)` also exists (`use-terminal-pane-tabs.ts:242`).
- **`guardTabClose`** (`file-handler/use-file-handler-pane.ts:120-131`) skips the guard when another tab shares the handler instance. Otherwise it calls `store.guardDiscard(key, "close-tab")`, which prompts per instance.
  - The store exposes `getInstance(key).dirty` (`boolean | "unknown"`, initial `"unknown"`) and `discard(key)`, documented as "call after `guardDiscard`" (`file-handler-store.ts:24,94,112-115,196`).
- **Reducer:** `closeTab` and `closeByPath`, both via `reduceCloseTab` (`lib/layout/editor-pane-state.ts:233-263,277-284`). There is no multi-close. Reducer tests live in `packages/client/src/lib/__tests__/editor-pane-state.test.ts`.
- **Search:**
  - `searchOpen` is local state (`EditorPane.tsx:129`).
  - Cmd/Ctrl-P and Cmd/Ctrl-Shift-F blindly toggle it (`EditorPane.tsx:132-143`).
  - `EditorSearchPanel` renders atop the viewer column (`EditorPane.tsx:431-440`) and closes on Escape (`EditorSearchPanel.tsx:115-117`).
- **Rail visibility:** persisted via `useTreeVisible(sessionId)` (`EditorPane.tsx:98`), defaulting to collapsed. A second writer exists: `changesRevealSignal` sets `setTreeVisible(true)` (`EditorPane.tsx:110-119`), and `openChanges` persists before mount (`split/SplitWorkspaceContext.tsx:388-397`).
- **`FileModeSwitcher`:** a standalone row above the body (`EditorPane.tsx:465-472`).
- **System-open:** `tabActionTarget` picks file, url or none (`EditorPane.tsx:181-187`). `TabActions` returns null without `systemOpen` (`TabActions.tsx:57`). `useServerCapabilities` reads only `systemOpen` from `/api/health` (`hooks/useServerCapabilities.ts:11-33`), although the server also returns `platform: process.platform` (`packages/server/src/routes/system-routes.ts:1293`).
- **Folder pane:** `FolderEditorView` mounts the same `EditorPane` (`components/folder/FolderEditorView.tsx:66`). Its provider omits `fileResults`, so filename search is a no-op (`SplitWorkspaceContext.tsx:219,404`). Content grep requires a known session cwd (spec `editor-file-search`, content-search endpoint). Today's folder-pane search is therefore dead UI.
- **Primitives** in `packages/client-utils/src/`:
  - `Popover`: `role="dialog"`, portals through `LayerPortal`, dismisses on outside click and on a document-level Escape listener, not the escape stack (`Popover.tsx:123-138`);
  - `Dialog`: escape-stack;
  - `Confirm`: single action;
  - `ActionList` + `ActionListMenuContext`: `role=menuitem` buttons, no arrow keys.
- **Keyboard menu precedent:** `components/session/SessionActionsPanel.tsx:44-60` (focus helpers) and `:183-234` (`role=menu`, `onKeyDown`). Tabs already close on Delete/Backspace (`EditorTabs.tsx:110-113`).
- **`Dialog`** renders its own ✕ close button before its children (`client-utils/src/Dialog.tsx:131-139`), so the first focusable child is never a caller's button.
- **Folder-pane system-open:** the server gate `gateFilePath` admits only session cwds today (`server/src/routes/file-routes.ts:353-364,876-886`), so folder-pane Open and Reveal already fail silently (`TabActions.tsx:29-37`). The active change `core-file-cwd-admission` widens that gate. This change keeps today's folder behaviour and does not hide them.
- **Search mode:** owned by `EditorSearchPanel` (`useState("file")`, `EditorSearchPanel.tsx:49`). The provider always supplies a filename-search function, a no-op when none is wired (`SplitWorkspaceContext.tsx:404`), so the pane cannot tell today whether search exists.
- **Close shortcut:** Cmd/Ctrl-W is a window-level keydown in `EditorTabs.tsx:120-127`, active whatever overlay is open.
- **Tree expansion:** `toggleTreeRoot` toggles (`editor-pane-state.ts:295`); `setActive` merges ancestors via `mergeRoots` (`:289`).
- **Known drift, out of scope:** spec `split-editor-workspace` "Peek handles" asks for an `EDITOR` caption folded into the pane header (`SplitWorkspace.tsx:160` comment). No caption is rendered in `EditorPane` today. This change neither adds nor removes one; the pane bar is where it would go.

## Goals / Non-Goals

**Goals:**
- Pure, unit-testable cores: the `closeTabs` and `expandTreeRoots` reducer cases, `handlerCloseRisk`, `planBulkClose`, `matchTabs`.
- One close-risk predicate shared by single close and bulk close.
- No change to the persisted pane state shape.
- No server change.

**Non-Goals** (beyond proposal.md):
- virtualizing the tab list;
- changing the status footer: it keeps viewer, language and path, and dropping the duplicate path is a follow-up;
- a Search-tabs shortcut.

## Decisions

### D1 — Two chrome rows: pane bar + document bar
- **Pane bar** = `[Files] [tabs… (overflow-x-auto)] [+] ··· [⌄] [✕]`. `EditorTabs` stays the tablist component, rendered inline:
  - the tablist becomes `min-w-0 overflow-x-auto`, sized to its content, and is the only flexible item; today it is `shrink-0` (`EditorTabs.tsx:135`);
  - Files, `+`, `⌄` and ✕ are `shrink-0`;
  - so `+` follows the last tab when tabs fit, and sits at the strip's end when they overflow.
- **Accessible name:** the Files toggle's name begins with its visible label "Files" (WCAG 2.5.3). Today it is `aria-label="Toggle file tree"` (`EditorPane.tsx:302`).
- **Document bar** = a new `DocumentBar` component.

*Alternative:* A (regroup in place, three rows). Rejected on the board.

### D2 — Document bar content per tab kind
| Active tab | Left | Right |
|---|---|---|
| file | breadcrumb | handler mode switcher (claims exist) · Reload · Open in default app · Reveal · `⋯` |
| url | url | Open in system browser |
| diff, live-server, terminal, plugin | title line | — |
| none | bar hidden | — |

- **Title line:** `DocumentBar` receives the same `terminalTitle` and `pluginLabel` resolvers as `EditorTabs`, so renames and live plugin labels match the strip. For the active plugin tab the label slot mounts a second time. Label components are read-only renders of the claim (`dashboard-plugin-runtime/src/editor-pane-tab.tsx:67-79`), so this is accepted and stated in the spec.
- **Mode switcher:** receives `fh.outsideCwd`, as today (`EditorPane.tsx:465-472`), so out-of-folder files still show `file-mode-unavailable`. Its buttons (`BTN`, about 20 px tall, `FileModeSwitcher.tsx:21`) and the breadcrumb segments get `min-h-6` (24 px).
- **Outside-cwd file:** the breadcrumb shows the absolute path with inert segments. `⋯` omits Copy relative path and Show in file tree.
- **System actions:** Open and Reveal keep the `systemOpen` gate and their test ids, including when rendered as `⋯` items.
- **`⋯` menu:** Show in file tree, Copy full path, Copy relative path, Copy file name. Same three copy actions as the tree-row popup.
- **Viewer-internal toolbars** stay inside their viewers (markdown / csv / adoc Preview-Edit + Save; `LiveServerViewer` address bar).

### D3 — Narrow folding from a measured pane width, label kept
- **Measuring:** a `ResizeObserver` on the `EditorPane` root (rail included) sets `narrow = width < 640`.
- **Folding moves controls, it does not copy them.** When `narrow`, Open and Reveal are not rendered in the bar and are rendered as the first `⋯` items, so each test id exists once. The breadcrumb collapses ancestors to `…`.
- **Files label:** always shown.
- **Verification:** jsdom has no layout, so unit tests drive `narrow` through a mocked observer, and Playwright checks real widths and bounding boxes.

*Alternative:* a CSS container query. Rejected: CSS cannot move a control into a portal-rendered menu, and hiding duplicates breaks unique test ids.

### D4 — Search is a rail view; a search reveal is ephemeral, with one visibility rule
Ephemeral state in `EditorPane`:
- `railView: "files" | "search"`;
- `searchMode: "filenames" | "contents"`, lifted out of `EditorSearchPanel` into a controlled prop.

The rail renders when `railVisible = treeVisible || railView === "search"`. `railView`, `searchMode` and the search query reset when `sessionId` changes, as `sessionOnly` already does. Entries into Search pass a `{ query?, nonce }` prefill prop, so the panel focuses its field and replaces the query on every entry.

**Escape:** the panel's Escape handling moves from the input to the rail container. It closes the Search view only while focus is inside the rail, and leaves Escape elsewhere (Monaco, dialogs, popovers) alone. The Files toggle is `aria-pressed={railVisible}`:
- clicking it while pressed sets `railView="files"` and `setTreeVisible(false)`;
- clicking it while not pressed sets `setTreeVisible(true)`.

**Availability:** a new context flag `hasFileSearch`, true only when the provider was given `onFilenameSearch` (session providers). Folder providers leave it false. When false:
- the shortcut listener returns before `preventDefault`, so Cmd-P still reaches the browser's Print;
- the rail switch, "Open file…" and the Search-tabs fall-through are absent.

The persisted preference `treeVisible` is the only stored value, and search never writes it:

| Event (Search view open) | Effect |
|---|---|
| shortcut for current mode, or Escape | `railView="files"`; the rail stays only if `treeVisible`; focus goes to the active viewer |
| shortcut for the other mode | `searchMode` switches, the view stays |
| rail switch → Files tab | `railView="files"`; `setTreeVisible(true)` (explicit wish to see files) |
| pane-bar Files toggle (pressed) | `railView="files"`; `setTreeVisible(false)` |
| breadcrumb folder / Show in file tree | `railView="files"`; `setTreeVisible(true)`; expand only (D11) |
| Changed-files chip reveal | `setTreeVisible(true)`, as today; closing search later leaves the rail visible |

This removes the race between two writers: the chip still persists, search never does, and "visible after search" is computed rather than restored.

**Folder panes:** `hasFileSearch` is false, so there is no Search view (see Availability above).

*Alternative:* persisting the reveal, like `openChanges`. Rejected: a quick search should not change the user's rail preference.

### D5 — `closeTabs` reducer action, keyed by path
- **Action:** `{ type: "closeTabs"; paths: string[] }`. Paths, not indices, because the bulk flow resolves after an async dialog and an agent may open a background tab meanwhile.
- **Activation:**
  - the active tab, if it survives, stays active;
  - otherwise the nearest survivor right of the old active index, else left;
  - otherwise empty (`activeIndex = -1`).
- **Operator reactivation:** applied like `reduceCloseTab(…, true)` (`editor-pane-state.ts:254-261`).
- **Unknown paths** are ignored.
- **Shape:** the persisted shape is unchanged.

*Alternative:* N `closeTab` dispatches. Rejected: index drift and N persistence writes.

### D6 — One risk predicate; bulk runner closes in one dispatch
- **`handlerCloseRisk(tab, remainingTabs, lookups, { unknownIsRisky })`** is a pure function for the handler branch only, shared by `guardTabClose` and `planBulkClose`. It returns `"unsaved"` or `null`:
  - `null` when no handler key, when a remaining tab shares the key, or when `getInstance(key)` is `undefined` (never mounted or evicted means clean);
  - `"unsaved"` when `dirty === true`, or when `dirty === "unknown"` and `unknownIsRisky`.
- **Who passes what:**
  - `guardTabClose` passes `unknownIsRisky: true` (shipped single-close rule) and still delegates the prompt to `guardDiscard`;
  - `planBulkClose` passes `false` (user decision 2026-10-22, recorded in the `editor-pane-file-handlers` delta).
  - Single terminal close stays silent: the terminal reason exists only in `planBulkClose`.
- **Shared instances:** `openFile` dedupes by path (`editor-pane-state.ts:196-197`), so two tabs in one pane cannot share a key. The shared-instance exemption stays as defensive code, with no spec scenario.
- **`planBulkClose(openFiles, targetPaths, lookups)`** returns `{ targets, risky }`, where `risky` holds deduped entries `{ kind: "terminal" | "handler", id | key, reason, tabPaths[] }`. "Close all but these N": N counts the tabs that stay open.
- **Runner outcomes:**
  - **no risky tab:** `closeTabs(targets)`, with no dialog;
  - **Cancel:** nothing changes;
  - **Close all but these N:** `closeTabs(targets − risky)`;
  - **Close all & discard:**
    - `killTerminal(id)` once per terminal entry (kill only; never `closeTerminalTab`, which would dispatch `closeByPath` and move `activeIndex` early);
    - the existing `store.discard(key)` once per handler entry, with its doc comment extended to "after `guardDiscard` or the bulk summary confirmation" (no new store method);
    - then one `closeTabs(targets)`.
- **Recompute on confirm:** the runner runs `planBulkClose` again against the current state when the user confirms. Targets stay the path set captured before the dialog.
  - If the new risky set has an entry the dialog did not list, nothing closes and the dialog re-renders with the new list.
  - Otherwise the runner acts, and discards or kills only listed entries.
- **Popovers first, shortcut inert:** before showing the dialog, the runner closes any open menu or popover. `Popover`'s document Escape listener is not on the escape stack, so this ordering keeps Escape from dismissing both. A `paneOverlayOpen` flag makes the Cmd/Ctrl-W handler (`EditorTabs.tsx:120-127`) return early while the confirmation, the Search-tabs popover or any pane menu is open.
- **Dialog:** `Dialog` with three buttons. Cancel is focused explicitly through a ref on open, because `Dialog` puts its own ✕ first (`Confirm` is single-action).
- **Single close** (×, middle-click, Cmd-W, context-menu Close, Search-tabs row ✕) keeps today's per-tab path. `guardTabClose` now calls `handlerCloseRisk` (unknownIsRisky: true) before `guardDiscard`.

### D7 — `matchTabs`: display text only, token AND, mark fold, index-mapped highlights
- **Haystack** per tab = display label + location, never the raw path prefix:

  | Tab kind | Label | Location |
  |---|---|---|
  | file, diff | basename | parent folder relative to the cwd |
  | url, live | target | `url` / `live` |
  | terminal | `terminalTitle(id)` | `terminal` |
  | plugin | the label slot (not text) | path after its prefix |

  For plugin tabs, matching and highlighting use the location only.
- **Query:** trimmed. No tokens means an empty query.
- **Fold:** per code point, NFD, then strip U+0300–U+036F only (Latin diacritics; other scripts' marks are kept so distinct words do not collide), then lower-case. A per-character index map keeps highlight ranges on the original string. Letters with no decomposition (`ß`, `ø`, `ł`) match only themselves.
- **Order:** tab-strip order, with the first match preselected.

### D8 — Search-tabs popover
- **Structure:** `Popover` anchored to `⌄` (`tab-search-toggle`):
  - an input `role=combobox`, `aria-expanded`, `aria-controls` → `role=listbox`, `aria-activedescendant`;
  - rows are `role=option`;
  - each row's ✕ is a sibling button with `tabindex=-1`, outside the option.
- **Keyboard:** ↑ ↓ move, Enter activates, Escape closes and refocuses `⌄`. Delete or Backspace with an empty field closes the selected tab through the single-close path (same keys as `EditorTabs.tsx:110-113`).
- **The popover is also the D4 "tab-list menu".** Its empty-query footer item is labelled "Close all but the active tab", so it is not confused with the context menu's "Close other tabs", which is relative to the clicked tab.
- **Footer:**
  - empty query: "Close all but the active tab" (never relative to the highlighted row) and Close all tabs;
  - with matches: Close N matching tabs.
  - All go through D6.
- **No match:** Enter falls through to rail Search (Filenames, prefilled) when search is available. Otherwise the popover shows "No open tab matches".

### D9 — Menus: `Popover` + menu-role list with the precedent's keyboard model
- **Which menus:** `+` (`new-tab-menu-toggle`), the document `⋯` and the tab context menu.
- **Opening the context menu:** `onContextMenu`, the ContextMenu key, or Shift+F10 on a focused tab.
- **Structure:** each renders `role=menu` inside the `Popover`, with `ActionList` items in menu context.
- **Keyboard:** a small shared key handler, following `SessionActionsPanel.tsx:44-60,183-234`: ↑ / ↓ wrap, Home / End, Enter / Space, Escape closes and refocuses the trigger, disabled items are skipped. First item focused on open.
- **`+` items:**
  - Terminal → `terminal.createTerminal()` (`new-terminal-launch`);
  - Live preview → `openFile("live:preview")` (`live-preview-launch`);
  - Open file… → rail Search, Filenames (only when search is available).

### D10 — Reveal label from the server's platform
- `useServerCapabilities` also reads `body.platform` (string or undefined).
- Labels: `darwin` → "Reveal in Finder"; `win32` → "Show in Explorer"; otherwise, or unknown, "Reveal in file manager".
- The label describes the host that actually runs the opener, which the client platform does not prove (a port-forward from a remote desktop host is possible).
- `tab-reveal-in-file-manager` is kept.

### D11 — Breadcrumb navigation
- **Folder segment:** dispatches a new expand-only reducer action `expandTreeRoots { relPaths }`, which merges via `mergeRoots` and never collapses. It then sets `railView="files"` and calls `setTreeVisible(true)`, an explicit reveal.
- **Leaf:** opens `⋯`.
- **Show in file tree:** reveals the file itself. The highlight already tracks the active tab.

### D12 — Test-id map
| Control | Test id | Location |
|---|---|---|
| Files toggle | `tree-toggle` | pane bar |
| New tab | `new-tab-menu-toggle` | pane bar |
| Terminal / Live preview | `new-terminal-launch` / `live-preview-launch` | `+` menu items |
| Search tabs | `tab-search-toggle`; input `tab-search-input` | pane bar / popover |
| Close pane | `editor-pane-close` | pane bar |
| Rail Search tab | `editor-search-toggle`; Files tab `rail-view-files` | rail switch (session panes only) |
| Document bar | `doc-bar`; breadcrumb `doc-breadcrumb`; More `doc-more-menu` | document bar |
| Open / Reveal / Browser | `tab-open-in-app` / `tab-reveal-in-file-manager` / `tab-open-in-browser` | document bar or `⋯` items (< 640 px) |
| Mode switcher | `file-mode-*` (unchanged) | document bar |
| Tab context menu | `tab-context-menu` | popover |
| Bulk confirm | `bulk-close-confirm` | dialog |

## Risks / Trade-offs

- **Less room for tabs:** about 170 px goes to Files, `+`, `⌄` and ✕. → Tabs scroll, and Search tabs reaches any tab. The chrome drops from 3 rows to 2.
- **Long requirements:** `openspec validate --strict` warns about requirement length in `editor-pane-chrome`. Non-strict validation passes, and the requirements are kept whole so each one remains a single reviewable behaviour.
- **Ids move into menus, or appear only in some states,** and Playwright specs and component tests click them directly: `tests/e2e/terminal-tab.spec.ts`, `terminal-cap.spec.ts`, `live-server-downloads.spec.ts`, `editor-pane-file-handler.spec.ts`, `split-divider-drag.spec.ts`, `directory-home.spec.ts`, `lazy-feature-bootstrap.spec.ts`, `trust-mode-pair.spec.ts`, plus `components/__tests__/FolderEditorView.test.tsx`. → The D12 map and a dedicated task update every reference, and the e2e run is part of verification.
- **"Close all & discard" skips per-instance prompts.** → The dialog names each tab and its reason, Cancel has default focus, and the `editor-pane-file-handlers` delta makes the summary the guard.
- **Bulk close discards an instance in `"unknown"` state without asking** (user decision). A handler that holds edits but never reports loses them on Close all. → The handler contract already says to report. Single close still prompts. The rule is stated in the `editor-pane-file-handlers` delta.
- **Plugin label slot mounts twice** (strip + title line). → Labels are read-only claim renders. Accepted and specified.
- **Search moves from right to left.** → The shortcuts are unchanged, and the rail Search tab is labelled.
- **Folder panes lose a search button that never worked there.** → Stated in the `folder-scoped-editor-pane` delta.
- **Coordination with `harden-client-sinks`,** which rewrites `TabActions`' `window.open`. → The url-action requirement is now worded by contract, and whichever change lands second rebases.

## Migration Plan

Client-only:
- `closeTabs` writes the same `EditorPaneState`;
- the rail view and search mode are ephemeral;
- `useServerCapabilities` reads one more existing `/api/health` field;
- `SplitWorkspaceContext` gains a `hasFileSearch` flag, derived from what the provider already receives.

Deploy is a client build plus restart (`implement` skill), and rollback is a revert of the client commit. localStorage stays valid in both directions.

## Open Questions

- Keyboard shortcut for Search tabs: deferred (proposal non-goal), and needs a collision audit. Adding it later changes no requirement here.
