# UI plan — replay-in-flight pill (post-ship UX review)

Reviewed against the **shipped** implementation (`736c1d269`, PR #458), not a
proposal. Ground: `ChatView.tsx:1426-1444` + tokens from `index.css`
(`:root` dark, `[data-theme="light"]`). Mockup: `index.html` (variants A/B/C,
both themes, real 300ms delay).

## Surfaces → tokens → states

| Surface | Token | State |
|---|---|---|
| pill container | `--bg-tertiary` (shipped) → `--bg-surface` (B/C) | visible while `showReplayPill && messages.length > 0` |
| pill border | `--border-subtle` (shipped) → `--text-tertiary` (B/C) | static |
| label + icon | `--text-secondary` (shipped) → `--text-primary` (B/C) | static |
| elevation | `shadow-lg` over `--shadow-card` | static |
| band scrim (C only) | `linear-gradient(to top, var(--bg-primary), transparent)` | visible with band |
| motion | `animate-spin` 1s linear infinite | must stop under `prefers-reduced-motion` |

No new token required — B and C reuse tokens already in `index.css`.

## Rubric

Scored per variant, both themes, 375 / 768 / 1440. `A` = shipped.

| Criterion | A (shipped) | B (minimal fix) | C (tail band) |
|---|---|---|---|
| Contrast AA — text | PASS 7.69:1 dark / 8.55:1 light | PASS 6.62 / 7.38 | PASS 6.62 / 7.38 |
| **Contrast SC 1.4.11 — surface edge** | **FAIL 1.19:1 dark, 1.14:1 light; border 1.42:1 (needs 3:1)** | PASS 5.01 / 4.48 | PASS 5.01 / 4.48 |
| **Responsive @375** | **FAIL — pill fully occludes the scroll-to-bottom control** | PASS | PASS |
| Hierarchy | PASS — single focal point | PASS | PASS |
| Spacing | PASS — token scale | PASS | PASS |
| Token fidelity | PASS — all `var()` | PASS | PASS |
| Anti-slop | PASS — reuses the repo's own pill idiom | PASS | PASS |
| **Reduced motion** | **FAIL — infinite spin, no `prefers-reduced-motion` branch** | PASS | PASS |
| Spec fidelity ("anchored to the bottom of the message list") | PARTIAL — corner FAB, not the tail | PARTIAL | PASS |
| Console | PASS | PASS | PASS |

## Defects, by severity (Nielsen 0–4)

**D1 · severity 3 — the pill hides a control on mobile.**
Shipped pill is `absolute bottom-4 right-4 z-10`; the scroll-to-bottom button is
`absolute bottom-4 left-1/2 -translate-x-1/2 z-10` (`ChatView.tsx:1438` vs
`:1460`). At 375px the pill spans x=173..359 and the button x=171.5..203.5 — the
pill wins the paint order at equal `z-10` and **completely covers it**. Cited:
Nielsen #1 *Visibility of system status* — an affordance for one status erases
another. Fix: lift the pill clear (`bottom-16`) or move to the tail band.

**D2 · severity 3 — no perceivable surface edge (WCAG 2.1 SC 1.4.11).**
`--bg-tertiary` on `--bg-primary` is 1.19:1 dark / 1.14:1 light; the
`--border-subtle` hairline resolves to ~1.42:1. Threshold is 3:1 for the visual
boundary of a UI component. `shadow-lg` does nothing on a near-black background.
Visible in the screenshots: the pill reads as text lying on a message bubble.
Fix: `--bg-surface` + a `--text-tertiary` hairline → 5.01:1 dark / 4.48:1 light.

**D3 · severity 2 — motion ignores `prefers-reduced-motion`.**
`animate-spin` runs indefinitely. `index.css` already ships six
`@media (prefers-reduced-motion: reduce)` blocks, so this breaks an established
repo convention as well as the vestibular-safety guidance behind WCAG 2.3.3.
Fix: drop the rotation under the query; `role="status"` still announces.

**D4 · severity 1 — spec says tail, code says corner.**
The spec requires the indicator "anchored to the bottom of the message list,
visually where the not-yet-delivered events will land". Replay fills the tail
across the full width; a bottom-right FAB points at a corner. Not wrong, but C
is the literal reading. Gestalt *proximity* argues for the tail.

**D5 · severity 0 — redundant accessible name.**
`aria-label` duplicates the visible text verbatim, so the label overrides
identical content. Harmless; drop the `aria-label` and let the content be read.

## Recommendation

**B** closes the two gating defects (D1, D2) and D3 with a ~4-line diff, keeps
the shipped corner idiom, and needs no new token — the low-risk fix for a change
that already merged.

**C** additionally resolves D4 and is the strongest UX (the affordance sits where
the missing content is, and the scrim implies continuation), but it is a larger
visual change to a surface that just shipped.

Either way D1+D2 should not stay: one hides a control on mobile, the other fails
an accessibility floor.
