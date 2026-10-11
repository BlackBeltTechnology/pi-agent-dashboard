## Why

deck3d moves the camera between slides with one motion: a straight eased lerp (`dolly`). `swing` adds a sideways
bulge, `fade` jumps at the half-way point without fading, `cut` snaps, and the corpus ids `iris` and `flythrough`
play exactly like `dolly`. On a `tunnel` or `line` rail every slide change therefore looks the same, and an author
cannot shape the move between two scenes (circle the slide, rise like a crane, bank into a turn). Real decks
(Raktar360, Zenit) asked for varied, choreographed moves between scenes. The variety has to stay deterministic
(`setTime`, `check`, snapshots) and must not break per-slide framing, which every rail guarantees today.

## What Changes

- New built-in camera motions for the `transition` field: `revolve` (arc around the arriving slide; `orbit` is taken by a motion card), `crane`
  (rise over the gap, descend onto the slide), `bank` (dolly with a roll into and out of the move), `swing`
  (made official), and `path` (author keyframes, below).
- `fade` becomes a real screen fade (to the background colour and back, camera jumps while covered).
  `flythrough` becomes a low pass through the gap with a gentle bank; `iris` becomes a circular screen-space
  reveal. No id plays as a silent alias any more.
- Per-slide precomputed camera path: `overrides.slides["<id>"].cameraPath = { keys: [...], ease? }`. Keys are
  offsets in a travel frame (from-camera → to-camera), so the path is rail-independent and always lands exactly
  on the arriving slide's anchor. The curve is computed once when the move starts (centripetal Catmull-Rom), then
  sampled by eased time — fully deterministic.
- Optional per-key `roll` (deg), `fov` (deg) and `look` (0 = keep looking at the leaving slide, 1 = the arriving
  slide).
- Deck-level `transitionCycle: string[]`: slides without their own `transition` cycle through the list in order
  (slide index modulo length) — variety without touching every slide.
- Navigating backwards plays the arriving slide's motion reversed (same curve, time 1→0), so back/forward are
  mirror images.
- Both slides of a move stay un-culled for its whole duration (a far-swinging path no longer blanks the scene).
- IR schema, `validate`, HUD list, the field reference and the deck3d skill document every new value.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `deck3d-ir`: adds `cameraPath` (per slide), `transitionCycle` (deck), and the closed set of transition ids.
- `deck3d-render`: adds transition camera-motion behaviour (each kind, path sampling, reverse play, cull hold,
  determinism under `setTime`).
- `deck3d-effects`: adds `transition`-kind cards for the new motions; `fade`/`iris`/`flythrough` cards describe
  their real behaviour.
- `deck3d-skill`: skill documents transition kinds, `cameraPath` and `transitionCycle` with an example.

## Impact

- `packages/deck3d/src/runtime/index.ts` (`goTo`, `stepAnim`, `cullNeighbours`), new
  `packages/deck3d/src/runtime/transition.ts` (motion kinds + path curve, pure functions), `runtime/hud.ts`
  (`TRANSITIONS`), `runtime/post.ts` or a screen overlay for `fade`/`iris`.
- `packages/deck3d/src/ir/schema.json`, `ir/types.ts`, `ir/defaults.ts`, generated
  `.pi/skills/deck3d/reference/ir-fields.md`.
- `packages/deck3d/src/fx/*.meta.json` (+ trivial `*.ts`) for `swing`, `revolve`, `crane`, `bank`, `path`.
- `.pi/skills/deck3d/SKILL.md`.
- Compatibility: existing decks keep working — `dolly` and `cut` unchanged, `swing` unchanged; `fade`, `iris`,
  `flythrough` change look (they were placeholders). No dependency added. Rollback = revert the package; IR files
  that use the new fields would then fail `validate` (unknown key), which is the intended loud failure.
