## Context

`goTo(i)` (runtime/index.ts) builds an `anim` record `{from, to, t, mode, dur, mid, look}` and `stepAnim(dt)`
writes `camState.pos/target` each frame: `lerp` + ease for every mode, `swing` adds a sin-shaped push away from
`mid`, `fade` jumps at t ≥ 0.5, `cut` short-circuits to `snapTo`. The camera itself then gets idle drift and
`lookAt(target)`; `cullNeighbours()` hides slide groups farther than `cullRadius(spacing, rail)` from the camera.
`setTime(t)` pins the clock and steps with dt = 1/60, which is what makes `check` deterministic. Transition ids are
an unvalidated string (HUD list: dolly, fade, iris, flythrough, cut).

## Goals / Non-Goals

**Goals:**
- Several visibly different camera motions, selectable per slide or cycled deck-wide.
- Author-defined keyframed paths that are rail-independent and always land exactly on the anchor.
- Deterministic: same IR + same `setTime` ⇒ same frame; reverse navigation mirrors forward.
- No regression for `dolly`/`cut`/`swing` decks; per-slide framing untouched.

**Non-Goals:**
- Physics / spring cameras, cameras driven by audio or scroll.
- Moving or re-anchoring slides (rails stay as they are).
- A visual path editor in the configurator (later change; the HUD only lists ids).
- Animating slide content during the move (local fx already do that).

## Decisions

1. **Pure motion module.** `runtime/transition.ts` exports `motion(kind, from, to, opts) → (u: 0..1) => {pos,
   target, roll, fov}`. `stepAnim` only advances `u` and applies the sample. Testable without WebGL; the existing
   modes are re-expressed through it (dolly = straight, swing = current formula) so behaviour is byte-identical
   for them. Alternative (more `if` branches in `stepAnim`) rejected: untestable, keeps growing.
2. **Travel frame for keys.** `F` = unit(from.cam → to.cam), `U` = world up orthogonalised against `F`,
   `R` = F × U; length `L` = |to.cam − from.cam|. A key `{t, offset:[r, u, f]}` maps to
   `lerp(from.cam, to.cam, t) + R·r·L + U·u·L + F·f·L` (offsets are FRACTIONS of the travel length), so the
   same path reads the same on `line`, `tunnel`, `orbit`, any spacing. Endpoints t = 0 and t = 1 are implied and
   pinned (offset 0), guaranteeing an exact landing. Absolute world coordinates rejected: they break on a rail
   or spacing change.
3. **Curve.** Centripetal Catmull-Rom (`THREE.CatmullRomCurve3`, type `centripetal`) through the implied
   endpoints + keys, built once in `goTo`; position sampled by arc length at `ease(u)`. `target` =
   `lerp(from.target, to.target, look(u))` where `look` interpolates the per-key `look` values (default: the
   global ease). `roll`/`fov` piecewise-smoothstep between keys, 0 / deck fov at the ends.
4. **Built-ins are canned paths.** `revolve`, `crane`, `bank`, `flythrough` are fixed key lists through the same
   path code (e.g. crane = `[{t:.5, offset:[0,.35,0]}]`, revolve = keys on a half-circle around `to.target`),
   so there is one sampling code path. Each accepts an `amount` param (scales offsets) via the corpus card.
5. **Roll** is applied after `lookAt` by rotating the camera about its local Z; idle drift is suppressed while
   `anim` is set (already the case for the lerp factor). **FOV** changes call `updateProjectionMatrix` and are
   restored at landing.
6. **Screen kinds.** `fade` and `iris` drive one fixed DOM `div` over the canvas (appended before the HUD):
   palette-background opacity for `fade`, a `radial-gradient` circular mask for `iris`; the camera jumps while
   fully covered (u = .5). A DOM layer covers bloom and every post pass with no renderer change (a post quad was
   the alternative; rejected as more code for the same look).
11. **Amount** is an IR knob `transitionAmount` (deck/slide, 0–2) rather than a card param: transition cards are
    never instantiated with params, so a card param would be unreachable.
12. **Id clash:** the corpus already has a `motion` card `orbit`, so the arc-around move is named `revolve`.
7. **Reverse.** When `target < cur` (prev navigation), the motion of slide `cur` (the one being left) is played
   with `u' = 1 − u` and from/to swapped; for `gotoSlide(n)` jumps over several slides the arriving slide's
   motion plays forward.
8. **Cull hold.** While `anim` is set, the from- and to-slide groups are forced visible; others still cull.
9. **Cycle resolution** happens in `parse`/defaults: effective transition = slide override ?? (cycle ?
   cycle[i % n] : defaults.transition). Recorded in the derived slide config so the HUD and check see it.
10. **Validation.** `transition` becomes an enum of corpus `transition` ids; `cameraPath` requires
    `transition: "path"` (validate error otherwise); key `t` strictly increasing in (0,1); `look` in [0,1];
    `roll` in [-45,45]; `fov` in [20,90]; max 8 keys.

## Risks / Trade-offs

- Wide paths can show unfinished scenery or the floor edge → `check` already renders mid-flight frames only at
  landing; add a `check --transitions` sample at u = .5 later (out of scope, noted).
- Roll + bloom can shimmer on thin lines → default rolls kept small (bank ±8°).
- Changing `fade`/`iris`/`flythrough` alters existing decks that named them → called out in proposal; they were
  placeholders identical to `dolly`.
- Camera-pinned local fx (e.g. Raktar360 badge) assume camera up = world up → with roll they tilt with the
  camera, which reads as intended (screen-locked); documented in the skill.
