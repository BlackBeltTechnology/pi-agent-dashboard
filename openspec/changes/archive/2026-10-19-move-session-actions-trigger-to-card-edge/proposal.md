## Why

The session actions menu has an entry point you can't see. The 32 px hover strip on the card's right edge opens the menu after a dwell, but nothing on screen marks that edge as interactive. The header `⋮` trigger is the only visible cue, and it sits in a header row that is already crowded (time, Archive, Exit ✕). The `add-session-actions-flyout` mockup solved this with an "edge tab": a small dots pill on the card's right border. It was on by default in the mockup but was never specified or shipped.

## What Changes

- **Trigger moves to the card edge.** The session actions trigger becomes a small pill with vertical dots, centred vertically on the desktop card's right border. It straddles the border and mirrors the left-edge drag bead (`card-drag-bead`). It is the same button with the same contract:
  - `session-actions-trigger-<sessionId>`, `aria-haspopup="menu"`, `aria-expanded`;
  - click toggles the menu;
  - Escape returns focus to it.
- **Header `⋮` removed.** It is no longer rendered. The header keeps the time, Archive and Exit ✕.
- **Always visible.** The pill renders faint at rest and becomes full strength on card hover, on `:focus-visible`, and while its menu is open. It stays visible on touch and coarse-pointer devices, which have no hover. "Faint" means a mid-grey token (`--text-tertiary`) that stays at or above 3:1 non-text contrast (WCAG 1.4.11) on every built-in palette, not reduced opacity.
- **Accessible hit area.** The visible pill stays small, about 13×26, because the gap to the folder enclosure border is about 7 px. The card reserves a right-hand gutter: right padding grows from 8 px to 18 px, so content is about 10 px narrower. A transparent hit area extends inward into that gutter, so the target meets WCAG 2.5.8 (at least 24×24 CSS px) without overlapping ✕, Archive or any subcard control, at any card height.
- **Hover dwell kept.** The 32 px right-edge hover strip still auto-opens the menu after its dwell. The pill is a button, so resting on it does not arm the strip (existing "over controls" rule). Clicking it opens the menu.
- Mockup: mockups/session-card-edge-trigger (in this change). It is derived from the archived `add-session-actions-flyout` tuning mockup. Its toggles show the 24 px hit box and simulate touch. The "faint at rest" toggle, when off, shows a hover-only variant for comparison only. That variant is not shippable, because it violates the always-visible requirement.
- Unchanged: right-click, Shift+F10 / ContextMenu, menu placement beside the card, menu content, the folder actions menu, and the mobile card (which has no session actions menu).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `session-actions-menu`: the Trigger entry point moves from the card header to a pill centred on the card's right edge, always visible (faint at rest, emphasised on hover / focus / open), with a hit area of at least 24×24.
- `session-card-selection`: the edge trigger joins the rim, glow wrappers and drag bead as a card-root child that stays `position: absolute` on a selected card.
- `session-card-subcards`: the header controls of a desktop session card are Archive and Exit ✕ (in both the "keeps only state" and "five subcards" requirements). The session actions trigger is no longer a header control.

## Impact

- `packages/client/src/components/session/SessionActionsMenu.tsx`: trigger markup, classes and glyph. The panel and open logic are unchanged.
- `packages/client/src/components/session/SessionCard.tsx`: where the trigger is mounted (header row → last direct child of the card root). Card right padding `pr-2` → `pr-[18px]` (reserved gutter). A `.card-selected-ring > *` position override is required, the same trap `card-drag-bead` already escapes.
- `packages/client/src/index.css`: a `card-edge-trigger` class that re-asserts `position:absolute; z-index:20`, declared after `.card-selected-ring > *`.
- Tests: `SessionActionsMenu.test.tsx`, `SessionCard.actions-menu.test.tsx`, `SessionList.actions-menu.test.tsx`, `SessionCard.test.tsx` (including the `pr-2` padding pin at :1131), `SessionCard.card-sections.test.tsx`, `SessionCard-acp-driver.test.tsx`, `SessionList.card-spawn-worktree.test.tsx`, `tests/e2e/helpers/session-actions-menu.ts`, `tests/e2e/session-actions-menu.spec.ts`, `tests/e2e/flow-attach-before-run.spec.ts`. The test id is kept, so most selectors keep working; assertions about header placement change.
- `docs/session-actions-menu.md` and `packages/client/src/components/session/AGENTS.md` rows.
- No server, extension, protocol or plugin API impact.

## Discipline Skills

None of the eng-disciplines checkpoints apply. This is a client-only relocation of an existing control: no auth, untrusted input, secrets or PII; no latency or throughput budget beyond the existing 100 ms menu-open requirement, which is unchanged; no new endpoint, job or external call; and nothing irreversible. `review-code` runs before commit as usual.
