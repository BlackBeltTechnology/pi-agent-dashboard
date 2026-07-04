# Design — add-panel-elevation-system

## Context

Goal: make folder / session titles read as "more stunning and elevated," validated across light **and** dark. The exploration produced 8 standalone HTML mockups (served locally during the explore session) comparing treatments against the real theme tokens (`packages/client/src/lib/themes.ts`) and the real selected-card treatment (`SessionCard.tsx` + the `card-glow-fx` / `card-ring-fx` rotating rainbow in `index.css`).

## Guiding principle: separate ELEVATION from ATTENTION

The central design decision. The two follow opposite rules and must not be blended:

- **Elevation** (depth) → universal, neutral, structural. Apply everywhere. Delivered by typographic weight + panel bevel.
- **Attention** (color) → scarce, reserved, redundant-coded. Applied only where a status demands it; never sprayed. Deferred here.
- **Selection** → already the single most-differentiated element (Von Restorff isolation effect). Leave it alone; do not enter a loudness arms race.

Principles cited: Laws of UX (Von Restorff / isolation, Gestalt Common Region, Uniform Connectedness), Nielsen #8 (aesthetic-minimalist), WCAG 1.4.1 (Use of Color), 1.4.3 (contrast).

## Decision 1 — Typography carries "stunning" cross-mode

Session name `text-sm` weight-400 → weight 600 (`font-semibold`). This is the only "elevated" change that reads identically light and dark, and it *raises* legibility (WCAG-positive). It is what the original "stunning titles" instinct was reaching for. Folder title already weight 600, so this aligns the two.

## Decision 2 — Depth is a NEUTRAL panel bevel, not a title shadow

Cards + folder header bars get `inset 0 1px 0 var(--elevation-rim)` (top-edge highlight) plus a deeper drop (`0 4px 8px var(--shadow-card)`). Reads as a raised surface (Common Region) without touching a single glyph → zero muddiness, zero slop risk, works in both modes.

`--elevation-rim` is per-mode and theme-agnostic (white-based, like the existing `statusVars` pattern): dark `rgba(255,255,255,0.10)`, light `rgba(255,255,255,0.9)`. It does **not** vary per named theme, so it is defined once per mode rather than added to all 18 theme maps.

## Decision 3 — Do NOT touch selection

Selection is already an animated rainbow full-perimeter glow + blue border + tint. By Von Restorff it must stay the most-different element. Because Tier-1 adds no competing color, selection keeps its salience for free — no glow boost required. (A glow boost was validated and rejected; see below.)

## Validation record (what the mockups proved)

| Mockup | Question | Result |
|--------|----------|--------|
| 4-treatment (light/dark) | flat vs soft vs emboss vs glow on titles | title shadow invisible on light, subtle on dark; emboss/glow add nothing |
| all-9-themes × light/dark, α sliders | any palette where soft-lift goes muddy? | no muddy dark palette; on light shadow is a no-op at safe α and dirty above — **no good light window** |
| depth-ladder | how much 3D before it tips? | extruded stacked shadow = cheese (both modes); **panel bevel** = clean depth |
| accent-bevel P0–P4 | status-colored rim intensity | P1 rim tasteful but P4 = neon slop; rim-on-all = confetti |
| selection-conflict A/B/C | does accent rim reduce selected visibility? | rim-on-all dilutes selection; rim-on-needs-you-only survives; folder-only safest |
| selected-glow G0–G3 | can we boost selected glow? | G1 bloom wins; G3 = light-bulb, swallows meta text (WCAG fail) |
| selected-glow-light L0–L3 | selection in light? | glow washes/smudges on white; light needs border+tint+lift+colored-drop, not glow |
| tier1 before/after | the shipped scope | weight 600 + neutral bevel = clean, dimensional, selection preserved, no color |

## Deferred / Rejected

- **Tier 2 — status accent rim (needs-you only)**: DEFERRED. Defensible only as redundant coding (WCAG 1.4.1 — the status rail shape already carries it) and under strict signal economy. Ship only if real usage shows needs-you gets missed. Not in this change.
- **Tier 3 — boost selected glow**: REJECTED. Only tempting *because* a rim was added; boosting it starts a loudness arms race. Selection already wins.
- **Title text-shadow (soft/engrave/emboss)**: REJECTED — dark-only, muddy/dirty on light, adds nothing the bevel + weight do not.
- **Extruded 3D text**: REJECTED — reads as a 2008 game logo in both modes (anti-slop signature).
- **P4 neon rim / background washes / dark-glow ported to light**: REJECTED — slop signatures and/or WCAG contrast failures.

## Token / file surface

- `--elevation-rim` defined per-mode. Cleanest home: `packages/client/src/index.css` `:root` (dark) + `[data-theme="light"]` override, since it is theme-independent. (If theme application strips non-`CSS_VAR_KEYS` custom props at runtime, fall back to adding it to the shared merge in `themes.ts`; verify during implementation.)
- `packages/client/src/components/SessionCard.tsx` — desktop (~line 647) + mobile (~line 535) container box-shadow; session-name span weight (~line 697 desktop, ~line 543 mobile).
- `packages/client/src/components/WorkspaceHeader.tsx` + folder header bar — box-shadow.

## Risks

- **Halo/edge bleed**: bevel uses only `inset` + a modest drop; no wide outer blur, so no neighbor-bleed risk (unlike the rejected glow bloom).
- **Light bevel subtlety**: on pure-white surfaces the inset highlight is invisible, but cards/folder bars sit on `--bg-tertiary` (tinted), where it reads. Verify on the lightest themes (GitHub, Base) during implementation.
- **Contrast**: no text-shadow, no tint change → text contrast is unchanged or improved (weight 600). No WCAG regression.
