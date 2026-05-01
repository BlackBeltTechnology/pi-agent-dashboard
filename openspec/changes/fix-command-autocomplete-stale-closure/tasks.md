## 1. Lock in the regression suite

- [ ] 1.1 Move/rename `packages/client/src/components/__tests__/CommandInput.dropdown-select.probe.test.tsx` into the regular suite (drop the `.probe` infix; final name e.g. `CommandInput.dropdown-select.test.tsx`).
- [ ] 1.2 Run the suite and confirm the two "after switching to a different session" scenarios fail with `Expected "/deploy " / Received "/dep"` before any production changes — this is the red baseline.
- [ ] 1.3 Confirm the other 8 scenarios in the file pass on the unchanged code, so the failure is precisely the targeted bug.

## 2. Fix `selectCommand` deps

- [ ] 2.1 In `packages/client/src/components/CommandInput.tsx`, add `setText` to the `useCallback` deps array of `selectCommand`.
- [ ] 2.2 Re-run the suite; the "Tab works AFTER switching sessions" and "Click works AFTER switching sessions" `/`-path scenarios now pass.
- [ ] 2.3 Confirm no previously-passing test regressed.

## 3. Document `selectFile`'s safety-by-accident

- [ ] 3.1 In the same file, leave `selectFile`'s deps array unchanged but add an inline comment above it explaining that `text` in the deps is what re-creates the callback every keystroke and incidentally re-captures the latest `setText`. Note that if those deps are ever tightened, `setText` MUST be added explicitly, mirroring `selectCommand`.
- [ ] 3.2 Add one passing scenario to the dropdown-select suite asserting the `@`-file path still works (mounted, click on file entry, textarea updates) so that any future regression on this path — including from the documented latent trap — fails loudly.

## 4. Sweep for siblings

- [ ] 4.1 Grep `packages/client/src/components/CommandInput.tsx` for any other `useCallback(..., [])` or `useCallback(..., [...])` that closes over `setText`, `setDismissed`, or `onDraftChange` without listing it. If any are found, document under "Open Questions" in `design.md` or fix in this change.
- [ ] 4.2 Optional: scan for the same anti-pattern across other input-like components (`ExploreDialog`, `MessageInput` if it still exists). Out of scope to fix here — file as a follow-up.

## 5. Documentation

- [ ] 5.1 Update the `CommandInput.tsx` row in `AGENTS.md` to mention that `selectCommand` / `selectFile` deps include `setText` so the dropdown-select path stays correct across session switches.
- [ ] 5.2 Update `docs/architecture.md` if it discusses `CommandInput`'s controlled-draft flow (only if a relevant section exists).
- [ ] 5.3 Mention the new regression test in the change cross-reference comments in `AGENTS.md` if a similar pattern (e.g. `chat-input-draft-and-history`) is referenced.

## 6. Verify

- [ ] 6.1 Run the full `npm test` suite once and confirm zero new failures.
- [ ] 6.2 Manually verify on desktop (Linux + Windows browser): mount a session, switch to another, return, type `/`, click and Tab on the dropdown. Both insert. Repeat for `@`.
- [ ] 6.3 Re-confirm phone behaviour is unchanged.
