## MODIFIED Requirements

### Requirement: Effect corpus with metadata cards
The package SHALL ship an effects corpus under `src/fx/<id>.ts` + `src/fx/<id>.meta.json`. Each module SHALL implement one interface (`create(ctx, params) → { object?, pass?, material?, tick?(t), dispose() }`, where `ctx` is `{ THREE, palette, mode, quality, rng, slide: { id, title, kind } }` — `rng` a seeded per-slide generator, `slide` read-only metadata) and each card SHALL declare: `id`, `kind` (`background` | `post` | `material` | `light` | `motion` | `edge` | `transition`), `tags.mood[]`, `tags.content[]`, optional `tags.topic[]` drawn from `ai`, `agents`, `geo`, `trust`, `security`, `compute`, `data`, `money`, `work`, `timeline`, `sales`, `process`, `cost` (1–5), `modes` (`dark` | `light` | `both`), `params` (JSON Schema with defaults and ranges), `conflicts[]` (effect ids), `source` (URL, or the literal `local` for a deck-local card) and `licence` (SPDX id). Only permissive licences (MIT, Zlib, BSD, CC0, Apache-2.0) are admitted; a card whose `licence` is missing or non-permissive SHALL fail the corpus test, as SHALL a corpus card whose `source` is `local` or whose `tags.topic` contains a value outside the vocabulary.

#### Scenario: Card drives validation
- **WHEN** `overrides.slides["<slideId>"].effects` contains `{ id: "aurora", params: { speed: 9 } }` and the `aurora` card bounds `speed` to `0..2`
- **THEN** `validate` fails naming `overrides.slides["<slideId>"].effects[0].params.speed` and the allowed range

#### Scenario: Non-permissive licence rejected
- **WHEN** a card declares `licence: "Prosperity-3.0.0"` or omits `licence`
- **THEN** the corpus test fails and the effect is not built into the runtime

#### Scenario: Unknown topic tag rejected
- **WHEN** a corpus card declares `tags.topic: ["finance"]`
- **THEN** the corpus test fails naming the card and the allowed vocabulary

#### Scenario: Existing effects unaffected by the wider context
- **WHEN** the corpus test constructs every effect with the extended `ctx`
- **THEN** every existing effect constructs and disposes without error

