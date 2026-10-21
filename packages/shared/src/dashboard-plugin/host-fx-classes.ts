/**
 * Host-owned global CSS FX class names a plugin may apply by name (session-card
 * stripes / glow / ring). The rules live in `packages/client/src/index.css`, gated
 * by `prefers-reduced-motion` and the `data-fx-*` user toggles. Plugin code uses
 * these constants instead of literal class strings so a rename is one edit and the
 * host API surface snapshot (`host-api-surface.json`) records every value.
 *
 * See change: decouple-plugins-from-core (design D6/D7).
 */
export const HOST_FX_CLASSES = {
  /** Diagonal-stripes overlay base. */
  stripes: "card-stripes-fx",
  /** Animated modifier of `stripes` for a running card. */
  stripesRunning: "card-stripes-running",
  /** Static neon glow overlay of a selected card. */
  glow: "card-glow-fx",
  /** Wider outer glow layer, paired with `glow`. */
  glowOuter: "card-glow-fx-outer",
  /** Rim ring of a selected card. */
  ring: "card-ring-fx",
} as const;

export type HostFxClass = (typeof HOST_FX_CLASSES)[keyof typeof HOST_FX_CLASSES];
