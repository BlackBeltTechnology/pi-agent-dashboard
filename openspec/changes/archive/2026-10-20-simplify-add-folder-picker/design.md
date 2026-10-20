# Design

## Context

See proposal.md (Why). Current state, cited:

- `PathPicker` multi-select mode is opt-in through the `selection?: { selected; onToggle }` prop (`packages/client/src/components/primitives/PathPicker.tsx:39-44`). Absent = single-select. Direct `<PathPicker>` callers: `PinDirectoryDialog`, `PathPickerDialog`, `AddFoldersDialog`. `KbSourceAdd` (`packages/kb-plugin/src/client/KbSourceAdd.tsx`) reaches it indirectly through `PathPickerDialog`.
- Row activation in multi-select calls `handleItemClick`, which runs `descendInto` for entries and the toggle for the self-row (`PathPicker.tsx:338-352`). Checkbox and chevron are rendered per row (`PathPicker.tsx:661-722`). The self-row and `CONTENTS` label are built into `displayItems` (`PathPicker.tsx:283-289`, `567-621`).
- Keyboard: Space toggles, Enter descends in multi-select, Tab always `preventDefault`s and acts on the highlight (`PathPicker.tsx:409-469`, Tab at `:416-423`). Escape calls `onCancel()` unconditionally (`:462-465`). All keys are handled on the path input; the listbox has no `tabIndex` and no `aria-activedescendant` (`:520-525`). Highlight is a separate `highlightIndex` state from the caller's `selection`.
- Navigation paths: `descendInto` (`:307`) covers row open and `..`, but typed paths go `handleInputChange` → `scheduleFetch` → `fetchDir` (`:298-305`, `:143-209`) and the mount fetch calls `fetchDir(undefined)` directly (`:237-248`). Only `fetchDir`'s success branch (`fetchedDirRef.current = result.current`, `:162`) sees every directory change.
- Row height is a JS constant `rowHeight = 32` driving the list height (`:501-502`); the `(pointer: coarse)` CSS breakpoint does not change it.
- `AddFoldersDialog` owns the basket as `selected: string[]` and normalizes each toggle with `normalizePath` (`packages/client/src/components/workspace/AddFoldersDialog.tsx:86`, `116-121`). It commits pins first, then workspace adds (`AddFoldersDialog.tsx:123-131`), and renders the pills (`AddFoldersDialog.tsx:178-212`).
- Call sites: `packages/client/src/App.tsx:2876` (dashboard scope; has `pinnedDirectories` state at `App.tsx:833`) and `packages/client/src/components/session/SessionList.tsx:3167` (workspace scope; has the `pinnedDirectories` prop at `SessionList.tsx:203`).
- Session badges join by `pathKey(path, inferPlatform([path]))` (`AddFoldersDialog.tsx:106-114`, `PathPicker.tsx:600`, `685`).
- `AddFoldersDialog` applies the `piTrust` choice (`usePiTrustChoice("pinned")`, `AddFoldersDialog.tsx:86`) to every commit target (`:126-128`).
- Tests coupled to the removed UI: `PathPicker.test.tsx` multi-select block (`:878`), checkbox and self-row tests (`:919-971`, `:1023-1045`); `AddFoldersDialog.test.tsx` self-row describe (`:190`); the fixed-tick census pins `PathPicker.test.tsx` test names (`packages/client/src/__tests__/fixed-tick-conversion-equivalence.test.ts:87`).
- Browser-OS detection exists as `browserPlatformFallback()` in `packages/client/src/hooks/useHostPlatform.ts:33`. Note that `useHostPlatform` returns the **server** OS, which is the wrong signal for keyboard modifiers.
- The e2e helper `pinDirectory()` (`tests/e2e/helpers/index.ts:220-256`) types the full path, then clicks `path-picker-check-<absPath>` and the commit button. About 30 spec and helper files call it.

## Goals / Non-Goals

**Goals:** keep `PathPicker`'s structure and the single-select path byte-for-byte; put the selection model inside the picker, so pointer and keyboard grammar live next to the rows; keep `AddFoldersDialog`'s commit order and its pi-trust and workspace logic.

