# Proposal

## Why

The live-component mock site (archived `add-live-component-mock-site`) shipped
with review-quality gaps found in an explore session:

- The example mock `mockups/2026-11-03-session-pills/` lives in the real mock
  root, so every checkout lists it as an **Open** review item. It only exists
  there because the E2E fixture copies it. It also shows UI the app does not
  have (an invented "Prompt failed: ENOENT" box).
- Mocks cannot show a state change. Buttons in a pane are dead, so the reviewer
  never sees what a click leads to.
- The page is a wall of wide side-by-side panes with no per-frame reason and
  loud red/green CURRENT/PROPOSED labels; the invoice-bot mock board (index of
  frames + one-line reason per frame) reads far better.
- In a phone pane the ring badge sits on the ringed text; a ring wrapping
  several inline items lets them wrap and truncates siblings.
- Phone frames start at a small blank height and jump when content arrives.

Mockup: mockups/mock-site-quick-fix (in this change) — static HTML explore
artifact, not a live mock.

## What Changes

- Move the example to `packages/mockup-loop/examples/2026-11-03-session-pills/`
  (not a mock root; shipped in the package `files`). The E2E fixture copies it
  from there. The example drops the invented ENOENT box and gains a 3-step
  re-link flow. A site with zero mocks shows a "No mocks yet" empty state.
- Kit `Frame` gains `why?: string` (one-line reason, `WHY > 120` lint),
  `steps?: Step[]` (states drawn side by side, default) and `play?: boolean`
  (animate the steps in one pane; reduced motion falls back to side by side).
  Kit exports `Tap` (marks the click target that leads to the next step).
- Each mock page opens with an overview: one caption card per frame (number,
  title, `why`, side/step chips) linking to `#<id>/<n>`. Current/Proposed labels
  become quiet chips.
- Rings: `inline-flex` (no wrapping of ringed content); in a phone pane the
  badge sits above the ring, not on its text.
- Phone panes: start at a cached (per spec, `sessionStorage`) or 240px height
  with a loading line until the first height message.

Non-goals: live thumbnails in the overview, a separate focus view, real click
handlers in mocks, changes to decisions / CLI / ref grammar.

## Capabilities

### Modified Capabilities
- `mockup-live-component-site`: discovery note for examples, frames gain
  `why` / `steps` / `play`, overview, phone pane loading, phone badge placement.

## Impact

- `packages/mockup-loop/site/{Site.tsx,kit.tsx,site.css}`, `packages/mockup-loop/examples/`,
  `packages/mockup-loop/package.json` (`files`), `tests/e2e/mock-site/fixture.ts`,
  `mockups/AGENTS.md`, `mockups/tsconfig.json`, `packages/mockup-loop/references/live-mock-site.md`.
- No server, client or protocol change.

## Discipline Skills

- `review-code` before commit. No auth, secrets, untrusted-input, latency or
  irreversible surface: `/__mock/decide` and the ref grammar are untouched.
