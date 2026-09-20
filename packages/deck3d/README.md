# @blackbelt-technology/pi-dashboard-deck3d

Deterministic Markdown → self-contained 3D presentation.

- Input: markdown outline (headings, bullets, ```mermaid blocks).
- Output: one offline `deck.html` (three.js runtime + IR + subset font inlined).
- Two stages: markdown → schema-validated Deck IR (`deck.json`) → `deck.html`.
- Ships: `deck3d` CLI + `deck3d` pi skill.

Never hand-edit `deck.html`. Tune `deck.json` `overrides` only.

## Install

```bash
pnpm install                 # repo root; pnpm only
npx playwright install chromium   # for mermaid harvest / check / snapshot
```

Deps: `three@0.160.0`, `mermaid@11.17.2` (exact pin, harvest), `opentype.js`,
`ajv`, `esbuild`, `playwright`. `render` / `validate` never need a browser.

## Commands

```bash
deck3d parse   <deck.md> [-o deck.json] [--fresh]   # markdown (+ mermaid) → IR
deck3d validate <deck.json>                          # schema + derived-edit checks
deck3d render  <deck.json> -o deck.html              # IR → self-contained HTML
deck3d build   <deck.md> -o deck.html                # parse → render; writes .json beside
deck3d serve   <deck.md> [--port n] [--check]        # watch + rebuild + live reload; panel saves to disk
deck3d check   <deck.html> [--viewport WxH[,WxH]] [--slide n] [--strict] [-o report.json]
deck3d snapshot <deck.html> [--slide n] [-o png]     # one slide → PNG
deck3d check   <deck.html> [--style]                 # + warn on slides still on parse defaults
deck3d fx      list [--kind k] [--tag t] [--topic p] # effect catalogue
deck3d fx      preview <id|local:name> [--palette p] # one effect → PNG
deck3d fx      scaffold <name> [--kind k] [--for id] # write fx/<name>.{js,meta.json}
deck3d fx      hash <name>                           # sha256 of fx/<name>.js
deck3d fx      promote <name> --source u --licence l # local effect → corpus
deck3d props   search <query> [--role ambient]       # candidate models
deck3d props   fetch <source> <id>                    # cache + hash-pin, prints override entry
deck3d props   generate --prompt <text> --name <n>   # text → image → GLB
deck3d overrides apply <deck.json> <file>            # merge an overrides-grammar file
```

Exit codes: `0` ok, `1` failure (one-line stderr reason), `2` usage.
Default check viewports: `1920x1080,1280x720`. Default `check` timeout 120 s/viewport.

## Serve

`deck3d serve <deck.md> [--port n] [--check]` starts authoring server.

- Binds `127.0.0.1` only (exposes filesystem write endpoints). `--port` omitted ⇒ OS assigns free port.
- Watches `deck.md`, `fx/`, `deck.json`. Rebuilds on change (debounced, default 120 ms).
- Re-pins local effect `sha256` in `deck.json` on rebuild; editing `fx/*.js` live never trips render hash check.
- Broken edit keeps serving last good deck; reports error overlay in browser; recovers on next valid edit.
- Injects SSE reload client (`/__events`) into served copy only; `build` output stays offline and self-contained.
- Live reload preserves current slide via `location.hash` and staged configurator values via `localStorage`.
- Stylistic backgrounds (explicit presets, never auto-routed): `clipped-solids`, `extruded-shapes` (`shape` or an SVG `svgPath`), `scatter`, `tessellate`, `curve-flow`, `sprites`, `volume-cloud`, `volume-perlin`, `billboards`, `points-on-geometry`, `shader-particles`, `dynamic-instances`; `constellation` gained `nodeShape`. `deck3d fx list --kind background` shows them all.
- Post-processing: list any `post` card in a slide's `effects[]` and it enables a real composer pass for that slide only — `bloom`, `selective-bloom` (`parts: diagram|title|props|all`), `film`, `vignette`, `smaa`, `sao`, `depth-of-field` (`focus: 0` = auto), `chromatic-aberration`, `god-rays`, `pixelate`, `outline`, `sobel`, `dot-screen`, `ascii`. Pass order is canonical (not list order); params surface in the configurator's per-effect block.
- Configurator (`C`) adds **Save overrides.json** (POST `/__overrides`) and **Apply to deck.json** (POST `/__apply`, merges via `overrides apply` grammar, then rebuilds). Unserved decks fall back to panel copy/download (avoids silent drops in download-restricted iframes).
- Write endpoints IR-validate payload before write. Invalid payload returns 400 and leaves target file untouched. Write targets confined to deck directory (path traversal refused). 1 MB body cap.
- `--check` runs fit check out of band after rebuild; findings stream over SSE as `findings` event; reload never waits for check.

## Markdown grammar

- `---` front-matter: deck defaults.
- `# Title` starts a slide. Zero headings ⇒ one slide id `slide`.
- First paragraph after heading = subtitle.
- `- bullet` = body bullets.
- ```mermaid `flowchart` / `sequenceDiagram` = slide diagram (harvested headless).
  Other diagram types: warn + `diagram: none`.
- `<!-- deck3d: {...} -->` inline overrides win over `deck.json`.
- Pin an id: `# Final {#outro}`.

## IR + overrides

`deck.json` = `{ meta, defaults, slides[], overrides }`.

- `slides[]` and below are DERIVED (regenerated every parse).
- Write only `overrides`: `deck`, `slides`, `nodes`, `edges`, `effects`, `props`.
- Objects deep-merge. Arrays replace. `diagram.data` replaces as a whole object.
- Suggest keys spell the overrides grammar: `overrides.slides["arch"].diagram.scale`.
- The deck's `⚙` configurator (`C` key) exports an `overrides.json` in this
  grammar; merge it with `deck3d overrides apply`.

## Tune loop

Interactive authoring: `deck3d serve talk.md [--check]` watches sources, reloads browser in place, and lets configurator save/apply overrides directly. Headless/scripted loop:

1. `deck3d parse talk.md`
2. `deck3d validate talk.json`
3. `deck3d build talk.md -o talk.html` (runs `check`, prints `style: n/N slides styled`)
4. Style: `deck3d check talk.html --style`, then pick an effect / built diagram /
   props per flagged slide.
5. Fix only the suggested override key. Re-run 3.
6. `deck3d snapshot talk.html --slide 5 -o s5.png`
7. Repeat.

Full knobs: `.pi/skills/deck3d/reference/ir-fields.md`.
Effect catalogue: `.pi/skills/deck3d/reference/effects.md`.
Playbook: `.pi/skills/deck3d/SKILL.md`.

## Effects

- `parse` assigns deterministic defaults: title→`swarm`, flowchart→`tokens`,
  sequence→`rings`, security→`glyph-rain`, data→`data-columns`, then routes the
  remainder by `tags.topic`. `autoStyle: false` restores the v1 fallback.
- Replace: `overrides.slides["<id>"].effects = [{ id, params? }]`.
- Per-deck effects live in `fx/<name>.js` + `.meta.json` beside `deck.md`, are
  referenced as `{ id: "local:<name>", sha256 }`, and are embedded at render.
  Inside one, `Math.random` is the deck's seeded stream and `window`/`fetch`/
  `setTimeout`/`Date` are `undefined`.
- Conflicts fail `render`. Mode-incompatible effects skip + warn.
- Quality budget: `low` 6, `medium` 12, `high` 20.
- Palettes: `blackbelt zenit dapp midnight ember arctic forest mono neon custom`.
- Built topologies (no mermaid needed): `brain loop swarm bars funnel
  timeline-rail globe orbit-cluster stack`, driven by `diagram.data`.

## Backgrounds never cover text

Backgrounds and every `local:` effect render in a depth-isolated pass behind the
slide, so an effect cannot occlude a title, card or diagram whatever its
geometry reaches. A module that attaches geometry AFTER creation escapes that
pass; `check` reports it as `fx-content-layer`.

## Placement

- `defaults.rail` — how the slides are strung in space: `line` (straight dolly,
  default), `orbit` (ring, each slide turned to face its camera), `tunnel`
  (recedes along -Z), `helix` (ascending orbit), `grid` (rows + columns).
  Deck-level; `defaults.spacing` (default 40) sets the gap and scales culling.
- `layout` — composition within a slide: `split` (title + card left, diagram
  right, default) or `split-reverse` (mirrored). Deck-wide or per slide.
- `cardOffset: {x, y}` and `diagram.offset`/`diagram.scale` — per-slide nudges
  applied after the preset places things.
- All of it is live in the configurator (`C`) under the **Layout** block.

## Props

- `deck3d props search <keywords>` — vendored CC0 corpus first, Poly Pizza second
  (`POLY_PIZZA_KEY`). Offline/unreachable ⇒ vendored-only + notice.
- `deck3d props fetch <source> <id>` — writes `.deck3d/props/<source>-<id>.glb`,
  pins sha256, prints the `overrides.props[]` entry.
- `--role ambient` filters to ≤ 2 000-triangle models and prints a placement entry.
- `deck3d props generate --prompt "<text>" --name <n>` — text → image
  (`DECK3D_T2I_URL`) → GLB. Optional python path; authoring-time network only.
- Roles: `hero`, `illustration`, `ambient`, `node:<id>`.
- Cap: `.glb` ≤ 8 MiB (inclusive). External `.gltf` URIs rejected.

## Tests

```bash
pnpm -F @blackbelt-technology/pi-dashboard-deck3d test
```

Browser suites self-skip without chromium (`describe.skipIf(!chromiumAvailable())`).

Env hooks: `DECK3D_HARVEST_TIMEOUT_MS` (60000), `DECK3D_CHECK_TIMEOUT_MS` (120000),
`DECK3D_HTTP_TIMEOUT_MS` (10000), `DECK3D_HARVEST_STALL`.

## Build

```bash
npm run build   # build:harvest + build:runtime + gen:ir-fields + gen:effects
```
