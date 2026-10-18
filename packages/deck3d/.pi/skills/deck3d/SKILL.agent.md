# SKILL.md — deck3d index

Pull-only condensed map. Source: packages/deck3d/.pi/skills/deck3d/SKILL.md. Markdown outline → one self-contained offline `deck.html` (3D titles, harvested mermaid, backgrounds, optional glTF prop). Tune via `deck.json` `overrides` only; never edit HTML.

Triggers: "make a 3D deck from this outline", "build a presentation from these notes", "deck3d this markdown", "turn this talk into a 3D deck". `.pptx` input → `deck3d-from-pptx`.

## Markdown grammar
- `---` front-matter: `mode`, `palette`, `material`, `quality`, `transition`.
- `# Title` = slide. Zero headings → slide id `slide`.
- First paragraph before bullets = subtitle. `- bullet` = body bullet.
- ```mermaid `flowchart` / `sequenceDiagram` → harvested diagram (headless chromium). Other types → warn, no diagram.
- `<!-- deck3d: {...} -->` inline override; wins over `deck.json`; warns on clobber. Never subtitle/bullet.
- Pin id: `# Final {#outro}`.

## Tune loop
- Interactive: `deck3d serve talk.md [--check]` (watch, rebuild, reload, configurator).
- Headless:
  1. `deck3d parse talk.md` → `talk.json` (IR + empty overrides).
  2. `deck3d validate talk.json` — schema, derived-edit, orphan/prop warnings.
  3. `deck3d build talk.md -o talk.html` — runs check; prints `style: <n>/<N> slides styled`.
  4. Style (mandatory): `deck3d check talk.html --style` → `style-defaults` per slide:
     - corpus effect: `deck3d fx list --topic geo`, `--kind background`. Stylistic set (`clipped-solids`, `extruded-shapes`, `volume-cloud`, `curve-flow`) never auto-picked.
     - per-deck: `deck3d fx scaffold <name> --for <slideId>`.
     - content slide w/o mermaid: `overrides.slides["<id>"].diagram.kind` + `data`.
     - props: `deck3d props search <kw> --role hero|illustration`; `--role ambient`.
     - solid-block titles → `titleEdge: "contrast"`.
     - horizon → `overrides.deck.floor: "water"`.
     - `overrides.deck.reflectBackdrop: false`; `floorMatte` (0 mirror, ~0.35 concrete, ~0.85 stone); `floorReflectivity` (0–1, default 1). Deck-scope only.
     - `post` card: `deck3d fx list --kind post`; `{ "id": "outline", "params": { "parts": "diagram" } }` (also `selective-bloom`, `god-rays`, `depth-of-field`, `pixelate`, `ascii`). 1–2 per slide; fixed stack order; `check` flags `conflicts`.
  5. Fix only suggested key (e.g. `overrides.slides["arch"].diagram.scale`); re-run step 3.
  6. `deck3d snapshot talk.html --slide 5 -o s5.png`.
  7. Repeat until check clean and style line covers designed slides.
- Overrides grammar: `deck`, `effects[]`, `props[]`, `slides{<id>: mode, palette, material, scene, quality, diagram{scale,offset}, camera{distance}, labels{size}, check{ignore}, effects}`, `nodes{<slide>/<node>}`, `edges{<slide>/<edge>}`.
- Deep merge; arrays replace; `diagram.data` replaces whole. Field list: `reference/ir-fields.md`.
- Configurator `⚙` (`C` key): Effects block; **Apply to deck.json** (serve); **Save overrides.json**; **Export** (unserved).
- Merge: `deck3d overrides apply talk.json overrides.json` (refuses on validation error). Markdown inline overrides beat it.

