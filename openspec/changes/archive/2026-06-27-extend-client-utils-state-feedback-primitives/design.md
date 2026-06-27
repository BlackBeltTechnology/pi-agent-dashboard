# Design — extend-client-utils-state-feedback-primitives

## Context

Outcome of a six-surface UX exploration + falsification pass. The dashboard's
`packages/client-utils/` already centralizes overlay/shell/interaction
primitives but stops short of the **state-presentation + feedback** layer. Every
UX decision below cites an external rule (Nielsen, Laws of UX, NN/g component
articles, WCAG 2.2) per the `frontend-mockup-loop` corpus.

### Evidence map (root cause → primitive)

| Symptom (surfaces) | Missing primitive | Rule |
|---|---|---|
| 61 inline empties, no value/CTA | `EmptyState` | NN/g empty-state |
| 55 spinners, 0 skeletons on content loads | `Skeleton` | NN/g skeleton-screens; Doherty |
| 39 `focus:outline-none` + 1px border | `.focus-ring` | WCAG §2.4.11 |
| color-only status (card, chip, board) | status-presentation | WCAG §1.4.1 |
| icon-only buttons, hover-only identity | aria-label + label convention | WCAG §4.1.2; H6 |

## Goals / Non-Goals

**Goals**
- Add the four missing primitives to `client-utils` with a documented "when to
  use" so future surfaces consume, not re-roll.
- Ship an adoption ratchet so the gap cannot silently regrow.
- Prove each primitive by refactoring 1-2 real surfaces in this change.

**Non-Goals**
- Not a full visual redesign; primitives match current tokens/spacing.
- Not a sweep of all 61 empties / 39 focus sites — only the first proving
  targets here; the ratchet drives the rest incrementally.
- No server/protocol change. No new dependency beyond `@axe-core/react` (already
  used by `add-extension-ui-a11y-baseline`).

## Decisions

### D1 — Extend `client-utils`, do not start a new package
The team already extracts primitives there (`StatusPill`, `Confirm`,
`useFocusTrap`…). New primitives live beside them for discoverability and reuse
by plugins. *Rule: consistency (H4); rides existing convention.*

### D2 — `EmptyState` encodes the NN/g pattern, not just text
Props force the pattern: a value-framed `title`, optional shape-of-success slot,
**at most one** primary `action` + one `secondaryAction`. Bare strings can't
satisfy it, so adopting it upgrades copy by construction. *Rule: NN/g
empty-state; H8 one primary action; Von Restorff.*

### D3 — `Skeleton` for content-layout loads; spinner stays for blocking actions
Decision rule baked into docs + lint: full-region/content reloads (chat history,
board, lists) → `Skeleton`; sub-second blocking actions (button submit) →
spinner. Honor `prefers-reduced-motion` (static shimmer). *Rule: NN/g
skeleton-screens; response-times; Doherty.*

### D4 — `.focus-ring` is a CSS utility, not per-component classes
One `:focus-visible` utility (≥2px ring/outline, ≥3:1 contrast, offset) in
`index.css` + a `focusRing` string export. Replaces 39 ad-hoc sites. Using
`:focus-visible` (not `:focus`) avoids mouse-click rings. *Rule: WCAG §2.4.7 /
§2.4.11.*

### D5 — Status presentation: extend `StatusPill`, don't fork a 4th status map
`StatusPill` already exists but isn't universally adopted (board re-rolls
`STATE_COLORS`). Harden it to take a semantic `--status-*` token + a **mandatory
non-hue channel** (icon/shape), then point session-card/chip/board at it. Aligns
with the `--status-*` tokens from `improve-dashboard-attention-routing`. *Rule:
WCAG §1.4.1; DRY; H4.*

### D6 — Adoption ratchet, not a big-bang sweep
A test fails on NEW violations in covered surfaces (new inline empty, bare
`focus:outline-none`, color-only status). Existing sites migrate opportunistic-
ally. *Rule: keeps scope shippable; mirrors the repo's Biome ratchet model.*

## Risks / Open Questions

- **Q1**: `.focus-ring` contrast must hit ≥3:1 in all 4 themes (studio/earth/
  athlete/gradient) against varied backgrounds — verify per theme. Hard gate.
- **Q2**: `StatusPill` API change — audit current consumers before extending so
  the non-hue channel is additive, not breaking.
- **Q3**: Skeleton shapes must match real content to avoid layout shift (CLS);
  author per-surface variants (`bubble` for chat ≠ `row` for lists).
- **Q4**: ratchet false-positives on legitimate non-status color — scope the
  lint to the covered surfaces + an allowlist, keep it advisory-then-error.
- **Q5**: coordinate the StatusPill/`--status-*` token shape with
  `improve-dashboard-attention-routing` so the two changes don't define the
  tokens twice — whichever lands first owns the token definitions.

## Verification approach

1. axe smoke over each new primitive (serious/critical fail) + per-theme
   contrast on `.focus-ring` and status tokens (hard gate).
2. `frontend-mockup-loop`: mock the EmptyState + Skeleton + status states
   (dark+light, 3 breakpoints), `score_mockup` rubric green.
3. Refactor targets verified in an isolated env (`isolated-ui-verification`),
   live :8000 untouched.
4. Ratchet test red before refactor, green after.
