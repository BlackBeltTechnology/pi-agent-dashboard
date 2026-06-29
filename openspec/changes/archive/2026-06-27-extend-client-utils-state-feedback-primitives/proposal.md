# extend-client-utils-state-feedback-primitives

## Why

A grounded UX exploration across six dashboard surfaces (session card, folder
header, composer `ArtifactChip`, search/composer inputs, chat empty/loading,
OpenSpec board) found one root cause, confirmed by a falsification pass:

> The dashboard has a healthy shared-primitive culture for **overlays, shells,
> and interaction** (`packages/client-utils/`: `Dialog`, `Popover`, `Confirm`,
> `ActionList`, `useFocusTrap`, `useMobile`, `AgentCardShell`, `StatusPill`) —
> but that culture **never extended to the state-presentation + feedback
> layer**. Every surface hand-rolls empty states, loading states, status color,
> focus visibility, and input labels — so they drift below WCAG-AA and lean on
> hue + hover.

Hard evidence (repo-wide greps):

- `grep export (EmptyState|Skeleton|FocusRing|focus-ring)` across all packages →
  **zero matches**. The primitives do not exist.
- **No `<EmptyState>`** → 61 ad-hoc inline empties (`"No proposals"`,
  `"No messages yet"`, `"not found"`), most missing the NN/g empty-state pattern
  (name the value → shape of success → one CTA).
- **No `<Skeleton>`** → 55 `animate-spin` spinners vs 13 pulses; content-layout
  loads (chat history `ChatView.tsx:625`, board changes) use centered spinners
  where skeletons belong (NN/g skeleton-screens; Doherty).
- **No focus-visibility utility** → 39 `focus:outline-none`, the replacement
  almost always a weak 1px `focus:border-*` swap (fails WCAG 2.2 §2.4.11 Focus
  Appearance). Irony: `useFocusTrap` exists (focus *management*) but no focus
  *visibility* helper.
- **Color-only status** in 3 places (session-card rail/dot, composer
  `ArtifactChip` done/todo, board `STATE_COLORS`) — fails WCAG 2.2 §1.4.1.
  Irony: `StatusPill` exists, yet the board re-rolls its own `STATE_COLORS`.
- Icon-only buttons (`Send`, `Pi Resources`, `ArtifactChip`) lack `aria-label`
  (WCAG §4.1.2); identity lives in hover `title` (absent on touch / the PWA).

The fix is cheaper and more in-character than a redesign: **extend the existing
`client-utils` layer with the missing state/feedback primitives + an adoption
lint**, then refactor surfaces onto them. This rides a pattern the team already
practices.

## What Changes

- **NEW** `packages/client-utils/src/EmptyState.tsx` — a primitive that takes
  `{ title, body?, icon?, action?, secondaryAction? }` and renders the NN/g
  empty-state pattern (value-framed heading, optional ghost/shape-of-success
  slot, at most one primary CTA + one escape hatch). Replaces ad-hoc inline
  empties.
- **NEW** `packages/client-utils/src/Skeleton.tsx` — a content-shaped loading
  primitive (`<Skeleton variant="text|card|bubble|row" count? />`) honoring
  `prefers-reduced-motion` (static shimmer when reduced). For content-layout
  loads; spinners remain for short blocking actions only.
- **NEW** a `.focus-ring` utility in `packages/client/src/index.css` (≥2px,
  ≥3:1 against adjacent colors, `:focus-visible` scoped) + a tiny
  `focusRing` className export from `client-utils`. Replaces the ad-hoc
  `focus:outline-none` + 1px-border pattern.
- **MODIFY/EXTEND** `packages/client-utils/src/StatusPill.tsx` (or a new
  `statusPresentation` helper) so status is expressed via **semantic tokens +
  a mandatory non-hue channel** (icon/shape/glyph), not color alone. Mirrors
  the `--status-*` tokens introduced in `improve-dashboard-attention-routing`.
- **NEW** `packages/client/src/__tests__/state-feedback-adoption.test.tsx` —
  an axe smoke test over the new primitives (reuse the `@axe-core/react`
  pattern from `add-extension-ui-a11y-baseline`) PLUS a static-analysis ratchet:
  fail when a NEW inline empty / bare `focus:outline-none`-without-`.focus-ring`
  / color-only status is added in the covered surfaces.
- **REFACTOR (first targets, proving the primitives):** chat history →
  `<Skeleton variant="bubble">`; chat/board empties → `<EmptyState>`; composer
  `ArtifactChip` + board `STATE_COLORS` → status helper with non-hue channel +
  `aria-label`; search boxes + composer Send → `.focus-ring` + label/aria-label.
- **DOCUMENTATION** — add a "State & feedback primitives" section to
  `docs/architecture.md` (or `docs/ui-contract.md`) documenting when to use
  `EmptyState` vs `Skeleton` vs spinner, the `.focus-ring` rule, and the
  status-presentation convention; add `docs/file-index-client.md` rows for the
  new files.

## Impact

- Affected specs:
  - `client-utils-empty-state` (ADDED)
  - `client-utils-skeleton` (ADDED)
  - `client-utils-focus-ring` (ADDED)
  - `client-utils-status-presentation` (ADDED)
- Affected code: `packages/client-utils/src/*` (new primitives), `index.css`,
  and first-target refactors in `ChatView.tsx`, `OpenSpecBoardView.tsx`,
  `ComposerSessionActions.tsx`, `SessionList.tsx`.
- **Relationship to siblings:**
  - `improve-dashboard-attention-routing` — slice #1; introduces `--status-*`
    tokens this change generalizes into the status-presentation primitive.
  - `add-extension-ui-a11y-baseline` — complementary; same conventions
    (non-color indicator, axe smoke test) applied to the *extension-UI slots*
    rather than `client-utils`. No file overlap.
- No server / protocol change. Client primitive layer + opt-in refactors.
