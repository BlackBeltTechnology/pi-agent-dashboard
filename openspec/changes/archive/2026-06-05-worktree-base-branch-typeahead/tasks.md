# Tasks

## 1. Extract `BranchListbox` (presentational)

- [x] 1.1 Create `packages/client/src/components/BranchListbox.tsx`. Controlled props: `branches: GitBranchEntry[]`, `filter: string`, `highlightIndex: number`, `onHighlightChange: (index: number) => void`, `onSelect: (branch: string) => void`, `disableCurrent?: boolean` (default `false`; `BranchPicker` will pass `true` to preserve its "current is not selectable for checkout" behaviour), `rows?: number` (default `10`).
- [x] 1.2 Move the local/remote split, `displayItems` flat list, `selectableIndices`, and per-row rendering (current marker `●`, remote badge, hover/highlight styling, click handler) out of `BranchPicker.tsx` into `BranchListbox`. Apply caseless `filter.toLowerCase().includes(b.name.toLowerCase())` filtering inside the component so callers pass raw filter text.
- [x] 1.3 Expose imperative keyboard helpers via either (a) a `handleKey(e: KeyboardEvent) => boolean` method returned alongside (preferred — keeps the listbox uncoupled from input ownership), or (b) accept `onKeyDown` and call it after internal handling. Pick (a): export a `useBranchListboxKeyboard({ branches, filter, highlightIndex, onHighlightChange, onSelect, disableCurrent })` hook that returns `{ handleKey, displayItems, selectableIndices }`. The component uses it internally; `BranchCombobox` uses it to wire its input's `onKeyDown`.
- [x] 1.4 Tests `packages/client/src/components/__tests__/BranchListbox.test.tsx`:
  - Renders local branches before remote with a separator only when both groups non-empty.
  - Current branch shows `●` marker; `disableCurrent: true` makes it non-clickable and skipped by `selectableIndices`; `disableCurrent: false` allows selection.
  - Filter text narrows displayed items case-insensitively.
  - Click on a row calls `onSelect(branch.name)`.
  - Highlight styling applies when `highlightIndex` matches the row's flat index.
  - `useBranchListboxKeyboard` hook: ArrowDown/Up moves through `selectableIndices` with wraparound; Enter on highlight calls `onSelect`; Enter when `highlightIndex === -1` and `selectableIndices.length === 0` (empty filter result) is a no-op and returns `false`.

## 2. Refactor `BranchPicker` to use `BranchListbox`

- [x] 2.1 In `packages/client/src/components/BranchPicker.tsx`, delete the inlined `displayItems`, `selectableIndices`, `handleKeyDown`, and per-row rendering. Replace with `<BranchListbox branches={branches} filter={filter} highlightIndex={highlightIndex} onHighlightChange={setHighlightIndex} onSelect={onSelect} disableCurrent rows={rows} />` plus the `useBranchListboxKeyboard` hook wired to the existing `<input>` `onKeyDown`. Keep the fetching, loading/error states, Cancel button, and `onNotGitRepo` behaviour untouched.
- [x] 2.2 Verify `packages/client/src/components/__tests__/BranchPicker.test.tsx` (12 tests) passes without modification. This is the regression net for the extraction. If any test fails, fix `BranchListbox` / `BranchPicker` — do not change the tests.

## 3. Create `BranchCombobox`

- [x] 3.1 Create `packages/client/src/components/BranchCombobox.tsx`. Controlled props: `branches: GitBranchEntry[]`, `value: string`, `onChange: (branch: string) => void`, `current?: string`, `disabled?: boolean`, `placeholder?: string`, `"data-testid"?: string`.
- [x] 3.2 Render a trigger button (closed state) showing `value || placeholder` with a `▾` caret. ARIA: `role="combobox"`, `aria-expanded`, `aria-controls={popoverId}`, `aria-haspopup="listbox"`. Click/focus opens the popover; disabled disables open.
- [x] 3.3 Popover (open state, absolute-positioned below the trigger, `z-10` or similar) contains: a filter `<input>` (autofocused on open) and a `<BranchListbox branches={branches} filter={filter} highlightIndex={highlightIndex} onHighlightChange={setHighlightIndex} onSelect={handleSelect} disableCurrent={false} />`. `handleSelect(name)` calls `onChange(name)`, closes the popover, resets filter, and returns focus to the trigger.
- [x] 3.4 Wire `useBranchListboxKeyboard` to the filter input's `onKeyDown`. Additional handling: Esc closes the popover (calls `e.stopPropagation()` so the parent dialog does not also close); Tab closes the popover without `stopPropagation` (focus naturally advances). Enter when filter has no matches is a no-op (the hook returns `false`; combobox does not close).
- [x] 3.5 Outside-click closes the popover. Implement with a `ref` on the root + a `document` `mousedown` listener that closes when the click target is not inside the ref. Listener attached only while open.
- [x] 3.6 The trigger forwards `data-testid` as given; the popover root receives `data-testid={`${testid}-popover`}` and the filter input `data-testid={`${testid}-filter`}` (when `testid` is provided), to support tests.
- [x] 3.7 Tests `packages/client/src/components/__tests__/BranchCombobox.test.tsx`:
  - Closed by default: trigger renders, popover not in the DOM.
  - Click trigger opens popover; filter input is focused.
  - Typing in filter narrows the listbox (assert via rendered row count).
  - Click on a row calls `onChange(branchName)` and closes the popover; the trigger now shows the new value.
  - ArrowDown then Enter selects the highlighted branch (calls `onChange`, closes).
  - Enter when filter matches nothing does not call `onChange` and does not close.
  - Esc closes the popover and does not propagate (assert via a parent `keydown` listener that should not fire — use `addEventListener` on `document` with a spy).
  - Outside-click closes the popover.
  - `disabled` prop: trigger does not open on click.
  - `value === ""` with `placeholder` set: trigger renders the placeholder.

