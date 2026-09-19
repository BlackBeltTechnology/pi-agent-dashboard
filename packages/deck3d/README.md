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
deck3d check   <deck.html> [--viewport WxH[,WxH]] [--slide n] [--strict] [-o report.json]
deck3d snapshot <deck.html> [--slide n] [-o png]     # one slide → PNG
deck3d fx      list [--kind k] [--tag t] [--json]    # effect catalogue
deck3d props   search <query>                        # candidate models
deck3d props   fetch <source> <id>                    # cache + hash-pin, prints override entry
```

Exit codes: `0` ok, `1` failure (one-line stderr reason), `2` usage.
Default check viewports: `1920x1080,1280x720`. Default `check` timeout 120 s/viewport.

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
- Objects deep-merge. Arrays replace.
- Suggest keys spell the overrides grammar: `overrides.slides["arch"].diagram.scale`.

## Tune loop

1. `deck3d parse talk.md`
2. `deck3d validate talk.json`
3. `deck3d build talk.md -o talk.html` (runs `check`)
4. Fix only the suggested override key. Re-run 3.
5. `deck3d snapshot talk.html --slide 5 -o s5.png`
6. Repeat.

Full knobs: `.pi/skills/deck3d/reference/ir-fields.md`.
Effect catalogue: `.pi/skills/deck3d/reference/effects.md`.
Playbook: `.pi/skills/deck3d/SKILL.md`.

## Effects

- `parse` assigns deterministic defaults: title→`swarm`, flowchart→`tokens`,
  sequence→`rings`, security→`glyph-rain`, data→`data-columns`.
- Replace: `overrides.slides["<id>"].effects = [{ id, params? }]`.
- Conflicts fail `render`. Mode-incompatible effects skip + warn.
- Quality budget: `low` 6, `medium` 12, `high` 20.

## Props

- `deck3d props search <keywords>` — vendored CC0 corpus first, Poly Pizza second
  (`POLY_PIZZA_KEY`). Offline/unreachable ⇒ vendored-only + notice.
- `deck3d props fetch <source> <id>` — writes `.deck3d/props/<source>-<id>.glb`,
  pins sha256, prints the `overrides.props[]` entry.
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
