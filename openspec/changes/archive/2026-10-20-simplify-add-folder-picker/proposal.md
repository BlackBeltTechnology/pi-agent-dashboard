# Proposal

## Why

Users open the folder they want in "Add folders" and then can't add it. The current dialog makes clicking a row navigate, makes the tiny checkbox select, adds a trailing chevron, a "current folder" self-row, a `CONTENTS` eyebrow and a pill basket, so adding a folder means learning a custom grammar. Every file manager and OS folder chooser (Finder, Explorer, Nautilus/GTK, iOS/Android Files) uses the same model instead: navigate in, press the button; click selects, double-click opens. Users already know that model.

## What Changes

- **Reuse the existing `PathPicker` / `AddFoldersDialog`.** The path input, the folder list, the `..` row, the git/pi/session badges, New folder, the workspace destination, the pi-trust choice and Cancel stay. There is no new component.
- **Remove** the per-row checkboxes, the trailing descend chevrons, the current-directory self-row, the `CONTENTS` label and the removable-pill selection basket. **BREAKING** for the `multi-select-folder-picker` spec and for the test ids `path-picker-check-*`, `path-picker-open-*`, `path-picker-self`, `path-picker-contents-label` and `add-folders-pill-*` / `add-folders-basket*`.
- **File-manager pointer grammar, per platform:**
  - **Mouse or trackpad:** click selects one row, and double-click opens it. The add-to-selection modifier is ⌘ on macOS and Ctrl on Windows/Linux; modifier-click toggles a row. Shift-click selects a range. Clicking empty list space clears the selection.
  - **Touch (coarse pointer):** tap opens a folder. Long-press enters select mode, where taps toggle rows. Rows are at least 44 px tall.
  - **Keyboard:** ↑/↓ move the selection; Shift+↑/↓ extend it; Enter opens; the go-up keys follow each platform (⌘↑ on macOS, Alt+↑ or Backspace on Windows/Linux); Esc clears the selection, then closes; the add-to-selection modifier + A selects all. Typing a path in the input and pressing Enter still navigates, as today.
- **The primary action always targets something.** With nothing selected it adds the **folder currently browsed** (`Add "<leaf>"`); with N folders selected it adds those (`Add "<leaf>"` / `Add N folders`). A status line names the exact target path.
- **The selection is scoped to the browsed folder.** Opening another folder clears it, as file managers do.
- **Already-added folders** render an `added` marker, are skipped on commit, and the primary action disables when every target is already added. `AddFoldersDialog` gains a pinned-paths input; `App.tsx` already holds `pinnedDirectories`; `SessionList.tsx` has the optional prop but does not yet pass it to the dialog.
- Commit semantics are unchanged: pin every target first, then add it to the chosen workspace; pin stays implicit, and the pi-trust choice passes through.
- Mockup: `openspec/changes/archive/2026-10-20-simplify-add-folder-picker/mockups/simple-folder-picker/index.html` (UI review comparison: `ui-review.html` in the same folder)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `multi-select-folder-picker`: replaces the checkbox, chevron, self-row and basket grammar with file-manager click semantics (click selects, platform modifier multi-selects, Shift ranges, double-click/tap opens, long-press on touch); the commit targets the current folder when nothing is selected; the selection clears on navigation; already-added folders are marked and skipped; the self-row and `CONTENTS` label requirements are removed.
- `filesystem-browser`: the `PathPicker component` requirement's multi-select bullet drops "per-row checkboxes" and "activating a row navigates" in favour of the file-manager gestures; single-select is unchanged.

## Impact

- `packages/client/src/components/primitives/PathPicker.tsx`: multi-select mode reworked (row pointer and keyboard handling, removal of the checkbox, chevron and self-row branches). Single-select callers (`PinDirectoryDialog`, `PathPickerDialog`, and `KbSourceAdd` through `PathPickerDialog`) keep today's behaviour.
- `packages/client/src/components/workspace/AddFoldersDialog.tsx`: the basket is removed; a status line, the current-folder fallback target, the `pinnedPaths` prop and skip-on-commit are added.
- `packages/client/src/App.tsx` and `packages/client/src/components/session/SessionList.tsx`: pass `pinnedDirectories` to the dialog.
- i18n keys: new keys for the status line and click hints; the basket and self-row strings are unused.
- Tests: `packages/client/src/components/__tests__/PathPicker.test.tsx` and `AddFoldersDialog.test.tsx` are rewritten for the new grammar, and the `PathPicker.test.tsx` entry in `packages/client/src/__tests__/fixed-tick-conversion-equivalence.test.ts` is updated. The e2e helper `tests/e2e/helpers/index.ts` `pinDirectory()` currently clicks `path-picker-check-<path>` and is called from about 30 spec and helper files, so it must move to a pointer-independent gesture.
- No server, protocol or shared-type change.

## Discipline Skills

- `review-code`: a non-trivial client change, run before commit.
- `doubt-driven-review`: removes spec'd behaviour and widely-used e2e test ids (an irreversible contract change for the specs and helpers that depend on them).
- No auth, untrusted-input, secrets, performance-budget, new-endpoint or observability triggers apply.
