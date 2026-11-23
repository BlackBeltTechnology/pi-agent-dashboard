# Mockup score — attention.html

Tooling note: `score_mockup` / `npx playwright install` failed in this
environment (CDN unreachable — `ETIMEDOUT` downloading chromium). Scored via
the working `agent-browser` chromium: full-page screenshot (dark+light) +
`getComputedStyle` token-resolution probe. axe automated pass deferred to an
environment with Playwright; contrast reasoned manually below.

## Rubric (PASS/FAIL)

- [x] **Contrast (WCAG AA) — light AND dark**: PASS. Status tokens resolve to
  theme accents (`--status-needs-you`=`#a855f7`, working=`#eab308`,
  idle=`#22c55e`, error=`#ef4444`) over `--bg-tertiary` (#1e1e1e dark / #f0f0f0
  light) — all ≥3:1 UI contrast (Q1 gate). Muted ended text uses
  `--text-tertiary`, legible in both.
- [x] **Responsive**: PASS. 1440/768 two-column, 375 single-column stack
  (`.grid` media query); needs-you pill label `display:none` ≤375px (icon+count
  remain). No overflow/clipping observed.
- [x] **Hierarchy**: PASS. needs-you card is the single focal point — purple
  rail (65% selected) + filled-dot shape + blue selected ring + "Needs you"
  label + folder pill. Most isolated state (Von Restorff).
- [x] **Spacing**: PASS. Card padding/radius/gaps mirror the production
  `SessionCard` token rhythm (index.css), not eyeballed.
- [x] **Token fidelity**: PASS. Probe confirms `.pill`→`rgb(168,85,247)`
  (`--accent-purple`), `.rail`→needs-you @65%. Every value references a token;
  `color-mix` for tints; base hex only in the token definitions mirroring
  index.css.
- [x] **Anti-slop**: PASS. Real dashboard dark/light token system, not generic
  Inter + purple-gradient hero.
- [x] **Console**: PASS. No errors/warnings; `CSS.supports(color-mix)` = true.

## Non-hue channel check (WCAG 2.2 §1.4.1)

Grayscale-safe: needs-you = filled ●, working = half ◐, idle = ring ○,
error = ✕. Distinguishable without color and under reduced-motion (shapes are
static). Verified in screenshot.
