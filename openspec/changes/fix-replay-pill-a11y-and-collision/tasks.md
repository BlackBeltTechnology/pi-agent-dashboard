## 1. Prove the defects first (red tests)

Per design D5 and its "vacuous test" risk: the geometry assertion must be seen
failing against the *unfixed* pill before any styling changes, or it proves
nothing.

- [ ] 1.1 In `tests/e2e/replay-in-flight-pill.spec.ts`, add a case that drives the stalled multi-batch replay used by the existing `F9/F11/X6` test, calls `page.setViewportSize({ width: 375, … })`, and asserts the bounding boxes of `[data-testid="replay-in-flight-pill"]` and `[data-testid="scroll-to-bottom"]` do not intersect. Reuse the existing `PILL` constant and harness setup rather than adding a second fixture.
- [ ] 1.2 In the same case, assert the scroll-to-bottom control is actually operable while the pill shows (`toBeVisible()` + `click()` succeeds, not merely present in the DOM) — occlusion, not absence, is the defect.
- [ ] 1.3 Confirm the real `data-testid` of the scroll-to-bottom control in `ChatView.tsx:1456-1462` before writing the selector; only `scroll-to-top` was confirmed present during review, so add a `data-testid` to the bottom control in the same commit if it lacks one.
- [ ] 1.4 Run the new case against unmodified code and **record that it fails on box intersection** (not on a missing selector or a timeout — either would mean the test is not exercising the defect). Capture the failure output in the PR description.
- [ ] 1.5 In `packages/client/src/components/chat/__tests__/ChatView.replay-in-flight-pill.test.tsx`, add a case asserting the pill carries the intended position/stacking classes. Do **NOT** assert geometry here: jsdom has no layout engine and every `getBoundingClientRect()` returns zeros, so an overlap assertion would pass vacuously.

## 2. Theme token

- [ ] 2.1 In `packages/client/src/index.css`, add `--border-strong: #808080;` to the `:root` (dark) block beside the existing `--border-*` tokens, with a comment recording that it exists to satisfy WCAG SC 1.4.11 for overlay boundaries and measures 5.01:1 against `--bg-primary`.
- [ ] 2.2 Add `--border-strong: #777777;` to the `[data-theme="light"]` block (4.48:1 against light `--bg-primary`). Both blocks are required — a token defined in only one theme fails silently to an invalid value.
- [ ] 2.3 Add a test asserting both theme blocks define `--border-strong`, so a future theme edit cannot drop one half (design risk 1).

## 3. Fix the pill

- [ ] 3.1 In `ChatView.tsx:1438`, change the pill's position from `bottom-4 right-4 z-10` to `bottom-16 right-4 z-20`, clearing the scroll-to-bottom control's 16..48px band by one spacing step at every viewport width.
- [ ] 3.2 In the same class list, replace `bg-[var(--bg-tertiary)]` with `bg-[var(--bg-surface)]` and `border-[var(--border-subtle)]` with `border-[var(--border-strong)]`.
- [ ] 3.3 Change the icon and label colour from `text-[var(--text-secondary)]` to `text-[var(--text-primary)]`. Leave the `text-[11px]` size and `shadow-lg` alone — text contrast already passes AA and is not a defect.
- [ ] 3.4 Remove the `aria-label` prop from the pill (`ChatView.tsx:1437`). Leave `data-testid`, `role="status"`, and `aria-busy="true"` exactly as they are — the spec pins them and the e2e selectors depend on them.
- [ ] 3.5 Add a `@media (prefers-reduced-motion: reduce)` block to `index.css` zeroing the animation on the pill's spinner, following the existing block style at `:425` (`… { animation: none; }`). The pill must remain rendered — reducing motion must not remove the status.
- [ ] 3.6 Verify the reduced-motion selector actually matches the rendered spinner. It is a Tailwind `animate-spin` utility on an `Icon`, so scope the rule via the pill's `data-testid` rather than assuming a stable class on the SVG.

## 4. Verify

- [ ] 4.1 Re-run the case from 1.1–1.2 and confirm it now passes — the same test that failed in 1.4, unmodified.
- [ ] 4.2 Run `npm test -- replay-in-flight` and confirm the pre-existing 22 assertions still pass alongside the new ones; none of them should have needed editing.
- [ ] 4.3 Audit the rest of `tests/e2e/replay-in-flight-pill.spec.ts` for any assertion coupled to the old position or the removed `aria-label` (e.g. `getByLabel`), and update only what the change genuinely invalidates.
- [ ] 4.4 Re-measure the shipped result rather than trusting the plan: with the client built, sample the pill's computed border colour against the transcript background in both themes and confirm ≥3:1.
- [ ] 4.5 Check the pill against the scroll-to-**top** control and the composer at 375/768/1440 to confirm the move to `bottom-16` introduced no new overlap.
- [ ] 4.6 Run `npm run quality:changed` and resolve anything it flags in the touched files.

## 5. Documentation

- [ ] 5.1 Update the `ChatView.tsx.AGENTS.md` row for the pill to record the new position, the `--border-strong` dependency, and the reduced-motion rule, with a `See change: fix-replay-pill-a11y-and-collision` marker.
- [ ] 5.2 Add a row for `--border-strong` wherever the theme tokens are documented, noting its SC 1.4.11 purpose so it is reused rather than re-derived.
- [ ] 5.3 Delegate any prose written under `docs/` to the DocScribe subagent in caveman style, per the Documentation Update Protocol; source-tree `AGENTS.md` rows are edited directly.
