# helpers/computed-contrast.ts — index

In-page probes ported from `mockups/ux-probe.cjs`: `measureText` (canvas-resolved fg over composited bg stack), `contrastFailures`, `sizeFailures`, `buttonBoxes`, `resolveColor`, `ownBackground`, `colorDistance`, `buttonsWithoutFocusIndicator`, `setThemeMode`. See change: align-ui-with-theme-tokens.

`TextMeasure.srOnly` (inside `.sr-only`): `contrastFailures` + `sizeFailures` skip it, `measured` still counts it. `contrastRatio(fg,bg)` node-side WCAG ratio; `elementColors(el)` composited fg + effective bg of one element (for `aria-hidden` text `measureText` skips). Overflow probe: pure `overflowOf(root, items)` (effective box = rect ∩ clipping ancestors; 0.5 px tolerance; `topExempt` ignores TOP only; one entry per offending edge, `<where> <edge> +<px>px`) + in-page `overflowFailures(root, topExemptSelector?)` collector. See change: fix-slot-pill-legend-and-stale-overflow.

`nonTextFailures(scope, floor=3)` async: visible `svg` `color` + `.animate-spin` `border-top-color` vs composited ancestor backdrop (canvas path of `measureText`); returns failing-graphic lines, empty = pass. See change: fix-folder-card-pill-contrast.
