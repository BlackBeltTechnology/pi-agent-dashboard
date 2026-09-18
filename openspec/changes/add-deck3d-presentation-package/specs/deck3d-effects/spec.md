# deck3d-effects

## Purpose

A curated, licence-clean corpus of named visual effects (backgrounds, post-processing, materials, lights, motion, edge styles, transitions) with machine-readable metadata, so an agent selects effects for a slide from a catalogue by content and mood, and the deterministic engine composes them. Effects are never hand-coded per deck.

## ADDED Requirements

### Requirement: Effect corpus with metadata cards
The package SHALL ship an effects corpus under `src/fx/<id>.ts` + `src/fx/<id>.meta.json`. Each module SHALL implement one interface (`create(ctx, params) → { object?, pass?, material?, tick?(t), dispose() }`) and each card SHALL declare: `id`, `kind` (`background` | `post` | `material` | `light` | `motion` | `edge` | `transition`), `tags.mood[]`, `tags.content[]`, `cost` (1–5), `modes` (`dark` | `light` | `both`), `params` (JSON Schema with defaults and ranges), `conflicts[]` (effect ids), `source` (URL) and `licence` (SPDX id). Only permissive licences (MIT, Zlib, BSD, CC0, Apache-2.0) are admitted; a card whose `licence` is missing or non-permissive SHALL fail the corpus test.

#### Scenario: Card drives validation
- **WHEN** `overrides.slides[3].effects` contains `{ id: "aurora", params: { speed: 9 } }` and the `aurora` card bounds `speed` to `0..2`
- **THEN** `validate` fails naming `slides[3].effects[0].params.speed` and the allowed range

#### Scenario: Non-permissive licence rejected
- **WHEN** a card declares `licence: "Prosperity-3.0.0"` or omits `licence`
- **THEN** the corpus test fails and the effect is not built into the runtime

### Requirement: v1 corpus content
The v1 corpus SHALL contain at least the effects present in the strategy-lab mockup (`tokens`, `rings`, `swarm`, `particles` backgrounds; `bloom`, `film` post; `glass`, `metal`, `emissive` materials; `mirror-floor`, `fog`, `soft-shadows`, `room-ibl` staging; `signal-pulse` edge; `dolly` transition) plus permissively-licensed additions ported from three.js examples (MIT), `pmndrs/postprocessing` (Zlib), `@pmndrs/drei-vanilla` (MIT) and `n8ao` (CC0): `starfield`, `aurora`, `grid-horizon`, `hex-grid`, `data-columns`, `glyph-rain`, `constellation` backgrounds; `vignette`, `chromatic-aberration`, `depth-of-field`, `god-rays`, `n8ao`, `selective-bloom`, `smaa` post; `holo-fresnel`, `wireframe-overlay`, `iridescent`, `matcap` materials; `lightformers`, `accent-cycle`, `volumetric-spot` lights; `float`, `orbit`, `stagger-reveal`, `trail`, `camera-drift` motion; `dashed-flow`, `glow-tube`, `particle-stream` edges; `fade`, `iris`, `flythrough` transitions.

#### Scenario: Corpus size and licence audit
- **WHEN** the corpus test runs
- **THEN** every listed id exists with a card, every card's `licence` is permissive and `source` resolves to a URL, and the generated catalogue lists them all

### Requirement: Generated catalogue with previews
`deck3d fx list [--kind k] [--tag t] [--json]` SHALL print the catalogue from the cards, and `deck3d fx preview <id> [-o png]` SHALL render a fixture slide with only that effect enabled and snapshot it. A build step SHALL generate `reference/effects.md` from the cards (one section per effect: id, kind, tags, cost, modes, params table, thumbnail, source, licence) so the skill has a single source of truth.

#### Scenario: Filter by content tag
- **WHEN** `deck3d fx list --tag network --kind background` runs
- **THEN** only background effects whose `tags.content` includes `network` are printed with id, cost and modes

#### Scenario: Catalogue in sync
- **WHEN** a card changes and `reference/effects.md` is not regenerated
- **THEN** the corpus test fails (catalogue hash ≠ cards hash)

### Requirement: Deterministic defaults, agent overrides
`parse` SHALL assign default effects per slide deterministically from slide content: title/kicker keywords and diagram kind map to `tags.content` via a static table, resolved to the cheapest matching effect per kind, recorded in the derived `slides[n].effects` field. `overrides.slides[n].effects` SHALL replace (not merge) that list when present, and `overrides.effects` (deck level) SHALL replace deck-wide defaults. Same markdown ⇒ same defaults.

#### Scenario: Default from diagram kind
- **WHEN** a slide contains a `sequenceDiagram` and no effects override
- **THEN** `parse` assigns a background tagged `timeline` and an edge style tagged `sequence`, identically on every run

#### Scenario: Override replaces defaults
- **WHEN** `overrides.slides[4].effects` is `[{ id: "starfield" }]`
- **THEN** slide 4 renders only `starfield` plus deck-level effects, and re-running `parse` on edited markdown keeps the override

### Requirement: Composition rules and budget
`render` SHALL reject conflicting effects on the same slide (per `conflicts[]`), SHALL skip effects whose `modes` exclude the slide's mode with a warning, and SHALL warn when the summed `cost` of a slide's effects exceeds the budget of its `quality` tier (`low` 6, `medium` 12, `high` 20). Skipped and over-budget effects SHALL appear in `check`'s report.

#### Scenario: Conflict
- **WHEN** a slide enables both `depth-of-field` and `god-rays` and the cards declare a conflict
- **THEN** `render` fails naming both ids and the slide

#### Scenario: Over budget
- **WHEN** a `quality: low` slide sums to cost 9
- **THEN** `render` succeeds, prints a warning with the sum and the 6 budget, and `check` reports it as `warn budget`

### Requirement: Corpus contribution procedure
The skill SHALL document how to add an effect: search sources → verify licence against the permissive list (LYGIA/Prosperity and Shadertoy CC BY‑NC‑SA content are inspiration only, never ported verbatim) → port to the module interface → write the card → `fx preview` → regenerate the catalogue → run the corpus test. This is a development-time procedure on the package, distinct from the deck tune loop, which edits `overrides` only.

#### Scenario: Agent grows the corpus
- **WHEN** an agent follows the procedure for a new `nebula` background from a MIT three.js example
- **THEN** `src/fx/nebula.ts` + `nebula.meta.json` exist with `source` and `licence: MIT`, `reference/effects.md` gains a `nebula` section with thumbnail, and the corpus test passes