**Non-Goals:** a native OS dialog (the server's filesystem is often not the browser's); a sidebar of Places or Recents; breadcrumbs (the path input remains the address bar); changing single-select callers; cross-folder selection.

## Decisions

### D1: The picker owns the selection; it reports targets upward

Replace `selection: { selected: Set; onToggle }` with `selection: { onChange(paths: string[]) }`, plus an optional `pinnedKeys?: Set<string>` for the `added` marker. The picker keeps `selected: string[]` and `anchor: string | null` internally. It clears both in `fetchDir`'s success branch whenever `result.current` differs from the previous `fetchedDirRef.current`. That branch is the only place every navigation lands (row open, `..`, typed path, mount, create-folder); `descendInto` is NOT a funnel, because typed paths and the mount fetch bypass it. Signature: `onChange({ selected: string[]; current: string | null })`. `onChange` fires after every successful fetch that changes `current` and after every selection change, so the dialog's `current` is never older than the listing on screen.

*Why over keeping the caller-owned Set:* range selection needs the picker's ordered `entries`, and clear-on-navigate needs the fetch success branch. Both live in the picker. A caller-owned set would need both pushed back down.

*Alternative:* add `onNavigate` and keep the caller-owned set. Rejected because it splits one state machine across two components.

### D1a: Selection edge rules

Shift-click with no anchor in the browsed folder acts as a plain click and sets the anchor (Finder/Explorer). The modifier + A selects every listed child row, including already-added ones; those are dropped from `fresh` at commit and from the label count (`Add N folders`, or `Add "<leaf>"` when exactly one new target remains).

### D2: Selection and highlight merge

In multi-select mode the selected rows ARE the keyboard cursor: ↑/↓ replace the selection with the next or previous row, and Shift extends it. `highlightIndex` stays for single-select only. This removes the "highlighted but not selected" state that file managers do not have.

### D3: Pointer grammar from `PointerEvent.pointerType`, not a media query

Branch on the event's `pointerType === "touch"`, not on `matchMedia("(pointer: coarse)")`. `click` and `dblclick` carry no reliable pointer type, so `pointerdown` stores it in a ref (`lastPointerTypeRef`) that the `click` handler reads. Hybrid devices (touchscreen laptops, iPad with trackpad) then get the right grammar per gesture. Layout (44 px rows) follows `(pointer: coarse)`: the CSS breakpoint (`packages/client/src/index.css:1245`) sets the row height, and `rowHeight` (`PathPicker.tsx:501`) becomes 44 when `matchMedia("(pointer: coarse)").matches`, so the list height stays `rows × rowHeight`.

- **Fine:** `onClick` handles select, modifier-toggle and Shift-range; `onDoubleClick` opens. A click on the list container background clears the selection.
- **Touch:** `pointerdown` starts a 400 ms timer, cancelled on `pointermove` beyond 10 px, `pointerup` or `pointercancel`. When it fires, it enters select mode and selects the row. The next `click` after a fired long-press is swallowed once (a `suppressNextClickRef` flag, reset on the following `pointerdown`), which covers both Chromium (fires `click` after `contextmenu`) and iOS Safari (does not). In select mode a tap toggles; otherwise a tap opens. `contextmenu` is prevented on rows while touch is active, which stops the iOS/Android callout.

*Alternative:* treat every click as "open" on coarse-pointer media. Rejected because it breaks touchscreen laptops used with a mouse.

### D4: Modifier key from the browser OS

The modifier is `isMacLike ? e.metaKey : e.ctrlKey`, where `isMacLike = browserPlatformFallback() === "darwin"` or iPadOS (`navigator.maxTouchPoints > 1 && /Mac/.test(platform)`). This is the browser OS, never the host OS: a Windows user on a macOS-hosted dashboard presses Ctrl. Extract it as a tiny pure helper `isAddToSelectionModifier(e, platform)` so it is unit-testable without a DOM. `browserIsMacLike()` lives beside `browserPlatformFallback` in `packages/client/src/hooks/useHostPlatform.ts` (which already reads `navigator.userAgentData`/`navigator.platform`); `PathPicker.tsx` only imports it. This keeps the `platform-paths` rule "Client does not branch on navigator or process.platform" true: `PathPicker.tsx` never names `navigator.platform`. That rule is about path semantics; modifier keys are input semantics and must come from the browser, not the server OS it recommends. macOS must not accept Ctrl, because Ctrl-click there is the secondary click.