## Styling with effects
- `deck3d fx list [--kind k] [--tag t] [--json]`; `reference/effects.md`.
- `parse` defaults: title→`swarm`, flowchart→`tokens`, sequence→`rings`, security→`glyph-rain`, data→`data-columns`; topic routing (`ai agents geo trust security compute data money work timeline sales process`). `autoStyle: false` = v1 fallback.
- Replace: `overrides.slides["<id>"].effects = [{ id, params? }]`.
- Video: `video-screen` `{ "src": "video/demo.mp4", "width", "x", "y", "tilt" }`. Clip must be same-origin.
  - `deck3d serve` serves beside-deck media.
  - `deck3d render deck.json -o deck.html --embed-video` → data: URLs (+~33%).
  - `file://` + `video/` folder does NOT work.
  - Playback freezes during transitions.
- Local effects: `deck3d fx scaffold neural-mesh --for ai` → `fx/neural-mesh.{js,meta.json}`; `deck3d fx preview local:neural-mesh --palette ember -o p.png`; `deck3d fx hash neural-mesh` (re-pin); paste `{ id: "local:<name>", sha256 }`. `render` refuses stale hash.
- Sandbox: `Math.random` = seeded per-slide; `window`, `document`, `fetch`, `setTimeout`, `Date`, `Promise`, `eval` undefined. No `import`; one default export; 64 KiB cap. Throw → `local-fx-error`; network → `local-fx-network`. Promote: `deck3d fx promote <name> --source <url> --licence <spdx>`.
- Conflicts fail `render`; mode-incompatible skipped; cost budget `low` 6 / `medium` 12 / `high` 20.

## Deck assets, layer effects, pptx
- `overrides.assets[]` `{ id, path, sha256, mime }`; embedded as data: URIs; path inside deck dir; stale sha256 fails. Read via `ctx.assets.get(id)`.
- Card kind `layer`: `replacesContent` (`slide-layer`) drops native title/card/bullets/diagram; `persistent` (`frame-chrome`) deck-scope only, driven by `transition({from,to,p})`.
- Built-ins: `slide-layer`, `frame-chrome`, `art3d`, `icon3d`, `haze`.
- Commands: `deck3d pptx …`, `deck3d art …`, `deck3d variants …`.
- `style.json` beside `deck.json`: `steps[].variants[]`, `picked`, `note`, `round`. `serve` previews `?variant=<step>:<name>` (`V` cycles).

## Props
- `deck3d props search <keywords>` → vendored first, then Poly Pizza. Agent picks by relevance/style.
1. One pack per deck; `restyle: "palette"`.
2. `deck3d props fetch <source> <id>` → entry with `sha256`; cached `.deck3d/props/`.
3. Add to `overrides.props` (roles `hero`, `illustration`, `ambient`, `node:<id>`).
4. `props search <kw> --role ambient` → ready ambient entry.
5. None fit: `deck3d props generate --prompt "<text>" --name <n>` (or `--from-image`).
- CC0 → no credits; CC-BY or non-CC0/non-`generated` → last `credits` slide. Never fetch unnamed licence.

## Forbidden edits
- Never edit `deck.html` (regenerated).
- Never edit derived fields (`slides[]` and below); `validate` warns `edited outside overrides`.

## Pitfalls
- `parse` with mermaid needs chromium (`npx playwright install chromium`). `render`/`validate` need none.
- typeface.json glyph corruption `ő ű Ő Ű`; deck3d uses Poppins TTF via opentype.js; don't swap.
- Extruded small text blooms; diagram labels flat. Tune `labels.size`.
- Placement: `defaults.rail` (`line` `orbit` `tunnel` `helix` `grid`), `defaults.spacing`, `layout` (`split` `split-reverse`), `cardOffset`.
- Transitions: `defaults.transition`, per-slide `transition`, `defaults.transitionCycle`; `durationSec`, `transitionAmount` (0–2). Motions (`runtime/transition.ts` `makeMotion`): `dolly` (default), `swing`, `revolve`, `crane`, `bank` (≤8° roll), `flythrough`, `fade`, `iris`, `cut`, `path`.
- `cameraPath` (needs `transition: "path"`): 1–8 keys, `t` strictly increasing in (0,1); `offset=[right, up, forward]` fraction of from→to distance; `look` 0 leave–1 arrive; `roll` ±45°; `fov` 20–90°. Back nav = reversed mirror.
- `check: clean` ≠ designed. Read `style:` line; run `check --style`.
