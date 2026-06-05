# Replace Worktree-dialog "Base branch" `<select>` with a typeahead combobox

## Why

The "Base branch" field in `WorktreeSpawnDialog.tsx` (line ~338) is a native HTML `<select>`:

```tsx
<select data-testid="worktree-base-select" value={base} onChange={…}>
  {allBranches.map((b) => <option key={b} value={b}>{b}</option>)}
</select>
```

`allBranches = [...localBranches, ...remoteBranches]` is a flat array that on real repos easily runs to **50–500 entries**. A native `<select>` is unfilterable, requires scroll-and-scan, and on macOS opens as a single long popup with no keyboard search beyond first-letter jump. The user reported this directly: the field "should be a typeahead box, which can be filtered and typed".

The codebase already ships a typeahead `BranchPicker` component, but its UX is **always-open + own fetch + Cancel button** — designed for `BranchSwitchDialog` where the picker *is* the dialog. The worktree dialog needs a **collapsed combobox** that fits inline among three fields and expands to a popover on focus. Two different UX shapes, same internals.

This change extracts the shared internals (`BranchListbox`) and introduces a `BranchCombobox` for inline use, then migrates the worktree dialog. `BranchPicker` is refactored to wrap the shared listbox, preserving its public API and existing tests.

### Scope check

Codebase audit confirms `WorktreeSpawnDialog.tsx` is the **only** `<select>`-of-branches in the client. The four other `<select>` elements (`ModelSelector` provider filter, `SettingsPanel` API-type, `SpecsBrowserView` spec-jump, `GenericExtensionDialog` generic-form) are unrelated and out of scope.

## What Changes

- **New presentational component** `BranchListbox` in `packages/client/src/components/` — controlled (`branches`, `filter`, `highlightIndex`, `onSelect`, `onHighlightChange`), pure rendering + keyboard semantics. Renders local/remote sections with separator, current-branch marker, remote badge. No fetching. No filter input (caller owns it). ~80 LOC.
- **`BranchPicker` refactored** to delegate rendering and keyboard nav to `BranchListbox`. Keeps its own filter input, fetching, loading/error state, Cancel button. Public props unchanged → `BranchSwitchDialog` and its 12 existing tests untouched.
- **New component** `BranchCombobox` in `packages/client/src/components/` — controlled (`branches: GitBranchEntry[]`, `value: string`, `onChange: (branch: string) => void`, optional `current?: string`, `disabled?: boolean`, `placeholder?: string`, `data-testid?: string`). Collapsed trigger button shows `value`; on click/focus opens a popover containing a filter input + `BranchListbox`. Filter-only — Enter on no match is a no-op (no free-text base allowed). ~120 LOC.
- **`WorktreeSpawnDialog.tsx` migration**:
  - Replace the `<select data-testid="worktree-base-select">` block with `<BranchCombobox data-testid="worktree-base-combobox" branches={…} value={base} onChange={setBase} … />`.
  - Stop flattening to `allBranches: string[]`; pass the full `GitBranchEntry[]` so the combobox can render local-vs-remote distinction and the current-branch marker. The flat `allBranches` `useMemo` and `hasUsableBase` derivation stay (the latter only needs the names).
  - The "no usable default base — pick one" sentinel becomes the combobox's placeholder when `value === ""`.
- **Tests**:
  - **New** `BranchListbox.test.tsx` — presentational tests: renders sections, separator only when both groups present, current marker, keyboard nav callbacks, click selects.
  - **New** `BranchCombobox.test.tsx` — closed-by-default, opens on trigger click, filter narrows the list, Enter selects highlight, no-match Enter is a no-op, Esc closes popover (does not bubble), outside-click closes popover, controlled `value` round-trips.
  - **Update** `WorktreeSpawnDialog.test.tsx` — the two tests using `worktree-base-select` rewritten to drive the combobox (`fireEvent.click` on trigger, `fireEvent.change` on filter input, `fireEvent.click` on option). Assertions on `base` state via the resulting `onSpawn` payload remain unchanged.
  - **Unchanged** `BranchPicker.test.tsx` (12 tests) — confirms refactor preserves public behaviour. Acts as regression net for the `BranchListbox` extraction.

## Capabilities

### Modified Capabilities

- `worktree-spawn-dialog` — adds the typeahead-combobox Requirement on the "Base branch" field. Existing `attachProposal` Requirement is unchanged.

## Impact

- **UX improvement** — base-branch selection becomes filterable. Time-to-pick on a repo with 200 branches drops from "scroll a giant menu" to "type 3 characters + Enter".
- **Code reuse** — `BranchListbox` becomes the single rendering+keyboard source for branch lists. `BranchPicker` thins out. Future branch-pickers plug in for free.
- **No protocol or server change** — purely client-side. `GET /api/git/branches` already returns the `GitBranchEntry[]` the new components need.
- **Test churn** — 2 tests rewritten in `WorktreeSpawnDialog.test.tsx`; 2 new test files; `BranchPicker.test.tsx` unchanged (regression net).
- **`data-testid` rename** — `worktree-base-select` → `worktree-base-combobox`. The old id was misleading after migration (no `<select>` element). Grep confirms the id is referenced only inside `WorktreeSpawnDialog.test.tsx` — no external consumers.
- **Backwards compatibility** — `WorktreeSpawnDialog`'s public props (`cwd`, `onSpawn`, `onCancel`, `initialBranch`, `attachProposal`) and `onSpawn` payload shape are unchanged. Parent components untouched.
- **Accessibility** — the combobox uses `role="combobox"` + `aria-expanded` + `aria-controls` on the trigger and `role="listbox"` + `role="option"` + `aria-selected` on the popover, matching the WAI-ARIA combobox pattern. The native `<select>` got accessibility "for free" — the new component owns it explicitly.
- **Rollback** — single-component migration. Revert is one PR that restores the `<select>` and removes the new components.
- **Out of scope**:
  - **Not changing `BranchPicker`'s public API** — `BranchSwitchDialog` and the icon-click flow keep their UX.
  - **Not adding free-text base branch** — base must exist (confirmed with user). Enter on no match is a no-op.
  - **Not virtualising the listbox** — 500 entries render fine without windowing; revisit only if a real repo exceeds that.
  - **Not migrating any other `<select>`** — audit confirmed no other branch selectors exist.
  - **Not portalising the popover** — naive absolute positioning is adequate inside the dialog flow; revisit only if clipping issues emerge.
