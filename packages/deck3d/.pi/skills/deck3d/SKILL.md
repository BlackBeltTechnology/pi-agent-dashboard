---
name: deck3d
description: 'Build a self-contained 3D presentation from a Markdown outline — parse, tune via `overrides`, render to one offline deck.html. Use on "make a 3D deck from this outline", "build a presentation from these notes", "deck3d this markdown", "turn this talk into a 3D deck".'
---

# deck3d

Turn a Markdown outline into one self-contained, offline `deck.html`: extruded 3D
titles, harvested mermaid diagrams built as 3D objects, animated backgrounds, and
an optional glTF prop. The converter code is deterministic; **you tune the result
by writing `overrides` in `deck.json`**, never by editing the HTML.

## When to use

- The user has a Markdown outline (headings + bullets + ```mermaid blocks) and
  wants a presentation they can open offline in a browser.
- You need to tune placement, legibility, mode, effects or props of an existing
  `deck.json`.

## Markdown grammar

- `---` front-matter: deck defaults (`mode`, `palette`, `material`, `quality`, `transition`, …).
- `# Title` starts a slide. Zero headings ⇒ one slide id `slide`.
- The first paragraph after the heading (before bullets) is the subtitle.
- `- bullet` lines are body bullets.
- A fenced ```mermaid `flowchart` / `sequenceDiagram` block becomes the slide's
  diagram (harvested in headless chromium). Any other diagram type ⇒ warn + no diagram.
- `<!-- deck3d: {...} -->` inline overrides win over `deck.json` and warn on clobber.
- Pin a slide id with `# Final {#outro}` so renames never orphan tuning.

## The tune loop

1. `deck3d parse talk.md` → `talk.json` (derived IR + empty `overrides`).
2. `deck3d validate talk.json` → schema + derived-edit + orphan/prop warnings.
3. `deck3d build talk.md -o talk.html` → `talk.json` + `talk.html`; runs `check`.
4. Read the `check` findings. **Fix only the suggested key** (e.g.
   `overrides.slides["arch"].diagram.scale`), then re-run step 3.
5. `deck3d snapshot talk.html --slide 5 -o s5.png` to eyeball one slide.
6. Repeat until `check` is clean (or only acceptable contrast warnings remain).

Tune by writing `deck.json`'s `overrides` only:

```
overrides: {
  deck:    { ...defaults knobs... },
  effects: [{ id, params? }],
  props:   [{ source, id, licence, author, sha256, slide, role, size?, count?, restyle?, anim? }],
  slides:  { "<slideId>": { mode?, palette?, material?, scene?, quality?,
             diagram: { scale?, offset? }, camera: { distance? }, labels: { size? },
             check: { ignore? }, effects? } },
  nodes:   { "<slideId>/<nodeId>": { shape?, label?, position?, size?, material? } },
  edges:   { "<slideId>/<edgeId>": { kind?, material? } }
}
```

Objects deep-merge; **arrays replace** (an `effects`/`props` list is the whole list).
Full field list: [`reference/ir-fields.md`](reference/ir-fields.md).

## Styling with effects

`deck3d fx list [--kind k] [--tag t] [--json]` prints the catalogue;
[`reference/effects.md`](reference/effects.md) has params and licences.

- `parse` assigns deterministic defaults (title→`swarm`, flowchart→`tokens`,
  sequence→`rings`, security→`glyph-rain`, data→`data-columns`).
- Replace them with `overrides.slides["<id>"].effects = [{ id, params? }]`.
- Conflicts fail `render`; mode-incompatible effects are skipped with a warning;
  the summed `cost` warns over the quality budget (`low` 6 / `medium` 12 / `high` 20).

## Props (content illustrations)

`deck3d props search <keywords>` → candidate table (vendored first, then Poly Pizza).
**You** pick by relevance then style — code never picks. Then:

1. Prefer one pack per deck and `restyle: "palette"`.
2. `deck3d props fetch <source> <id>` → prints the `overrides.props[]` entry
   (with the `sha256`) and caches it in `.deck3d/props/`.
3. Add the entry to `overrides.props` (roles: `hero`, `illustration`,
   `ambient`, `node:<id>`), then `build`/`snapshot`.

Licences: CC0 needs no credits; CC-BY (and any non-CC0, non-`generated`) produces a
last `credits` slide at render. Never fetch a model whose licence you cannot name.

## Forbidden edits

- **Never edit `deck.html`** — it is regenerated; tune `deck.json` `overrides`.
- **Never edit derived fields** (`slides[]` and below) — `validate` warns
  `edited outside overrides`; the next `parse` loses the change.
- If you need a knob that does not exist, propose a schema field — do not hack the HTML.

## Pitfalls

- `parse` of a deck **with mermaid needs chromium**; missing ⇒
  `npx playwright install chromium`. `render`/`validate` never need a browser.
- Every three.js `typeface.json` has corrupt `ő ű Ő Ű` glyphs; deck3d uses a real
  Poppins TTF through opentype.js — do not swap in a typeface.json.
- Extruded small text blooms and is unreadable; diagram labels are flat canvas
  planes with a background-colour outline. Tune `labels.size`, not the material.
- The mermaid engine is pinned exactly; a bump is a deliberate change and the
  harvest fixtures will fail if the rendered id scheme moves.
- Headless/background tabs stall `requestAnimationFrame`; the loop falls back to
  `setTimeout` so snapshots capture a finished frame.

## Contributing an effect

Development-time procedure on the package (distinct from the deck tune loop):

1. Search a source; check its licence against the allow-list: **MIT, Zlib,
   BSD-2/3-Clause, CC0-1.0, Apache-2.0, OFL-1.1**. LYGIA (Prosperity) and
   Shadertoy content (default CC BY-NC-SA) are **inspiration only** — never port
   them verbatim.
2. Port to the module interface: `create(ctx, params) → { object?, pass?, material?, tick?, dispose() }`.
3. Write the card `src/fx/<id>.meta.json` (kind, tags, cost, modes, params schema,
   conflicts, `source` URL, `licence`).
4. `deck3d fx preview <id>` → check the PNG is not black.
5. `npm run gen:effects` → regenerate `reference/effects.md`.
6. `npm test` → the corpus test validates every card and the catalogue hash.
