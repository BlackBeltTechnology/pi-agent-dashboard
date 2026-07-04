# add-panel-elevation-system

## Why

Session and folder titles currently render flat: the session name is `text-sm` weight-400 (`SessionCard.tsx`), and cards lift only via a single `shadow-md shadow-[var(--shadow-card)]` drop shadow. The result reads as low-hierarchy and undifferentiated — titles do not stand out, and cards do not feel like distinct raised surfaces.

The original ask was "make folder / session titles more stunning and elevated" via a title shadow. An 8-mockup validation pass (light **and** dark, all 9 themes) proved that a **text-shadow on titles is the wrong lever**: it is a dark-only affordance that is either invisible (`α ≈ 0.06`) or dirty (`α ≥ 0.28`) on light backgrounds, and never produces "lift" for dark-on-light text. The validation converged instead on two changes that are cross-mode, accessible, and slop-proof:

1. **Typography** — bump the session name to weight 600. This is the single change that reads identically in light and dark and *improves* legibility (WCAG-positive), unlike text-shadow.
2. **Structural depth** — give cards and folder header bars a neutral panel bevel (inset top-highlight + deeper drop shadow) so each reads as a raised surface (Gestalt Common Region), with **no added color**.

Color-based emphasis (status-tinted rims, boosted selection glow) was explicitly validated and **deferred / rejected** to avoid a visual "loudness arms race" between selection and status (see `design.md`). This change ships only the neutral, universal Tier-1 foundation.

## What Changes

- **ADDED**: A per-mode elevation-highlight token `--elevation-rim` (dark: `rgba(255,255,255,0.10)`; light: `rgba(255,255,255,0.9)`) used for the inset top-highlight of beveled panels. Theme-agnostic (white-based), defined once per mode.
- **MODIFIED**: Desktop + mobile session card container box-shadow in `packages/client/src/components/SessionCard.tsx` — from `shadow-md shadow-[var(--shadow-card)]` to a neutral bevel: `inset 0 1px 0 var(--elevation-rim)` + a deeper drop (`0 4px 8px var(--shadow-card)`), preserving existing hover/selected behavior.
- **MODIFIED**: Folder / workspace header bar box-shadow (`WorkspaceHeader.tsx` and the folder header) to the same bevel recipe (`inset 0 1px 0 var(--elevation-rim)` + `0 2px 4px var(--shadow-card)`).
- **MODIFIED**: Session name typography — add `font-semibold` (weight 600) to the session-name span in both the desktop and mobile card layouts. Folder title is already weight 600.
- **UNCHANGED (deliberate)**: The selected-card treatment (blue border + tint + ring + rotating rainbow glow) is **not** touched — it remains the single most-differentiated element (Von Restorff), so nothing competes with it and no glow boost is needed.

Out of scope (deferred — see `design.md` "Deferred / Rejected"):

- Status-colored accent rim (Tier 2 — gated on real-usage evidence that needs-you gets missed).
- Any boost to the selected-card glow (Tier 3 — rejected as a loudness arms race).
- Title text-shadow / engrave / extrude, background washes, per-theme token divergence for the rim.
- No server, protocol, or bridge changes. Pure client CSS + one token.

## Mockups (validation record)

Eight standalone HTML mockups produced during the explore session are checked in under [`mockups/`](./mockups/). They use the real theme tokens (`packages/client/src/lib/themes.ts`) and the real selected-card treatment. Open any in a browser (or serve the folder). Ordered as the exploration ran; `tier1.html` is the shipped scope. See `design.md` for the per-mockup findings table.

| Mockup | What it validates |
|--------|-------------------|
| [`index.html`](./mockups/index.html) | 4 title treatments (flat / soft / emboss / glow) · light vs dark · theme switcher |
| [`all-themes.html`](./mockups/all-themes.html) | All 9 themes × light/dark × flat vs soft-lift, with α sliders to find the muddy boundary |
| [`depth-ladder.html`](./mockups/depth-ladder.html) | Depth ladder: flat → engrave → raised → **extruded (cheese)** → panel bevel |
| [`accent-bevel.html`](./mockups/accent-bevel.html) | Status-colored rim intensity P0→P4; where premium tips to neon slop |
| [`selection-conflict.html`](./mockups/selection-conflict.html) | Does an accent rim reduce selected-card visibility? (rim-on-all vs needs-you-only vs folder-only) |
| [`selected-glow.html`](./mockups/selected-glow.html) | Boosting the selected glow (dark) G0→G3; G3 = light-bulb / WCAG fail |
| [`selected-glow-light.html`](./mockups/selected-glow-light.html) | Selection emphasis in **light** (glow washes out → border+tint+lift+colored-drop) |
| [`tier1.html`](./mockups/tier1.html) | **The shipped scope** — before/after: weight 600 + neutral bevel, light + dark |
