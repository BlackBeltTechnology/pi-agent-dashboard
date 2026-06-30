# Design — card state sweep gradient

## Decision: seamless single-band sweep (candidate A)

Explored four treatments in the mockup:

| | Motion | Verdict |
|---|---|---|
| A · Sweep | one soft double-wide band glides L→R, seamless loop | **chosen** — matches pending-prompt feel, removes hard edges |
| A2 · Sweep-flow | continuous train of bands | calmer but less "single pulse" identity |
| B · Breathe | whole-card tint opacity pulse | too ambient, low directionality |
| C · Edge-glow | color hugs the left rail | best raw legibility but reads as a different signal |

Picked **A**: closest to the user's stated reference ("same look/feel as the pending sent prompt") while solving the readability problem.

## The fluidity fix (why the first attempt stuttered)

A naive single band with `ease-in-out` + `translateX(-66% → 166%)` decelerates to ~0 velocity at the edge, then snaps position back to start → visible jump.

Fix mirrors the original stripe technique:

```
over-wide layer  [ ──soft band──  gap  ──soft band── ]   repeating-linear-gradient, period P
     left:-P  ├──────────── card ────────────┤  right:-P
translateX(0 → P)  LINEAR, exactly one period
```

- position `0` and position `P` are pixel-identical → loop is invisible.
- constant velocity → no accel/decel snap.
- `transform`-only → compositor-cheap (no per-frame repaint), consistent with `throttle-idle-ui-animations`.

Period `460px` (> card width) keeps a single-band "pulse" identity with a gentle gap; the band is double-wide (soft edges at `60`/`400` around center `230`) for a broad slow wash rather than a thin streak.

## Color + state mapping (unchanged)

| state class | overlay class | color |
|---|---|---|
| `card-working-pulse` | `card-stripes-running` | amber `234 179 8` |
| `card-unread-pulse` | `card-stripes-unread` | cyan `34 211 238` |
| `card-input-stripes` | `card-stripes-input` | purple `168 85 247` |

Band alpha ~`.16`–`.22`, flat tint underlay ~`.05`. Precedence (ask_user > streaming > unread) and `deriveProposalCardState` are untouched.

## Selected-card interaction

Selected cards layer the rotating rainbow neon ring/glow (`card-ring-fx` + `card-glow-fx`, `neon-rotate 13s`) over the status sweep. Verified in the mockup's 4th column: the rainbow stays at the rim, the status sweep washes behind the content — the two channels do not muddy. One watch item: the rainbow shares a cyan stop with the unread state, so a *selected + unread* card is the lowest-contrast overlap; acceptable at current alphas.

## Reduced motion

`@media (prefers-reduced-motion: reduce)` → drop the `transform` animation, keep a static tinted background so the state cue survives. Mirrors current stripe behavior.
