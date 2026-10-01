# effects.md — index

Pull-only condensed map. Source: reference/effects.md. Effect → kind, cost, modes, topics.

## background
- `aurora` — cost 3; both; params speed.
- `city-grid` — cost 3; both; topic work,sales; params density,speed.
- `constellation` — cost 2; both; topic timeline; params density.
- `data-columns` — cost 3; both; topic data; params columns.
- `globe-arcs` — cost 3; both; topic geo; params density,speed.
- `glyph-rain` — cost 3; dark; topic security; params speed.
- `grid-horizon` — cost 2; both; topic timeline; params spacing.
- `hex-grid` — cost 2; both; topic timeline; params scale.
- `market-tape` — cost 2; both; topic money,data; params density,speed.
- `neural-mesh` — cost 3; both; topic ai; params density,speed.
- `orbit-agents` — cost 3; both; topic agents; params density,speed.
- `paper-stack` — cost 2; both; topic process; params density,speed.
- `particles` — cost 1; both; params intensity.
- `rings` — cost 1; both; params intensity.
- `server-racks` — cost 3; both; topic compute; params density,speed.
- `starfield` — cost 2; both; params density,speed.
- `swarm` — cost 2; both; params intensity.
- `tokens` — cost 1; both; params intensity.
- `vault-glyphs` — cost 2; both; topic trust,security; params density,speed.

## post
- `bloom` — cost 2; both; params intensity.
- `chromatic-aberration` — cost 2; dark; params offset.
- `depth-of-field` — cost 3; both; params focus.
- `film` — cost 1; both; params intensity.
- `god-rays` — cost 3; dark; params intensity.
- `n8ao` — cost 2; both; params radius.
- `selective-bloom` — cost 3; both; params intensity.
- `smaa` — cost 1; both; params intensity.
- `vignette` — cost 1; both; params darkness.

## material
- `emissive` — cost 1; both; params intensity.
- `glass` — cost 2; both; params intensity.
- `holo-fresnel` — cost 3; dark; params power.
- `iridescent` — cost 3; both; params shift.
- `matcap` — cost 2; both; params intensity.
- `metal` — cost 1; both; params intensity.
- `wireframe-overlay` — cost 2; both; params intensity.

## light
- `accent-cycle` — cost 2; both; params speed.
- `fog` — cost 1; both; params intensity.
- `lightformers` — cost 2; both; params intensity.
- `mirror-floor` — cost 2; both; params intensity.
- `room-ibl` — cost 1; both; params intensity.
- `soft-shadows` — cost 1; both; params intensity.
- `volumetric-spot` — cost 3; dark; params intensity.

## motion
- `camera-drift` — cost 2; both; params intensity.
- `float` — cost 1; both; params amplitude.
- `orbit` — cost 1; both; params speed.
- `stagger-reveal` — cost 2; both; params step.
- `trail` — cost 2; both; params length.

## edge
- `dashed-flow` — cost 1; both; params dash.
- `glow-tube` — cost 2; both; params intensity.
- `particle-stream` — cost 2; both; params count.
- `signal-pulse` — cost 1; both; params intensity.

## transition
- `dolly` — cost 1; both; params intensity.
- `fade` — cost 1; both; params intensity.
- `flythrough` — cost 3; both; params intensity.
- `iris` — cost 2; both; params intensity.

## Topic routing

`parse` picks the cheapest `background` card carrying the slide's topic (ties by id).
Vocabulary: `ai agents geo trust security compute data money work timeline sales process`.
`autoStyle: false` disables it. `deck3d fx list --topic <t>` filters the catalogue.