## 4. Migrate `WorktreeSpawnDialog`

- [x] 4.1 In `packages/client/src/components/WorktreeSpawnDialog.tsx`, replace the `<label>` block containing `<select data-testid="worktree-base-select">` (lines ~334–349) with:
  ```tsx
  <label className="block">
    <span className="text-[11px] text-[var(--text-tertiary)]">Base branch</span>
    <BranchCombobox
      data-testid="worktree-base-combobox"
      branches={[...(data?.localBranches ?? []), ...(data?.remoteBranches ?? [])].map(/* see 4.2 */)}
      value={base}
      onChange={setBase}
      current={data?.currentBranch}
      placeholder={hasUsableBase ? undefined : "no usable default base — pick one"}
    />
  </label>
  ```
- [x] 4.2 Note that today `LoadedData.localBranches` and `.remoteBranches` are `string[]` (built by `.map((b) => b.name)` at lines ~109–110). Change `LoadedData` to hold `GitBranchEntry[]` directly and remove the `.map((b) => b.name)` stripping. Update `allBranches`/`hasUsableBase` derivations to read `.name` where they need strings. Verify by grepping `allBranches`, `localBranches`, `remoteBranches` usages within the file.
- [x] 4.3 Add `import { BranchCombobox } from "./BranchCombobox.js";` at the top.
- [x] 4.4 Remove the obsolete `worktree-base-select` testid; no other source file references it (verify with `grep -rn worktree-base-select packages/`).
- [x] 4.5 Update `packages/client/src/components/__tests__/WorktreeSpawnDialog.test.tsx`:
  - The two tests at lines ~229 and ~240 currently grab `screen.getByTestId("worktree-base-select")` and use `fireEvent.change(sel, { target: { value: "..." } })`. Rewrite to:
    1. `fireEvent.click(screen.getByTestId("worktree-base-combobox"))` to open the popover.
    2. `fireEvent.change(screen.getByTestId("worktree-base-combobox-filter"), { target: { value: "..." } })` (optional filter step if helpful).
    3. `fireEvent.click(screen.getByText("<branch-name>"))` to pick.
  - Assertions on the subsequent `onSpawn` payload (`base` field) and on the derived path remain unchanged — those are end-state checks, not interaction checks.

## 5. Documentation

- [x] 5.1 Delegate to a general-purpose subagent (per AGENTS.md "Documentation Update Protocol"): add per-file rows for `BranchListbox.tsx`, `BranchCombobox.tsx`, and updated row for `BranchPicker.tsx` (note: now delegates rendering to `BranchListbox`) in `docs/file-index-client.md`. Caveman style. One row per file, path-alphabetical. Include `See change: worktree-base-branch-typeahead` annotation on the new/modified rows.
- [x] 5.2 No AGENTS.md change. No architecture-doc change (purely a client-component refactor; no protocol or persistence impact).

## 6. Verification

- [x] 6.1 `npm test 2>&1 | tee /tmp/pi-test.log` runs green. `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log` returns no failures.
- [x] 6.2 `npm run build` succeeds. TypeScript strict-mode passes.
- [x] 6.3 Manual smoke (per AGENTS.md "Build & Restart Workflow"): `npm run build && curl -X POST http://localhost:8000/api/restart`, then open the Worktree dialog from the UI on a repo with >20 branches. Verify: trigger collapsed by default; click opens popover with autofocus on filter; typing narrows; ↑↓ navigate; Enter picks; Esc closes popover only (not the dialog); outside-click closes popover.
- [x] 6.4 OpenSpec validate: `npx openspec validate worktree-base-branch-typeahead --strict`.

## 7. Subagent delegation plan

Per user direction "for implementations use subagents". Suggested routing:

- **Tasks 1–4 (component work + dialog wiring + tests)**: single `react-expert` subagent. Pass the proposal + tasks 1–4 + explicit file paths. One pass covers all four (interconnected; chaining would lose context).
- **Task 5 (docs)**: general-purpose subagent (`Explore` or similar) per the "every docs/ write delegated to subagent with caveman-style rule passed verbatim" mandate in AGENTS.md.
- **Task 6 (verification)**: main agent runs the commands and reads the log. Not delegated.
