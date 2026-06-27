/**
 * `focusRing` — the className string for the shared `.focus-ring` utility
 * defined in `packages/client/src/index.css`. Scoped to `:focus-visible`
 * (keyboard focus only, never mouse-click), ≥2px effective thickness, ≥3:1
 * contrast against adjacent colors.
 *
 * Replaces the ad-hoc `focus:outline-none` + 1px `focus:border-*` pattern.
 * Rule: WCAG 2.2 §2.4.7 / §2.4.11.
 * See change: extend-client-utils-state-feedback-primitives.
 */
export const focusRing = "focus-ring";
