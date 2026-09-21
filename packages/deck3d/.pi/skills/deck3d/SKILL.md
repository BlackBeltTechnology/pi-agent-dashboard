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

Interactive authoring path: `deck3d serve talk.md [--check]`. Watches sources,
rebuilds on change, reloads in place, re-pins local fx hashes, and lets the
configurator save or apply overrides directly.

Manual headless / agent / CI path:

1. `deck3d parse talk.md` → `talk.json` (derived IR + empty `overrides`).
2. `deck3d validate talk.json` → schema + derived-edit + orphan/prop warnings.
3. `deck3d build talk.md -o talk.html` → `talk.json` + `talk.html`; runs `check`
   and prints `style: <n>/<N> slides styled`.
4. **Style** — mandatory, and the step that decides whether the deck looks
   designed. `deck3d check talk.html --style` warns `style-defaults` for every
   slide still running only what `parse` chose. For each one:
   - pick a corpus effect (`deck3d fx list --topic geo`, `--kind background`;
     the stylistic set — `clipped-solids`, `extruded-shapes`, `volume-cloud`,
     `curve-flow`, … — is never auto-picked, so it is always an explicit choice)
     *or* write a per-deck one with `deck3d fx scaffold <name> --for <slideId>`;
   - give a content slide without a mermaid block a built topology
     (`overrides.slides["<id>"].diagram.kind` + `data`);
   - illustrate the section: `deck3d props search <kw> --role hero`,
     `--role illustration`, and `props search --role ambient` for
     low-triangle background instances;
   - if extruded titles read as a solid block, set `titleEdge: "contrast"`
     (deck default, or per slide) — it outlines every character in the
     palette text colour;
   - for a deck that wants a horizon, set `overrides.deck.floor: "water"`
     (one global surface; per-slide is not a thing);
   - grade the frame with a `post` card (`deck3d fx list --kind post`): add
     `{ "id": "outline", "params": { "parts": "diagram" } }` (or
     `selective-bloom`, `god-rays`, `depth-of-field`, `pixelate`, `ascii`, …)
     to the slide's `effects[]`. One or two per slide; they stack in a fixed
     order, and `check` flags declared `conflicts`.
5. Read the `check` findings. **Fix only the suggested key** (e.g.
   `overrides.slides["arch"].diagram.scale`), then re-run step 3.
6. `deck3d snapshot talk.html --slide 5 -o s5.png` to eyeball one slide.
7. Repeat until `check` is clean **and** the style line accounts for every slide
   you meant to design.

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

Objects deep-merge; **arrays replace** (an `effects`/`props` list is the whole list);
`diagram.data` replaces as a whole object so labels and values never mix provenance.
Full field list: [`reference/ir-fields.md`](reference/ir-fields.md).

The deck's `⚙` configurator (`C` key, or the gear) tries knobs live. Its **Effects**
block ticks composed effects off and adds any corpus or `local:` card from the
`add effect…` picker; both rebuild the slide immediately. Under
`deck3d serve`, **Apply to deck.json** merges straight into `talk.json` and rebuilds;
**Save overrides.json** writes `overrides.json` beside the deck. In unserved decks
or headless workflows, **Export** writes an `overrides.json` in exactly this grammar.
Merge it manually with:

```
deck3d overrides apply talk.json overrides.json
```

It deep-merges, re-validates, and refuses to write on a validation error. Note
that **markdown inline overrides win** over anything in that file, and an
exported `effects` list pins that scope's whole list.

## Styling with effects

`deck3d fx list [--kind k] [--tag t] [--json]` prints the catalogue;
[`reference/effects.md`](reference/effects.md) has params and licences.

- `parse` assigns deterministic defaults (title→`swarm`, flowchart→`tokens`,
  sequence→`rings`, security→`glyph-rain`, data→`data-columns`), then routes the
  rest by topic (`deck3d fx list --topic <t>`; `ai agents geo trust security
  compute data money work timeline sales process`). `autoStyle: false` restores
  the plain v1 fallback.
- Replace them with `overrides.slides["<id>"].effects = [{ id, params? }]`.

### Per-deck (local) effects

When no corpus effect fits the topic, write one beside `deck.md`:

```
deck3d fx scaffold neural-mesh --for ai   # writes fx/neural-mesh.{js,meta.json}
deck3d fx preview local:neural-mesh --palette ember -o p.png
deck3d fx hash neural-mesh                # re-pin after every edit
```

Paste the printed `{ id: "local:<name>", sha256 }` entry into the slide's
`effects`. `render` embeds the source and refuses a stale hash, so the deck
stays byte-deterministic and offline.

Inside a local module the deck shadows the non-deterministic and I/O globals:
`Math.random` **is the deck's seeded per-slide generator**, and `window`,
`document`, `fetch`, `setTimeout`, `Date`, `Promise`, `eval` and friends are all
`undefined`. No `import`, one default export, 64 KiB cap. A throw disables that
effect only and shows up as `local-fx-error` in `check`; any network the deck
attempts shows up as `local-fx-network`. Promote a good one with
`deck3d fx promote <name> --source <url> --licence <spdx>`.
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
4. `deck3d props search <kw> --role ambient` filters to models cheap enough to
   instance in the background and prints a ready `ambient` entry.
5. No model fits? `deck3d props generate --prompt "<text>" --name <n>` (or
   `--from-image`). Optional python path; network at authoring time only.

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
- Placement: `defaults.rail` (`line` `orbit` `tunnel` `helix` `grid`) strings the
  slides in space, `defaults.spacing` sets the gap, `layout` (`split`
  `split-reverse`) composes one slide, `cardOffset` nudges the card. Every rail
  frames a slide identically, so a rail switch never needs a per-slide re-tune.
- The mermaid engine is pinned exactly; a bump is a deliberate change and the
  harvest fixtures will fail if the rendered id scheme moves.
- Headless/background tabs stall `requestAnimationFrame`; the loop falls back to
  `setTimeout` so snapshots capture a finished frame.
- **A `check: clean` deck can still be bare.** `check` measures fit and
  legibility, not ambition — read the `style: <n>/<N> slides styled` line and
  run `check --style` before calling a deck done.

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