### Requirement: v1 corpus content
The v1 corpus SHALL contain at least the effects present in the strategy-lab mockup (`tokens`, `rings`, `swarm`, `particles` backgrounds; `bloom`, `film` post; `glass`, `metal`, `emissive` materials; `mirror-floor`, `fog`, `soft-shadows`, `room-ibl` staging; `signal-pulse` edge; `dolly` transition) plus permissively-licensed additions ported from three.js examples (MIT), `pmndrs/postprocessing` (Zlib — the runtime's single `EffectComposer`; `bloom`/`film` are re-expressed as its `BloomEffect`/`NoiseEffect`), `@pmndrs/drei-vanilla` (MIT) and `n8ao` (CC0): `starfield`, `aurora`, `grid-horizon`, `hex-grid`, `data-columns`, `glyph-rain`, `constellation` backgrounds; `vignette`, `chromatic-aberration`, `depth-of-field`, `god-rays`, `n8ao`, `selective-bloom`, `smaa` post; `holo-fresnel`, `wireframe-overlay`, `iridescent`, `matcap` materials; `lightformers`, `accent-cycle`, `volumetric-spot` lights; `float`, `orbit`, `stagger-reveal`, `trail`, `camera-drift` motion; `dashed-flow`, `glow-tube`, `particle-stream` edges; `fade`, `iris`, `flythrough` transitions. The corpus SHALL further contain topic-world backgrounds built from 3D scenery (not only points and cubes), each with `tags.topic`: `globe-arcs` (geo), `city-grid` (work, sales), `neural-mesh` (ai), `vault-glyphs` (trust, security), `server-racks` (compute), `market-tape` (money, data), `orbit-agents` (agents), `paper-stack` (process); and the existing `hex-grid`, `grid-horizon`, `constellation`, `data-columns`, `glyph-rain` SHALL carry at least one `tags.topic`. Every topic in the vocabulary SHALL be covered by at least one background card. Each topic-world background SHALL expose `density` and `speed` params, use the seeded generator (never `Math.random`) and scale instance counts with `quality`.

#### Scenario: Corpus size and licence audit
- **WHEN** the corpus test runs
- **THEN** every listed id exists with a card, every card's `licence` is permissive and `source` resolves to a URL, and the generated catalogue lists them all

#### Scenario: Every topic has a background
- **WHEN** the corpus test runs
- **THEN** for each of the twelve topic values at least one `background` card lists it in `tags.topic`

#### Scenario: Topic background is deterministic
- **WHEN** `fx preview globe-arcs` is run twice
- **THEN** the two PNGs are pixel-identical

### Requirement: Generated catalogue with previews
`deck3d fx list [--kind k] [--tag t] [--topic t] [--json]` SHALL print the catalogue from the cards, and `deck3d fx preview <id|local:name> [--palette p] [-o png]` SHALL render a fixture slide with only that effect enabled and snapshot it. A build step SHALL generate `reference/effects.md` from the cards (one section per effect: id, kind, tags incl. topic, cost, modes, params table, thumbnail, source, licence) so the skill has a single source of truth.

#### Scenario: Filter by content tag
- **WHEN** `deck3d fx list --tag network --kind background` runs
- **THEN** only background effects whose `tags.content` includes `network` are printed with id, cost and modes

#### Scenario: Catalogue in sync
- **WHEN** a card changes and `reference/effects.md` is not regenerated
- **THEN** the corpus test fails (catalogue hash ≠ cards hash)

#### Scenario: Filter by topic
- **WHEN** `deck3d fx list --topic geo` runs
- **THEN** `globe-arcs` is printed and `neural-mesh` is not

#### Scenario: Preview a local effect in a palette
- **WHEN** `deck3d fx preview local:neural-mesh --palette ember -o p.png` runs beside a deck with `fx/neural-mesh.js`
- **THEN** `p.png` is written showing the effect in `ember` colours

### Requirement: Deterministic defaults, agent overrides
`parse` SHALL assign default effects per slide deterministically from slide content, resolving in this order and stopping at the first match: (1) the static title/kicker keyword table to a `tags.content` background (cheapest match); (2) a title-like slide (no diagram, no bullets) → `swarm`; (3) a `flowchart`/`sequence` diagram → that kind's background and edge style; (4) unless `autoStyle` is `false`, the ordered topic keyword table → the cheapest `background` card whose `tags.topic` contains the matched topic (ties by id); (5) `particles`. Steps 1–3 and 5 SHALL behave exactly as before this change, so a slide's default changes only if it previously reached step 5. Defaults are recorded in the derived `slides[n].effects` field. `overrides.slides["<slideId>"].effects` SHALL replace (not merge) that list when present, and `overrides.effects` (deck level) SHALL replace deck-wide defaults (arrays replace under the IR merge rule). `defaults.transition` SHALL name a `transition`-kind effect id. Same markdown ⇒ same defaults.

#### Scenario: Default from diagram kind
- **WHEN** a slide contains a `sequenceDiagram` and no effects override
- **THEN** `parse` assigns a background tagged `timeline` and an edge style tagged `sequence`, identically on every run

#### Scenario: Override replaces defaults
- **WHEN** `overrides.slides["<slideId>"].effects` is `[{ id: "starfield" }]`
- **THEN** slide 4 renders only `starfield` plus deck-level effects, and re-running `parse` on edited markdown keeps the override

#### Scenario: Topic default
- **WHEN** a content slide titled "Regional trade shifts" with three plain bullets and no diagram is parsed
- **THEN** its derived `effects[0]` is the cheapest background tagged `geo` (`globe-arcs` in the shipped corpus)

#### Scenario: Diagram outranks topic
- **WHEN** a slide titled "Regional trade shifts" carries a `flowchart`
- **THEN** its derived background is the flowchart default (`tokens`), not a `geo` background

#### Scenario: Auto-style opt-out
- **WHEN** front-matter sets `autoStyle: false` and the "Regional trade shifts" content slide is parsed
- **THEN** its derived `effects[0]` is `particles`

### Requirement: Composition rules and budget
`render` SHALL reject conflicting effects on the same slide (per `conflicts[]`), SHALL skip effects whose `modes` exclude the slide's mode with a warning, and SHALL warn when the summed `cost` of a slide's effects exceeds the budget of its `quality` tier (`low` 6, `medium` 12, `high` 20). `local:` effects SHALL participate using their embedded card. Skipped and over-budget effects SHALL appear in `check`'s report.

#### Scenario: Conflict
- **WHEN** a slide enables both `depth-of-field` and `god-rays` and the cards declare a conflict
- **THEN** `render` fails naming both ids and the slide

#### Scenario: Over budget
- **WHEN** a `quality: low` slide sums to cost 9
- **THEN** `render` succeeds, prints a warning with the sum and the 6 budget, and `check` reports it as `warn budget`

#### Scenario: Local conflict
- **WHEN** a local card declares `conflicts: ["aurora"]` and its slide also enables `aurora`
- **THEN** `render` fails naming `local:<name>`, `aurora` and the slide

### Requirement: Corpus contribution procedure
The skill SHALL document how to add an effect: search sources → verify licence against the permissive list (LYGIA/Prosperity and Shadertoy CC BY‑NC‑SA content are inspiration only, never ported verbatim) → port to the module interface → write the card → `fx preview` → regenerate the catalogue → run the corpus test. It SHALL also document the promotion path from a deck-local effect: `fx promote <name> --source <url> --licence <spdx>`, which performs the move, rewrites the card and regenerates the catalogue, leaving the corpus test as the gate. This is a development-time procedure on the package, distinct from the deck tune loop, which edits `overrides` and `fx/` only.

#### Scenario: Agent grows the corpus
- **WHEN** an agent follows the procedure for a new `nebula` background from a MIT three.js example
- **THEN** `src/fx/nebula.ts` + `nebula.meta.json` exist with `source` and `licence: MIT`, `reference/effects.md` gains a `nebula` section with thumbnail, and the corpus test passes

#### Scenario: Promote a local effect
- **WHEN** `fx promote neural-mesh --source https://github.com/... --licence MIT` runs beside a deck with a valid `fx/neural-mesh.*`
- **THEN** `src/fx/neural-mesh.ts` and `neural-mesh.meta.json` exist with the given source and licence, `fx/neural-mesh.*` are removed, and the corpus test passes
