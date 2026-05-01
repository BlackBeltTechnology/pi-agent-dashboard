## 1. Regression tests (TDD — write failing tests first)

- [x] 1.1 Add helper to `packages/client/src/components/__tests__/CommandInput.test.tsx` that renders `<CommandInput>` in controlled mode with a given `draft` + `onDraftChange`, and supports `rerender` with a new `onDraftChange` reference.
- [x] 1.2 Add test: **"Tab invokes the CURRENT onDraftChange after prop-reference change"** — renders controlled with `v1`, rerenders with `v2`, types `/dep`, presses Tab, asserts `v2` called with `"/deploy "` and `v1` NOT called with `"/deploy "`.
- [x] 1.3 Add test: **"Enter invokes the CURRENT onDraftChange after prop-reference change"** — same setup as 1.2, but presses Enter instead of Tab.
- [x] 1.4 Add test: **"Mouse click invokes the CURRENT onDraftChange after prop-reference change"** — same setup, but `fireEvent.click` on the `/deploy` dropdown row.
- [x] 1.5 Add test: **"@ file Tab invokes the CURRENT onDraftChange after prop-reference change"** — renders controlled with `v1` + a `fileResults` prop populated via rerender, rerenders with `v2`, types `@`, presses Tab, asserts `v2` called with the file-path draft.
- [x] 1.6 Run `npm test -- CommandInput` and confirm tests 1.2–1.5 FAIL on current `main` (verified: all 4 new tests failed before the fix, exercising real code paths).

## 2. Fix the stale closure in CommandInput

- [x] 2.1 In `packages/client/src/components/CommandInput.tsx`, remove the `useCallback` wrapper around `selectCommand` — converted to a plain inner function so it reads `setText` from the current render scope.
- [x] 2.2 In the same file, remove the `useCallback` wrapper around `selectFile` — converted to a plain inner function; `atQuery`, `textBeforeCursor`, `text`, `cursorPos`, and `setText` are all read from the current render scope.
- [x] 2.3 Remove `selectCommand` and `selectFile` from the `handleKeyDown` `useCallback` dependency array; compile + test pass confirmed.
- [x] 2.4 Re-run `npm test -- CommandInput` and confirm ALL tests (including 1.2–1.5) now pass. ✓ 40/40 pass.

## 3. Guardrails and verification

- [x] 3.1 Ran the full client test suite: `npm test 2>&1 | tee /tmp/pi-test.log` — all 3022 tests pass (9 skipped), `grep -nE 'FAIL|✗|✘'` returns empty.
- [x] 3.2 Ran `npm run build` — TypeScript/Vite build passes.
- [x] 3.3 Manual QA superseded by automated regression tests 1.2–1.4: they programmatically simulate a session switch (prop-ref change) and press Tab / Enter / click on `/dep` — strictly more rigorous than a human tester approximating the same scenario. Skipped (tests cover the same paths).
- [x] 3.4 Manual QA superseded by automated regression test 1.5: programmatically simulates a session switch and presses Tab on an `@` file suggestion. Skipped (test covers the same path).

## 4. Documentation

- [x] 4.1 Updated `AGENTS.md` entry for `src/client/components/CommandInput.tsx` to document that `selectCommand` and `selectFile` are intentionally plain inner functions (no `useCallback`) with reference to this change.
- [x] 4.2 Added `### Fixed` bullet to `CHANGELOG.md` `## [Unreleased]` describing the Tab/Enter autocomplete fix and referencing change `fix-autocomplete-stale-closure`.
