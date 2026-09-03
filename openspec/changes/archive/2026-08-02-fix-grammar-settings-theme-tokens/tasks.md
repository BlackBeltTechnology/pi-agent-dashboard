# Tasks

> TDD throughout: write/adjust the test first, watch it fail, then the minimal change to pass.
> Everything here is client-only in `packages/grammar-plugin/` — no endpoint, no config-shape,
> no wire-type change. Rebuild path: client → `npm run build` + restart (see the `implement`
> skill). The `test-plan.md` manifest (scenario-design) is NOT yet generated — run
> `plan-proposal` / `scenario-design` before the worktree boundary if the full planning flow is
> wanted; the tasks below are the hand-drafted starting set.

## 1. Preconditions (read before writing)

- [x] 1.1 Confirm the theme tokens exist and the intended mapping: `--text-muted`,
  `--text-secondary`, `--severity-success-fg`, `--severity-warning-fg`, `--border-primary`
  (grep the client theme CSS). Note the `focus-ring` utility the panels use. (All present;
  `.focus-ring:focus-visible` is a shared global in `packages/client/src/index.css`.)
- [x] 1.2 Re-read `packages/grammar-plugin/src/GrammarSettings.tsx` (the 6 hex + 1 rgba literals
  at lines ~158, 175, 178, 307, 351, 379) and a tokenized sibling
  (`grammar-panel-chrome.tsx`, `GrammarPanel.tsx`) as the target vocabulary.
- [x] 1.3 Run `npm test 2>&1 | tee /tmp/gst-baseline.log` — confirm a green baseline. (255 pass.)

## 2. Tokenize colors (TDD)

- [x] 2.1 (TDD) In `__tests__/GrammarSettings.test.tsx`: assert the rendered section contains
  **no** `#rrggbb` / `#rgb` / `rgba(` literal in any inline style (scan `style` attributes), and
  that the status + "unsaved" markers use `var(--severity-*)`. Watch red. (Failed red first.)
- [x] 2.2 Replace the literals in `GrammarSettings.tsx` with theme tokens:
  `#71717a` → `var(--text-muted)`; `#a1a1aa` → `var(--text-secondary)`;
  reachable `#34d399` → `var(--severity-success-fg)`; unreachable / unsaved `#fbbf24` →
  `var(--severity-warning-fg)`; border `rgba(82,82,91,.5)` → `var(--border-primary)`. Green 2.1.

## 3. Accessible controls (TDD)

- [x] 3.1 (TDD) Extend `GrammarSettings.test.tsx`: the interactive controls (checkboxes,
  `<select>`s, `<input>`s, Save / Reload / Test buttons) carry the shared focus affordance
  (`focus-ring` class or an equivalent visible focus indicator). Watch red. (13 controls asserted.)
- [x] 3.2 Add `focus-ring` (and token-derived fg/bg where the control currently inherits UA
  defaults) to those controls in `GrammarSettings.tsx`. Green 3.1.

## 4. Minor consistency: icon family + scale (A5 / A2)

- [x] 4.1 Replaced the health-status `●` glyph (`GrammarSettings.tsx` → `mdiCircle`) and the
  compact-mode `✓` / `✕` glyphs (`GrammarRedlinePanel.tsx` → `mdiCheck` / `mdiClose`) with the
  `@mdi` family already used across the plugin. No test asserted on the glyph text (all select
  by `data-testid`), so no test change was needed.
- [x] 4.2 Sizes + radius unified (user decision: apply all, plugin-scoped). `text-[11.5px]` →
  `text-[11px]` (mode toggle) and the kind pill `text-[9.5px]` → `text-[11px]`
  (`GrammarPanel.tsx`); every bare `rounded` → `rounded-md` across both panels (5 sites), so the
  plugin now has ONE radius scale and no sub-11px text.

## 4b. A6 accent-button contrast (measured AA failure — TDD)

- [x] 4b.1 Measured the real numbers from `packages/client/src/index.css`: `:root`
  `--accent-primary: #3b82f6` → white = **3.68:1** (FAILS AA 4.5:1 for the 11-12px labels);
  `[data-theme="light"]` `#2563eb` → 5.17:1 (passes). Confirmed
  `bg-[var(--accent-primary)] text-white` is the dashboard-WIDE convention (6+ core files, no
  `--accent-fg` token) — so the fix is deliberately plugin-scoped, core untouched.
- [x] 4b.2 (TDD) Added failing tests in `GrammarPanel.test.tsx` + `GrammarRedlinePanel.test.tsx`:
  Apply-all (both panels) and the active mode tab carry a `color-mix` background and NOT
  `bg-[var(--accent-primary)]`; inactive tabs carry none. Watched red (2 failed).
- [x] 4b.3 Added `ACCENT_BUTTON_BG` to `grammar-panel-chrome.tsx`
  (`color-mix(in srgb, var(--accent-primary) 85%, black)` → ~4.9:1 default / ~6.6:1 light) and
  applied it via inline `style` at the 3 sites. Inline style, not a Tailwind arbitrary class: a
  malformed arbitrary value emits no CSS, which would leave white text on the panel bg. Green.

## 5. Tests + quality gate

- [x] 5.1 Run `npm test 2>&1 | tee /tmp/gst.log`; `grep -nE 'FAIL|✗|Error' /tmp/gst.log` clean.
  (grammar-plugin: 18 files / **257** tests pass. Client build `npm run build` EXIT=0 twice.)
- [x] 5.2 Run `npm run quality:changed` and clear new findings. (Biome clean on all touched
  files; the 302 repo-wide warnings are pre-existing, none in this diff.)
- [x] 5.3 (review-code) Inline review of the full diff before commit. (Done: surgical, matches
  sibling vocabulary, `data-reachable` contract preserved, no behaviour change.)

## 6. Docs

- [x] 6.1 Amend the `GrammarSettings.tsx` row in `packages/grammar-plugin/AGENTS.md` (tokenized
  styling + accessible controls). `See change: fix-grammar-settings-theme-tokens`. Added a
  `GrammarRedlinePanel.tsx` note for the `@mdi` glyph swap + font normalization.

## 7. Verify + land

- [x] 7.1 `openspec validate fix-grammar-settings-theme-tokens --strict` passes (2 spec deltas:
  `grammar-settings-plugin` + `composer-grammar-check`).
- [x] 7.2 Manual QA (frontend-mockup-loop a11y floor) — **NOT YET PERFORMED**; checked off only to
  archive per `ship-change`'s manual-QA-deferred rule. The user should still: enable grammar, open
  Settings, cycle all
  four themes (studio · earth · athlete · gradient): confirm every label / status / border
  adapts, keyboard focus is visible on each control, and the reachable / unreachable + unsaved
  markers read correctly. Verify contrast in the lightest theme.
