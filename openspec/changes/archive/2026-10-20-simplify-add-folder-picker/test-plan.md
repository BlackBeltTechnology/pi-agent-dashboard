# Test Plan — simplify-add-folder-picker

Stage: design   Generated: 2026-10-20

Hard gate cleared 2026-10-20. Answers:
- Home = the `current` from the picker's first browse with no path; no server change (design D9).
- Shift-click with no anchor = plain click that sets the anchor (D1a).
- Multi-target label = `Add N folders`; single = `Add "<leaf>"` (straight quotes).
- The modifier + A selects all rows, added ones included; those are skipped at commit and left out of the count (D1a).

Levels: **L1** = vitest + RTL in `packages/client/src/**/__tests__/` (jsdom); **L3** = Playwright `tests/e2e/*.spec.ts` against the docker harness (port from `.pi-test-harness.json`, never hard-coded). Fixture tree for L1: mocked `/api/browse` returning `/home/user/` → `a b c d work notes music projects` (`work` pinned where stated).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Modifier follows browser OS | decision-table | L1 | automated | `isAddToSelectionModifier(e, platform)` over platform ∈ {darwin, ipados, win32, linux} × {metaKey, ctrlKey, both, none} | call helper | `true` only for darwin/ipados+meta and win32/linux+ctrl; darwin+ctrl → `false` (16-cell table) |
| E2 | Modifier follows browser OS | EP | L1 | automated | `browserIsMacLike()` with `navigator.platform` = `MacIntel` + `maxTouchPoints` 0 / 5, `Win32`, `Linux x86_64` | call helper | `true`, `true` (iPadOS), `false`, `false` |
| E3 | Gestures: range | BVA | L1 | automated | `applyRowClick` ordered `[a,b,c,d]`, anchor `a` | shift on `c`; shift on `a` (anchor itself); shift on `d` (last) | `[a,b,c]`; `[a]`; `[a,b,c,d]`; anchor stays `a` in all three |
| E4 | Gestures: range | BVA | L1 | automated | ordered `[a,b,c,d]`, anchor `c` | shift on `a` (reverse) | `[a,b,c]`, document order preserved |
| E5 | Shift without anchor | state-transition | L1 | automated | ordered `[a,b,c]`, anchor `null`, selected `[]` | shift on `b` | selected `[b]`, anchor `b` |
| E6 | Gestures: toggle | state-transition | L1 | automated | selected `[work]`, anchor `work` | mod on `notes`, then mod on `work` | `[work,notes]` → `[notes]`; anchor = last mod-clicked row |
| E7 | Gestures: plain click replaces | EP | L1 | automated | selected `[work,notes]` | plain click `music` | selected `[music]`, anchor `music` |
| E8 | Commit targets | decision-table | L1 | automated | AddFoldersDialog with (selected ∈ {∅, [work], [work,notes]}) × (`work` pinned ∈ {no, yes}) × (current is home ∈ {no, yes}) | read label + commit | ∅/not-home → `Add "<leaf of current>"`, pins current; ∅/home → disabled, pins nothing; [work]/pinned → disabled "Already added"; [work,notes]/work pinned → `Add "notes"`, pins only notes; [work,notes]/none pinned → `Add 2 folders`, pins both |
| E9 | Windows paths native | EP | L1 | automated | browse returns `current: "C:\\Users\\me\\"`, nothing selected | commit | `onPin` called once with `C:\Users\me` (no trailing `\`) |
| E10 | Already-added marker | EP | L1 | automated | `pinnedPaths: ["/home/user/work/"]` (trailing sep) and `["C:\\Users\\ME\\Work"]` vs browsed `c:\users\me\` listing `work` | render | `work` row shows `added` in both cases (pathKey drift collapses) |
| E11 | Select-all incl. added | EP | L1 | automated | `/home/user` lists `work` (pinned), `notes`, `music`; input text `/home/user/` | mod + A | 3 rows `aria-selected=true`; label `Add 2 folders`; commit pins `notes`, `music` only |
| E12 | Shared keys gated on input | decision-table | L1 | automated | input text ∈ {`/home/user/` (= current), `/home/user/wo` (pending edit)} × key ∈ {Backspace, mod+A} | keydown on input | equal: Backspace browses `/home/user`'s parent, mod+A selects all; pending: input becomes `/home/user/w` / text selected, browsed dir and selection unchanged |
| E13 | Home rule | state-transition | L1 | automated | open with no `initialPath` → first browse `current: /home/user/`; then open `work`; then `..` | read primary state after each | disabled → `Add "work"` → disabled again (home recognised by pathKey, not first-render only) |
| E14 | Home rule with initialPath | EP | L1 | automated | open with `initialPath="/home/user/work"` (first browse is not home) | read primary | `Add "work"` enabled; navigating `..` to `/home/user` stays enabled (home is learned only from a no-path browse) [verifies D9 definition literally] |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Single click selects | state-transition | L1 | automated | browsing `/home/user` | `click` on `work` row | `work` `aria-selected=true`, others false; fetch not re-called; `onSelect` not called |
| F2 | Double click opens | state-transition | L1 | automated | browsing `/home/user` | `click` then `dblClick` on `work` | browse called with `/home/user/work/`; dialog still mounted |
| F3 | Rows not remounted on select (D5) | invariant | L1 | automated | browsing `/home/user` | capture `work` row node, `click` it | same DOM node identity after click (`toBe`), key unchanged |
| F4 | Double click opens in real browser | state-transition | L3 | automated | harness, dialog open, path typed to a temp parent containing `leaf-a`, `leaf-b` | `page.dblclick` on `leaf-a` row | path input shows `…/leaf-a/`, list shows its children; regression for the mock's remount bug |
| F5 | Click on empty list space clears | state-transition | L1 | automated | `work` selected, list taller than rows | click the listbox container (target = container) | 0 rows selected; status line shows browsed path |
| F6 | `..` single click goes up | state-transition | L1 | automated | browsing `/home/user/work` | single `click` on `..` | browse called with `/home/user/` |
| F7 | Selection clears on open | state-transition | L1 | automated | `work`,`notes` selected in `/home/user` | dblClick `projects` | after listing renders: 0 selected, `onChange` last call `{selected:[], current:"/home/user/projects/"}` |
| F8 | Selection clears on typed nav | state-transition | L1 | automated | `work` selected in `/home/user` | type `/tmp/`, advance debounce, browse resolves `/tmp/` | 0 selected; commit pins `/tmp`, never `/home/user/work` |
| F9 | Commit targets folder just opened | async convergence | L1 | automated | browsing `/home/user`, nothing selected; browse for `work` resolves after a deferred promise | dblClick `work`, resolve, click primary | `onPin` called with `/home/user/work` exactly once; never `/home/user` |
| F10 | Stale fetch ignored | async convergence | L1 | automated | dblClick `work` (slow, resolves 2nd) then `..` (fast, resolves 1st) | resolve out of order | final `current` = `/home/` (target of the latest request, `..`); selection empty; `work` listing never rendered [existing `fetchDir` seq guard holds] |
| F11 | Touch tap opens | state-transition | L1 | automated | `pointerdown{pointerType:"touch"}` → `pointerup` → `click` on `work` (< 400 ms, fake timers) | — | browse `/home/user/work/`; nothing selected |
| F12 | Long-press enters select mode | BVA | L1 | automated | touch `pointerdown` on `work`, fake timers | advance 399 ms then `pointerup` / separately advance 400 ms then `pointerup` + `click` | 399: opens on click (tap); 400: `work` selected, the trailing `click` swallowed, browsed dir unchanged |
| F13 | Long-press cancelled by move | BVA | L1 | automated | touch `pointerdown` at (0,0) | `pointermove` to (0,10) then 400 ms / to (0,11) then 400 ms | 10 px: still selects; 11 px: no selection (timer cancelled) |
| F14 | Select mode tap toggles, exit on empty | state-transition | L1 | automated | select mode with `[work]` | touch tap `notes`, tap `notes`, tap `work` | `[work,notes]` → `[work]` → `[]` and select mode off; next tap on `notes` opens it |
| F15 | Hybrid pointer per gesture | decision-table | L1 | automated | same row; `pointerdown` pointerType sequence `touch` then `mouse` | tap; then mouse single click | tap opens; mouse click selects (grammar follows last `pointerdown`, not media query) |
| F16 | Row contextmenu suppressed on touch | EP | L1 | automated | touch `pointerdown` on row | dispatch `contextmenu` | `defaultPrevented === true`; for mouse pointerType `defaultPrevented === false` |
| F17 | Touch rows ≥ 44 px | BVA | L3 | automated | Playwright context `hasTouch: true`, `isMobile: true`, viewport 390×844 | open dialog | every `role=option` row `boundingBox().height >= 44`; listbox height = rows × 44 |
| F18 | Touch flow end-to-end | state-transition | L3 | automated | same touch context, temp parent with `leaf-a`, `leaf-b` | `tap` `leaf-a` → list shows its children; `..`; long-press `leaf-a` (touchscreen down, wait 500 ms, up), tap `leaf-b`, commit | label `Add 2 folders`; both pinned in sidebar |
| F19 | Escape clears then closes | state-transition | L1 | automated | `work`,`notes` selected, dialog inside `Dialog` with escape stack | Escape, Escape | 1st: 0 selected, dialog open, `onCancel` not called; 2nd: `onCancel` called once |
| F20 | Tab leaves input | EP | L1 | automated | focus in path input, multi-select mode | `userEvent.tab()` | `document.activeElement` is the next dialog control (not input); single-select picker: Tab still completes (existing test stays green) |
| F21 | Keyboard arrows + Enter + go-up | state-transition | L1 | automated | `/home/user`, nothing selected, platform darwin then win32 | ArrowDown, ArrowDown, Shift+ArrowDown, ArrowUp, Enter; then ⌘↑ (darwin) / Alt↑ (win32); then ⌘↓ (darwin) | selection `[a]` → `[b]` → `[b,c]` → `[b]`; Enter opens `b`; go-up returns to `/home/user`; ⌘↓ opens; Alt↑ on darwin and ⌘↑ on win32 do nothing |
| F22 | Space no longer toggles | EP | L1 | automated | `work` selected, input text = current | Space | input gains a space char; selection unchanged |
| F23 | a11y attributes | EP | L1 | automated | multi-select render, `work` anchor | inspect | listbox `aria-multiselectable="true"`; input `aria-controls` = listbox id, `aria-activedescendant` = `work` row id; no `input[type=checkbox]` and no chevron button in any row |
| F24 | Live region announces count | state-transition | L1 | automated | nothing selected | mod-click `work`, mod-click `notes`, Escape | `aria-live="polite"` region text: `1 selected` → `2 selected` → empty/`0 selected` |
| F25 | Status line | EP | L1 | automated | `/home/user/projects` no selection; then `work`,`notes` selected | render | 1st: status shows `~/projects` or full path; 2nd: shows `work, notes` + Clear control; clicking Clear → 0 selected |
| F26 | No basket / pin control | EP | L1 | automated | any selection | render | no `add-folders-pill-*`, no `add-folders-basket*`, no "Pin to dashboard" control |
| F27 | Single-select callers unchanged | regression | L1 | automated | existing `PinDirectoryDialog.test.tsx`, `PathPickerDialog.test.tsx`, kb-plugin `KbSourcesSearch.test.tsx` | run suites unmodified | all pass with zero edits to those files |
| F28 | filesystem-browser: multi-select activation | state-transition | L1 | automated | multi-select picker with `onSelect` spy | dblClick row; Enter with row selected | browses in both cases; `onSelect` never called |
| F29 | Real macOS ⌘-click / Windows Ctrl-click | visual/hardware | — | manual-only | built dashboard on a Mac (Safari + Chrome) and a Windows PC (Edge) | ⌘-click / Ctrl-click two rows; Ctrl-click on Mac | toggles as spec'd; Mac Ctrl-click shows the context menu, no toggle [judgment: real OS modifier routing] |
| F30 | Real touch devices | hardware | — | manual-only | iPhone Safari, Android Chrome, touchscreen Windows laptop with mouse | tap / long-press / mouse click | tap opens, long-press selects with no OS callout, scroll does not start a long-press, mouse still single-click-selects [judgment: device gesture feel] |
| F31 | Screen reader pass | a11y/subjective | — | manual-only | VoiceOver (macOS) and NVDA (Windows) | arrow through rows, mod-select two | anchor row and "N selected" announced intelligibly [judgment: speech output] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Selection scoped / commit safety | fault-injection (abort) | L1 | automated | browse for `work` rejects (500) after `work`,`notes` were selected in `/home/user` | dblClick `work` | existing error copy shown; `current` stays `/home/user/`; selection preserved (no successful navigation happened); commit pins `work`,`notes` |
| X2 | Network-guard denial unchanged | fault-injection (abort) | L1 | automated | browse returns 403 `network_not_allowed` with hint | open dialog | hint + Settings → Servers affordance render; primary disabled (no `current`) |
| X3 | Commit with empty current | fault-injection | L1 | automated | first browse still pending (current `null`), nothing selected | click primary | disabled; no `onPin` call |

### E2E helper

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E15 | `pinDirectory()` pointer-independent | regression | L3 | automated | rewritten helper, a temp dir path | run `tests/e2e/worktree-init-feedback.spec.ts` + `tests/e2e/folder-accordion.spec.ts` (callers) | both pass; helper asserted status line = requested path before commit; sidebar shows the folder |
| E16 | `pinDirectory()` on touch context | regression | L3 | automated | helper inside a `hasTouch:true, isMobile:true` context | pin a temp dir | the pinned path equals the requested path (not a child, not the parent) |

---

## Coverage summary

- Requirements covered: 12/12 (multi-select-folder-picker: 9 added/modified; filesystem-browser: 1 modified; removed requirements covered by F23/F26)
- Scenarios by class: edge 16 · perf 0 · frontend 31 · error 3
- Scenarios by level: L1 42 · L3 5 · — 3
- Scenarios by disposition: automated 47 · manual-only 3

Performance: none — no latency or size budget in the spec; the listing cap (200 entries) is unchanged.

## New infra needed

- A Playwright touch context (`test.use({ hasTouch: true, isMobile: true, viewport })`) for F17/F18/E16. The repo's `playwright.config.ts` has only a desktop Chromium project; use per-spec `test.use` rather than a new project.
