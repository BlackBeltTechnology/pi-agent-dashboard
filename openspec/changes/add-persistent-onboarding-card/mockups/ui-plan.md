# UI Plan — persistent onboarding card

Surface → tokens → states for `add-persistent-onboarding-card`.
Token authority: the `theme-system` skill + `packages/client/src/index.css`.
Mockup: `index.html` · states `?s=A..F` · `?theme=light` · `?bg=settings|session|landing` · `?collapsed=0|1`.

## Surface

One fixed overlay, mounted outside the content router in both shell branches
(`App.tsx:2144` mobile, `App.tsx:2253` desktop), beside `WorktreeInitStack`.
Anchored bottom-right. Two renderings: expanded card and collapsed pill.

## GROUND findings (shipped code, measured)

**The severity ramp already exists and is the right substrate.** `index.css:97-111`
defines `--severity-{error,warning,success,info,neutral}-{bg,fg,border}` as
`color-mix` over each theme's own accents and backgrounds, explicitly tuned to
clear a 3:1 floor across 9 themes × light/dark. No new tokens are needed, and
inventing any would repeat the `--amber` / `--amber-soft` defect documented in
`warn-unreachable-trusted-networks` (tokens referenced but never defined, so the
hardcoded fallback ships and fails light-theme contrast).

**The shipped filled-button idiom fails AA in dark.** `LandingPage.tsx:74-79`
uses an outline treatment, but the obvious "primary button" reflex —
`#fff` on `--accent-primary` — measures **3.68:1** in dark. Measured, not assumed:

| Candidate fill / label | Dark | Light |
|---|---|---|
| `#fff` on `--accent-primary` | **3.68:1** ✗ | 5.17:1 ✓ |
| `--bg-primary` on `--severity-info-fg` | **9.72:1** ✓ | **8.82:1** ✓ |
| `--link` text on `--bg-secondary` (outline) | 7.25:1 ✓ | 4.95:1 ✓ |

The card uses the second: it is the same ramp the rest of the card already
references, and it is the only candidate that clears AA comfortably in both themes.

**`--text-tertiary` and `--text-muted` are not safe on tinted step rows.**
Measured on `--severity-info-bg`: tertiary is 3.75:1 dark / 3.54:1 light. On the
card surface, `--text-muted` is 2.59:1 / 2.23:1. Both were in the first draft;
both are now `--text-secondary`.

## Tokens (all pre-existing — none added)

| Element | Token | Dark | Light |
|---|---|---|---|
| Card surface | `--bg-secondary` + `--border-secondary` | matches `WorktreeInitStack` | — |
| Card header | `--bg-tertiary` + `--border-subtle` | — | — |
| Done row | `--severity-success-bg` / `-fg` / `-border` | 8.25:1 | 5.45:1 |
| Active row | `--severity-info-bg` / `-border`, label `--text-primary` | 11.76:1 | 13.74:1 |
| Active numeral badge | fill `--severity-info-fg`, glyph `--bg-primary` | 9.72:1 | 8.82:1 |
| Locked numeral chip | `--severity-neutral-bg` / `-border`, glyph `--text-muted` | decorative | decorative |
| All body text | `--text-secondary` | ≥6.83:1 | ≥7.69:1 |
| Progress counter | `--text-secondary` on `--severity-neutral-bg` | 7.69:1 | 8.55:1 |
| CTA | fill `--severity-info-fg`, label `--bg-primary` | 9.72:1 | 8.82:1 |
| Focus ring | `.focus-ring` utility (`--focus-ring`) | 5.01:1 | 4.95:1 |

## States

| id | Step states | Rendering |
|---|---|---|
| A | active / locked / locked | first run, one actionable item |
| B | done / active / locked | after credentials save — reached without navigating back |
| C | done / done / active | last action remains, shown over a session route (`raised`) |
| D | done / done / done | **card absent** — `allDone` unmounts it |
| E | done / active / locked | collapsed pill |
| F | active / locked / locked | landing route: overlay + `LandingPage` cards both visible (D3) |

## Layout rules

- Expanded: `320px`, `max-width:calc(100vw-2rem)`, bottom-right, `z-30`.
- `raised` modifier lifts the card to `bottom:80px` on routes that own a composer.
  Driven by one boolean at the mount site (`!!selectedId`) — no new plumbing.
- `< 640px`: full-width-minus-margins, **default collapsed**, all targets ≥44px
  (WCAG 2.2 SC 2.5.8). ≥640px: 28px targets (clears the 24px AA minimum).
- `role="complementary"` + `aria-labelledby`. Not a dialog, no focus trap.
- Step status is real text in the accessibility tree (`.sr-only` "— done" /
  "— locked" / "— next step"), never an `aria-label` on a plain `div` and never
  a decorative pseudo-element alone.

## Placement comparison (evidence, `?pos=`)

The mockup keeps all three anchors selectable so the rejection is reproducible,
not just asserted. Default is `br`; the others exist only for comparison. A red
dashed outline marks what each anchor covers.

| `?pos=` | Anchor | Covers | Verdict |
|---|---|---|---|
| `br` (default) | bottom-right | nothing; composer resolved by `raised` | **chosen** |
| `tl-content` | top-left of content area | page heading + first rows of the destination the user just navigated to | rejected |
| `tl-view` | top-left of viewport | sidebar `SessionList` header + rows; on mobile the `HamburgerButton` (`MobileOverlay.tsx:15`, `top-2 left-2 z-50`) | rejected |

Corner occupancy across the shell: top-left = sidebar / hamburger; top-right =
`Toast` + `SpawnErrorToastHost` (`z-50`); bottom-left = sidebar footer;
bottom-right = `WorktreeInitStack` only under ≥2 concurrent inits. Bottom-right is
the only corner that is usually empty.

## Deliberately NOT done

- No new CSS custom properties (D7).
- No dismiss control (D4) — completion is the dismissal.
- No shared bottom-right dock refactor (D5) — deferred until a third overlay exists.
- No top-left placement (D6) — evaluated in-mockup and rejected on evidence.
