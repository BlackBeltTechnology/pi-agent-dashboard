## 1. CSS swap

- [x] 1.1 In `packages/client/src/index.css`, replace the `.card-stripes-fx::before` diagonal `repeating-linear-gradient(45deg, …)` + `card-stripe-scroll` keyframe with the horizontal sweep: over-wide overlay (`left/right: -460px`), `repeating-linear-gradient(90deg, transparent 0 60px, COLOR 230px, transparent 400px 460px)`, animated `transform: translateX(0 → 460px)` `linear` infinite → verify: seamless loop, no snap.
- [x] 1.2 Keep a faint flat tint underlay (~`.05` alpha) per state color → verify: state still readable when the band is mid-gap.
- [x] 1.3 Wire the three color variants on `.card-stripes-running` (amber), `.card-stripes-unread` (cyan), `.card-stripes-input` (purple) with band alpha ~`.16`/`.20`/`.22` → verify: colors match the mockup.
- [x] 1.4 Preserve `@media (prefers-reduced-motion: reduce)` (no transform animation, static tint retained) and the `app-hidden` pause rule → verify: reduced-motion shows a static tinted card, no drift.

## 2. Verify untouched wiring

- [x] 2.1 Confirm `getCardPulseClass` / `getCardStripeFxClass` / `deriveProposalCardState` in `packages/client/src/lib/session-status-visuals.ts` are unchanged → verify: `session-status-visuals.test.ts` passes without edits.
- [x] 2.2 Confirm the OpenSpec board `BoardSessionRow` and folder rows render the new look via the shared CSS (no component changes) → verify: board cards sweep, not stripe.

## 3. Selected-card combined surface

- [x] 3.1 Visually confirm the sweep reads cleanly under the rotating rainbow `card-ring-fx` / `card-glow-fx` on a selected card (all three states) → verify: rim stays rainbow, status sweep washes behind content, no muddy overlap.

## 4. Regression + docs

- [x] 4.1 `npm test` green (class-name/precedence assertions unchanged).
- [x] 4.2 Update the visual scenario wording in `openspec/specs/session-card-status/spec.md` per the delta (diagonal stripe → horizontal sweep gradient) on archive.
- [x] 4.3 Add a `See change: card-gradient-state-animation` annotation to the `session-status-visuals.ts` and `index.css` rows in `docs/file-index-client.md`.
