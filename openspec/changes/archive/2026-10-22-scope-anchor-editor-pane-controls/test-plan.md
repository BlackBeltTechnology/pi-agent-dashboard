# Test Plan — scope-anchor-editor-pane-controls

Stage: design   Generated: 2026-10-22

Hard gate passed with no open clarifications. The user decisions on 2026-10-22 already resolve the only ambiguities: D1–D5 on the board, and "unknown state closes silently in bulk". The specs state no performance requirement, so there is no Performance class.

Exemplars by level:

| Level | Exemplar |
|---|---|
| L1 reducer | `packages/client/src/lib/__tests__/editor-pane-state.test.ts` |
| L1 pane | `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`, `EditorPane.file-handler.test.tsx` |
| L1 tabs / actions / search | `components/editor-pane/__tests__/EditorTabs.test.tsx`, `TabActions.test.tsx`, `EditorSearchPanel.test.tsx` |
| L1 handlers | `components/editor-pane/file-handler/__tests__/file-handler-store.test.ts` |
| L1 hooks | `packages/client/src/hooks/__tests__/useActiveChatSelection.test.tsx` |
| L1 folder pane | `packages/client/src/components/__tests__/FolderEditorView.test.tsx` |
| L1 i18n | `packages/client/src/__tests__/i18n.test.ts` |
| L3 | `tests/e2e/editor-pane.spec.ts`, `tests/e2e/terminal-tab.spec.ts` (docker harness, derived port from `.pi-test-harness.json`) |

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | chrome: context menu activation rule | decision table | L1 | automated | tabs `a,b,c,d`, active `b` | `closeTabs` with `[b,c]`; `[c,d]` (active `d`); `[a,b,c,d]`; `["zzz"]` | active becomes `d`; `b`; `activeIndex -1`; state object identical (`===`) for the unknown path |
| E2 | chrome: activation + unread invariant | state | L1 | automated | tabs `a,b,c`, active `b`, `c.unread=true` | `closeTabs([b])` | `c` active, `c.unread=false`; persisted JSON has the same key set as before |
| E3 | file-handlers delta: unknown in bulk only | decision table | L1 | automated | instance states {no key, `getInstance` undefined, `dirty=false`, `true`, `"unknown"`} × `unknownIsRisky` {true, false} | `handlerCloseRisk` | `"unsaved"` only for `true`, and for `"unknown"` when the flag is true; `null` otherwise |
| E4 | chrome: bulk confirm entries + N | EP | L1 | automated | tabs `a.ts`, `term:t1`, `memo.pdf` (dirty true), `x.docx` (unknown), `b.ts` | `planBulkClose(all)` | `risky` = [`t1` terminal, `memo.pdf` unsaved]; `x.docx` absent; tabs kept by "but these" = 2 |
| E5 | chrome: Search tabs matching | EP | L1 | automated | tabs `Status Beszámoló.pdf`, `Status Beszamolo 2.pdf`, `memo.pdf` in `Projektek/BOSCH`, `term:t1` titled `zsh` | queries `beszamolo`, `bosch memo`, `bosch kickoff`, `term:`, `"   "` | 2 matches; `memo.pdf`; none; none; empty-query state (all 4 listed) |
| E6 | chrome: fold limits | EP | L1 | automated | tabs `Łódź.md`, `Straße.md`, `שָׁלוֹם.md` | queries `lodz`, `strasse`, `שלום` | no match for each (`ł`, `ß` and Hebrew marks are not folded) |
| E7 | chrome: highlight mapping | EP | L1 | automated | label `Status Beszámoló.pdf` | query `beszamolo` | highlight range covers exactly `Beszámoló` (9 characters of the original string) |
| E8 | chrome: narrow fold | BVA | L1 | automated | mocked `ResizeObserver` widths 639, 640, 641; `systemOpen=true`; file tab | render | 639: Open/Reveal only as `⋯` items, breadcrumb `… › file`; 640/641: in the bar; each test id occurs exactly once at every width |
| E9 | chrome: document bar per kind | decision table | L1 | automated | active tab ∈ {file in cwd, file outside cwd, url, diff, live, terminal, plugin, none} × `systemOpen` {true,false} | render | file: breadcrumb, Reload, `⋯`, plus Open/Reveal only when `systemOpen`; outside cwd: absolute inert breadcrumb, `⋯` without Copy relative path / Show in file tree; url: Open in system browser; diff/live/terminal/plugin: title line only; none: no `doc-bar` |
| E10 | system-open delta: Reveal label | EP | L1 | automated | `/api/health` `platform` ∈ {`darwin`, `win32`, `linux`, missing} | render file tab with `systemOpen=true` | "Reveal in Finder", "Show in Explorer", "Reveal in file manager", "Reveal in file manager" |
| E11 | file-search delta: shortcuts | decision table | L1 | automated | view {closed, open Filenames, open Contents} × key {Cmd-P, Cmd-Shift-F} × `hasFileSearch` {true,false} | keydown | true: opens in the key's mode / closes on the same mode / switches on the other; false: no Search view and `event.defaultPrevented === false` |
| E12 | file-search delta: rail visibility | state | L1 | automated | persisted `treeVisible` false, Search open via Cmd-P | Escape in rail; rail Files tab; pane Files toggle; chip reveal then Escape | collapsed + key unchanged; visible + key `true`; hidden + key `false`; visible Files view + key `true` |
| E13 | chrome: breadcrumb expand-only | state | L1 | automated | `treeOpenRoots` = [`Projektek`, `Projektek/Other`], Search view open, rail collapsed | click `BOSCH` segment of `Projektek › BOSCH › memo.pdf` | roots ⊇ [`Projektek`, `Projektek/Other`, `Projektek/BOSCH`]; `railView` files; persisted visible |
| E14 | chrome: context menu items | decision table | L1 | automated | tabs `a,b,c`, active `c` | open the menu on `c`, then on `b` → Close other tabs | on `c`: "Close tabs to the right" disabled; on `b`: only `b` remains, active, no dialog |
| E15 | chrome: copy items | EP | L1 | automated | cwd `/u/proj`, tab `Projektek/BOSCH/memo.pdf` | Copy full / relative / file name | clipboard `/u/proj/Projektek/BOSCH/memo.pdf`, `Projektek/BOSCH/memo.pdf`, `memo.pdf`; ✓ confirmation shown |
| E16 | chrome: empty pane bar | EP | L1 | automated | one tab open | close it | Files, `new-tab-menu-toggle`, `editor-pane-close` present; `tab-search-toggle` disabled; no `doc-bar` |
| E17 | chrome + folder delta: New tab menu | decision table | L1 | automated | provider {session, folder} | open `+` menu | session: Terminal, Live preview, Open file…; folder: Terminal, Live preview only |
| E18 | chrome: popover footer anchor | EP | L1 | automated | tabs `a,b,c`, active `a`, highlighted row `c`, empty query | "Close all but the active tab" | only `a` remains |
| E19 | chrome: Files toggle name + state | EP | L1 | automated | rail collapsed; then Search view open | render | accessible name starts with "Files"; `aria-pressed` false, then true |
| E20 | chrome: i18n completeness | EP | L1 | automated | new keys (Search tabs, New tab, Close other tabs, Close tabs to the right, Close all tabs, Close N matching tabs, Close all but the active tab, three Reveal labels, Open in default app, Show in file tree, Copy file name, Copy relative path, No open tab matches, bulk-confirm strings) | i18n completeness test | each key present in default, `hu`, `zh-CN` |
| E22 | monaco delta: close/unsplit in pane bar | state | L1 | automated | split open with 3 tabs | click `editor-pane-close` | split mode `closed`; the 3 tabs remain in persisted state |
| E23 | monaco + folder deltas: Reload in doc bar | EP | L1 | automated | {session pane, folder pane} with `foo.ts` open; file content changed on disk | click Reload in `doc-bar` | a fresh `GET /api/file?…path=foo.ts` is issued and the viewer shows the new content, tab not reopened; folder pane shows no changed-on-disk banner |
| E24 | split-workspace + terminal deltas: create from menu | EP | L1 | automated | pane cwd `/home/u/proj` | `+` → Terminal (`new-terminal-launch`) | terminal-create called with cwd `/home/u/proj`; its `term:<id>` tab active |
| E25 | terminal delta: single close stays silent | decision table | L1 | automated | active `term:t1` | ×; middle-click; Cmd-W; context-menu Close | each kills `t1` with no dialog; an adjacent tab becomes active |
| E21 | chrome: mode switcher in doc bar | regression | L1 | automated | enabled claim `.pdf` "Edit in PdfCraft"; files `memo.pdf` in cwd and outside cwd | render | switcher inside `doc-bar` (no separate row); outside cwd shows `file-mode-unavailable` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | chrome: bulk confirm outcomes | state-transition | L1 | automated | tabs `a.ts`, `term:t1`, `memo.pdf` dirty | Close all → Cancel / Close all but these 2 / Close all & discard | Cancel: no change; but-these: `a.ts` closed, `onKillTerminal` not called, instance kept; discard: `onKillTerminal("t1")` ×1, `store.discard` ×1, exactly one `closeTabs` dispatch, zero `closeByPath` |
| F2 | chrome: recompute on confirm | state-transition | L1 | automated | confirm lists only `term:t1`; `x.docx` handler then reports `dirty=true` | click Close all & discard | no tab closed, no kill or discard called; dialog re-renders listing `t1` and `x.docx` |
| F3 | chrome: tab opened during the confirm | state-transition | L1 | automated | confirm open for Close all over `[a,b,term:t1]` | agent background-opens `c.ts`, then discard | `a`, `b`, `t1` closed; `c.ts` remains |
| F4 | chrome: Escape layering | state-transition | L1 | automated | Search tabs popover open, query matches `term:t1` | Close 1 matching tab → Escape | popover closed before the dialog opened; after Escape the dialog is gone and every tab remains |
| F5 | chrome: Cmd-W inert | state-transition | L1 | automated | {confirm open, Search popover open, context menu open, none} | Cmd-W | no tab closed in the first three; active tab closed in the last |
| F6 | chrome: Cancel focus | state | L1 | automated | bulk confirm opens | mount | `document.activeElement` is the Cancel button, not the dialog's ✕ |
| F7 | chrome: menu keyboard model | state-transition | L1 | automated | context menu on the last tab (Close tabs to the right disabled) | ↓ ×5, Home, End, Escape | focus wraps and skips the disabled item; Home/End reach the first/last enabled item; Escape refocuses the tab |
| F8 | chrome: combobox + Delete | state-transition | L1 | automated | popover, empty query, 3 tabs | ↓ then Delete; then type `a` and press Delete | `aria-activedescendant` follows; the selected tab closes via single close and the list keeps focus; with text in the field Delete edits the text only |
| F9 | file-search delta: Escape scope | state-transition | L1 | automated | Search view open, a result opened, focus in the viewer | Escape; then focus the rail, Escape | first: Search stays open; second: closes, focus on the active viewer |
| F10 | file-search delta: session switch | state | L1 | automated | Search open in Contents mode with query `foo` | `sessionId` changes | Files view; query empty; mode back to default |
| F11 | chrome: live title line | state | L1 | automated | active `term:t1` titled `zsh`; plugin tab with label claim | rename to `build`; plugin label updates | tab and title line both show `build`; plugin label text appears in both |
| F12 | chrome: overflow keeps controls | layout | L3 | automated | 10 file tabs, pane about 700 px wide | load the pane | tablist `scrollWidth > clientWidth`; `new-tab-menu-toggle`, `tab-search-toggle`, `editor-pane-close` inside the pane box and visible |
| F13 | chrome: target sizes | layout | L3 | automated | file tab active; `+`, `⋯`, context menu, Search tabs popover open in turn | measure | every button / menuitem / option box ≥ 24 × 24 CSS px; tab × visible on keyboard focus |
| F14 | chrome: narrow fold in a real browser | layout | L3 | automated | file tab; drag the split until the editor pane is < 640 px, then > 640 px | measure | breadcrumb shows `… ›` when narrow; full ancestor segments when wide; Files label visible both times |
| F15 | chrome + terminal delta: bulk close keeps a terminal | e2e flow | L3 | automated | 2 files + 1 terminal (`terminal-tab.spec.ts` setup) | Close all tabs → Close all but these 1 | `bulk-close-confirm` lists the terminal; afterwards only the terminal tab remains and its xterm accepts input |
| F16 | file-search delta: search beside the document | e2e flow | L3 | automated | rail collapsed (default), file open | Cmd/Ctrl-Shift-F, type ≥3 chars, Escape in the field | rail shows Search results; viewer box unchanged in height and not overlapped; after Escape the rail collapses again |
| F17 | chrome: Search tabs filter | e2e flow | L3 | automated | 4 harness files open | `tab-search-toggle`, type a basename fragment matching 2, Enter | listbox shows 2 options; Enter activates the first; popover closed |
| F18 | regression: moved ids | regression | L3 | automated | Playwright specs `terminal-tab`, `terminal-cap`, `live-server-downloads`, `editor-pane-file-handler`, `split-divider-drag`, `directory-home`, `lazy-feature-bootstrap`, `trust-mode-pair` | run after the selector update | all pass |
| F19 | visual parity with the board | visual/subjective | — | manual-only | pane chrome in base dark, base light, Nord | compare with `mockups/editor-pane-toolbar` B1–B9 | [judgment: grouping, spacing and hierarchy read as on the approved board] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | system-open delta | fault-injection (abort) | L1 | automated | `/api/health` fetch rejects | render file tab | Open/Reveal hidden (`systemOpen` false); no throw |
| X2 | system-open delta | fault-injection (bad data) | L1 | automated | `/api/health` returns `platform: 42`, `systemOpen: true` | render | Reveal labelled "Reveal in file manager" |
| X3 | chrome: copy fallback | fault-injection (abort) | L1 | automated | `navigator.clipboard` undefined | Copy relative path | the shipped copy-popup fallback runs (same observable as the tree popup test); no throw |
| X4 | chrome: evicted instance | fault-injection (state race) | L1 | automated | instance for `memo.pdf` evicted (`getInstance` undefined) after the dialog was listed | Close all & discard | no throw; `memo.pdf` tab closes; `store.discard` not called for a missing key |
| X5 | chrome: plugin label throws | fault-injection (abort) | L1 | automated | plugin label component throws on render | activate the plugin tab | error boundary contains it in the document bar; the tab strip label and the rest of the pane render |
| X6 | chrome + folder delta: no fall-through | EP | L1 | automated | folder provider (`hasFileSearch=false`), query `zzz` | Enter in Search tabs | "No open tab matches" shown; popover stays; no Search view |
| X7 | system-open delta: real reveal | hardware/OS | — | manual-only | desktop macOS Electron app | Reveal in Finder on a file tab | [judgment: Finder opens with the file selected] |

---

## Coverage summary

- Requirements covered: 21/21:
  - `editor-pane-chrome`: 10;
  - `editor-file-search`: 2;
  - `internal-monaco-editor-pane`: 4;
  - `editor-pane-file-handlers`: 1;
  - `folder-scoped-editor-pane`: 2;
  - `split-editor-workspace`: 1;
  - `terminal-viewer-tab`: 1.
- Scenarios by class: edge 25 · perf 0 · frontend 19 · error 7.
- Scenarios by level: L1 42 · L2 0 · L3 7 · manual 2.
- Scenarios by disposition: automated 49 · manual-only 2.

## New infra needed

- None. The L3 rows use the existing docker harness, and the L1 rows use the existing jsdom vitest setup. `ResizeObserver` is mocked per test.
