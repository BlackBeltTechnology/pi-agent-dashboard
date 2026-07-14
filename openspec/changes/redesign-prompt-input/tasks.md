# Tasks — redesign-prompt-input

## 1. Container + toolbar
- [ ] 1.1 Restructure `CommandInput` into one bordered card: attachments row, textarea, inner toolbar.
- [ ] 1.2 Move `ModelSelector` + `ThinkingLevelSelector` into the toolbar as chips (trailing chevron, no decorative leading glyph).
- [ ] 1.3 Retire the standalone StatusBar model row for the selected session; keep StatusBar for the working-status label only.
- [ ] 1.4 Re-home `ComposerSessionActions` as a context strip above the card; keep gating + slot wiring identical.

## 2. Action button + delivery
- [ ] 2.1 Collapse the four-button cluster into one morphing action button (`send → stop → force-stop`), preserving `idle → aborting → killing` semantics.
- [ ] 2.2 Render `stop-after-turn` as a slim secondary affordance beside the action button while working.
- [ ] 2.3 Add the `Steer | Queue` segmented control mapped to the `Enter` / `Alt+Enter` contract (default `Steer`).

## 3. Affordances
- [ ] 3.1 Add the `＋` attach menu (image · file · screenshot · `/view` preview) wired to the existing paste + `/view` paths.
- [ ] 3.2 Add the focus-revealed footer hint line (`⏎ · ⇧⏎ · / · @ · !`); hidden at rest.
- [ ] 3.3 Enrich the `/` menu: grouped source sections + argument hints; keep source badges + `usePopoverFlip`.
- [ ] 3.4 (Conditional) Show a context-left indicator in the footer only if the datum is already client-side; else defer.

## 4. Icons + a11y
- [ ] 4.1 Finish MDI migration for every composer control (`currentColor`, one size); artifact letters stay letters.
- [ ] 4.2 `aria-label` on every icon-only button.
- [ ] 4.3 Footer + placeholder text meet WCAG-AA; add `prefers-reduced-motion` guards on caret/force-stop motion.

## 5. Mobile
- [ ] 5.1 Persistent row `＋ · model · ⋯ · send`; fold thinking / `Steer|Queue` / terminal into `⋯` overflow; attach/tools into `＋` sheet.
- [ ] 5.2 Send/stop ≥ 44px; context strip → chips-only; footer → one line.

## Tests
- [ ] T1 `CommandInput.test.tsx`: morphing button (empty/idle/streaming/second-press), `Steer|Queue` → correct `delivery`, footer reveal on focus, `＋` menu opens.
- [ ] T2 `ComposerSessionActions.test.tsx`: strip relocates above the card; gating unchanged (Explore/Archive/streaming/refresh).
- [ ] T3 `StatusBar.test.tsx`: standalone model row not rendered for the selected session.
- [ ] T4 Mobile-adaptation render test: persistent row members, `⋯` hosts folded controls, 44px action target.
- [ ] T5 Footprint test: resting (unfocused, no attach) composer height within budget vs baseline.

## Validate
- [ ] V1 `openspec validate redesign-prompt-input` passes.
- [ ] V2 `doubt-driven-review` on the `statusbar-inline` reversal + footprint budget before implementation stands.
- [ ] V3 `accessibility-a11y` pass (contrast, targets, motion, aria).
- [ ] V4 `code-simplification` pass on the unified composer.
- [ ] V5 Manual: verify no behavioural regression in `/` `@` `!`, history recall, `/view`, image paste, mid-turn queue.