### D5: Selection-only updates must not remount rows

Row elements are keyed by `entry.name` (already the case at `PathPicker.tsx:653`). Selection changes only flip `aria-selected` and class names. Nothing may change the row key or wrap rows conditionally on selection, because a remount between the two clicks suppresses `dblclick`. The mock hit exactly this. A regression test asserts that `dblclick` after `click` navigates.

### D6: The dialog computes targets; skip-already-added there

`AddFoldersDialog` gets `pinnedPaths?: string[]` and builds `pinnedKeys` with `pathKey` (the same join as the session badges). It computes `targets = selected.length ? selected : current ? [current] : []`, then `fresh = targets.filter(t => !pinnedKeys.has(key(t)))`. Commit iterates over `fresh` in the existing pin-then-workspace order. It normalizes with the existing `normalizePath(raw.trim(), inferPlatform([raw]))`, which strips the trailing separator that `withTrailingSep` adds to the browsed path.

### D7: Space and Tab in multi-select

Space no longer toggles, since there are no checkboxes. Space remains a literal character in the path input, matching single-select. In multi-select Tab is NOT `preventDefault`ed, so focus moves on to the dialog controls. Single-select Tab-completion is untouched.

### D8: Keyboard focus model and Escape

All keys stay on the path input, which already owns them. The input gets `aria-controls` + `aria-activedescendant` pointing at the anchor row, and the listbox gets `aria-multiselectable="true"`. Keys that would conflict with editing text act on the list only when the input text equals the browsed directory path (no pending edit): Backspace goes up, and the modifier + A selects all. Otherwise they edit text as today. A visually hidden `aria-live="polite"` region announces "N selected" on selection change.

Escape with a non-empty selection calls `preventDefault()` + `stopPropagation()` and clears the selection, so the `Dialog` escape layer (`packages/client-utils/src/escape-stack.ts:73`) does not close the dialog. Escape with no selection keeps today's `onCancel()`.

### D9: Fallback target and pi trust

When nothing is selected the target is the browsed directory, which on open is the server default (usually HOME). The status line always shows that full path, and the `piTrust` checkbox applies to the fallback exactly as to a selection. HOME itself is never a valid fallback. "Home" is the `current` returned by the picker's first browse with no path (the server's default is `os.homedir()`); the picker records it as `homeRef` and reports `isHome` in `onChange`, with no server change. When `current` equals it (by `pathKey`) and nothing is selected, the primary action is disabled with a "Select or open a folder" hint. This blocks the one-click HOME pin with trust.

## Risks / Trade-offs

- [Users of the old checkbox flow lose cross-folder baskets] → This is accepted as the file-manager norm (user decision). Workaround: add in two passes.
- [The double-click target is hard for motor-impaired users] → Enter opens the selected row, and the path input plus Enter navigates. The `..` row opens on single click.
- [A long-press conflicts with text selection or scroll on touch] → `user-select: none` on rows; movement beyond 10 px cancels; `touch-action: pan-y` keeps scrolling.
- [~30 e2e spec and helper files break through `pinDirectory()`] → Update the helper once and make it pointer-independent: type the full path with a trailing separator to browse into the folder, then commit with nothing selected. This behaves the same on fine and touch projects (no row click, so no tap-opens surprise), and the helper asserts the status line shows the requested path before committing.
- [Existing unit tests and the fixed-tick census pin removed behaviour] → Rewrite the multi-select blocks in `PathPicker.test.tsx` and `AddFoldersDialog.test.tsx`, then update the `PathPicker.test.tsx` entry in `fixed-tick-conversion-equivalence.test.ts`.
- [Base spec `filesystem-browser` still describes per-row checkboxes] → The delta MODIFIES its `PathPicker component` requirement so the archived specs do not contradict.
- [Accidental add of the browsed parent when clicking Add with nothing selected] → The status line always shows the exact target path, and the primary label names the leaf.

## Migration Plan

Client-only, with no persisted state. It ships as one PR; rollback is a revert. Archive note: the `multi-select-folder-picker` spec's self-row and `CONTENTS` requirements are removed by the delta.
