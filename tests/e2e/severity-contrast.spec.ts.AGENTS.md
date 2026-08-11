# severity-contrast.spec.ts — index

L3 gate for `unify-message-severity-colors`. Sweeps 5 tiers × 9 themes × {light,dark} via `localStorage` theme-name/mode + reload; reads resolved `--severity-*` from probe elements (real browser resolves `color-mix`; parses `color(srgb …)` + `rgb()`). Asserts relative gate: accent ≥ 3:1 floor, `neutral` ≥ base, one documented exception tokyo-night/light `info` ≥ 2.5, ≥ 55/90 cells ≥ 4.5 AA; + F1 distinct bgs, F2 warning-hue≠working-yellow, F3 close = fg at reduced alpha.
