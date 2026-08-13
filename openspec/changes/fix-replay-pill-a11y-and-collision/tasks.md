## 1. Prove the defect first (red test)

Per design D6 and its "vacuous test" risk: the geometry assertion must be seen
failing against the *unfixed* indicator before any styling changes, or it proves
nothing.

- [ ] 1.1 Confirm the real `data-testid` of the scroll-to-bottom control in `ChatView.tsx:1456-1462`. Only `scroll-to-top` was confirmed present during review; if the bottom control lacks one, add it in this commit so the assertion has a stable selector.
- [ ] 1.2 In `tests/e2e/replay-in-flight-pill.spec.ts`, add a case that drives the stalled multi-batch replay used by the existing `F9/F11/X6` test, calls `page.setViewportSize({ width: 375, … })`, and asserts the bounding boxes of `[data-testid="replay-in-flight-pill"]` and the scroll-to-bottom control do not intersect. Reuse the existing `PILL` constant and harness setup rather than adding a second fixture.
- [ ] 1.3 In the same case, assert the scroll-to-bottom control is operable while the indicator shows (`toBeVisible()` + `click()` succeeds, not merely present in the DOM) — occlusion, not absence, is the defect.
- [ ] 1.4 Run the new case against unmodified code and **record that it fails on box intersection** — not on a missing selector or a timeout, either of which would mean the test is not exercising the defect. Capture the failure output for the PR description.

## 2. Theme token

- [ ] 2.1 In `packages/client/src/index.css`, add `--border-strong: #808080;` to the `:root` (dark) block beside the existing `--border-*` tokens, with a comment recording that it exists to satisfy WCAG SC 1.4.11 for overlay boundaries and measures 5.01:1 against `--bg-primary`.
- [ ] 2.2 Add `--border-strong: #777777;` to the `[data-theme="light"]` block (4.48:1 against light `--bg-primary`). Both blocks are required — a token defined in only one theme fails silently to an invalid value.
- [ ] 2.3 Add a test asserting both theme blocks define `--border-strong`, so a future theme edit cannot drop one half (design risk 2).

## 3. Rebuild the indicator as scrim + label

- [ ] 3.1 In `ChatView.tsx:1432-1444`, split the single pill into two siblings rendered under the *same* existing `showReplayPill && state.messages.length > 0` condition, so they can never diverge.
- [ ] 3.2 Add the scrim: `absolute inset-x-0 bottom-0` at ~112px tall, a gradient from `--bg-primary` to transparent, plus `pointer-events-none` and `aria-hidden="true"`. Give it its own `data-testid` for assertions. It must sit below the scroll controls in stacking order.
- [ ] 3.3 Move the label to `absolute bottom-16 left-1/2 -translate-x-1/2 z-20`, clearing the scroll-to-bottom control's 16..48px band by one spacing step at every viewport width.
- [ ] 3.4 On the label, replace `bg-[var(--bg-tertiary)]` with `bg-[var(--bg-surface)]` and `border-[var(--border-subtle)]` with `border-[var(--border-strong)]`.
- [ ] 3.5 Change the label's icon and text colour from `text-[var(--text-secondary)]` to `text-[var(--text-primary)]`. Leave `text-[11px]` and `shadow-lg` alone — text contrast already passes AA and is not a defect.
- [ ] 3.6 Remove the `aria-label` prop from the label (`ChatView.tsx:1437`). Leave `data-testid`, `role="status"`, and `aria-busy="true"` exactly as they are — the spec pins them and the e2e selectors depend on them.
- [ ] 3.7 Do **NOT** reposition the scroll controls (`:1446-1462`) and do **NOT** add trailing padding to the list. Their resting position must not depend on replay state (spec), and padding would reflow the virtualized transcript (design D2).
- [ ] 3.8 Add a `@media (prefers-reduced-motion: reduce)` block to `index.css` zeroing the animation on the indicator's spinner, following the existing block style at `:425`. The label must remain rendered — reducing motion must not remove the status.
- [ ] 3.9 Verify the reduced-motion selector actually matches the rendered spinner. It is a Tailwind `animate-spin` utility on an `Icon`, so scope the rule via the label's `data-testid` rather than assuming a stable class on the SVG.

## 4. Component coverage

- [ ] 4.1 In `packages/client/src/components/chat/__tests__/ChatView.replay-in-flight-pill.test.tsx`, assert the scrim carries `pointer-events-none` and `aria-hidden="true"`. Without this the scrim silently swallows selection and clicks over the tail while rendering identically (design risk 3).
- [ ] 4.2 Assert the scrim and the label appear together and clear together, so a scrim can never be left dimming the transcript after its label has gone.
- [ ] 4.3 Assert neither the scrim nor the label renders while the history-loading skeleton is showing, extending the existing `F3` exclusivity case to both elements.
- [ ] 4.4 Assert the label carries the intended position/stacking/token classes. Do **NOT** assert geometry here: jsdom has no layout engine and every `getBoundingClientRect()` returns zeros, so an overlap assertion would pass vacuously.

## 5. Verify

- [ ] 5.1 Re-run the case from 1.2–1.3 and confirm it now passes — the same test that failed in 1.4, unmodified.
- [ ] 5.2 Run `npm test -- replay-in-flight` and confirm the pre-existing 22 assertions still pass alongside the new ones; none of them should have needed editing.
- [ ] 5.3 Audit the rest of `tests/e2e/replay-in-flight-pill.spec.ts` for assertions coupled to the old corner position or the removed `aria-label` (e.g. `getByLabel`), and update only what the change genuinely invalidates.
- [ ] 5.4 Re-measure the shipped result rather than trusting the plan: with the client built, sample the label's computed border colour against the transcript background in both themes and confirm ≥3:1.
- [ ] 5.5 Confirm at 375/768/1440 in both themes that the label clears the scroll-to-top control and the composer as well as the scroll-to-bottom button.
- [ ] 5.6 Manually confirm the scrim's cost is acceptable in the running app: the tail message should read as dimmed-but-legible, not hidden. If it is not, the fallback is variant B in `mockups/ui-plan.md` — raise it rather than silently tuning the gradient past the point where the scrim reads as an affordance.
- [ ] 5.7 Run `npm run quality:changed` and resolve anything it flags in the touched files.

## 6. Documentation

- [ ] 6.1 Update the `ChatView.tsx.AGENTS.md` row for the indicator to record the scrim + label composition, the `--border-strong` dependency, the reduced-motion rule, and the "scroll controls must not move" constraint, with a `See change: fix-replay-pill-a11y-and-collision` marker.
- [ ] 6.2 Add a row for `--border-strong` wherever the theme tokens are documented, noting its SC 1.4.11 purpose so it is reused rather than re-derived.
- [ ] 6.3 Delegate any prose written under `docs/` to the DocScribe subagent in caveman style, per the Documentation Update Protocol; source-tree `AGENTS.md` rows are edited directly.
