## MODIFIED Requirements

### Requirement: Effect corpus with metadata cards
The package SHALL ship an effects corpus under `src/fx/<id>.ts` + `src/fx/<id>.meta.json`. Each module SHALL implement one interface (`create(ctx, params) → { object?, pass?, material?, tick?(t), dispose() }`, where `ctx` is `{ THREE, palette, mode, quality, rng, slide: { id, title, kind }, assets }` — `rng` a seeded per-slide generator, `slide` read-only metadata, `assets` the read-only deck asset accessor whose `get(id)` throws for an unknown id) and each card SHALL declare: `id`, `kind` (`background` | `post` | `material` | `light` | `motion` | `edge` | `transition` | `layer` — `layer` effects draw slide content on the content layer, above the backdrop pass), optional `replacesContent` (boolean, default false; when any effect composed on a slide declares it, the runtime does not build that slide's native title, subtitle, bullet card or diagram, and `measure()` reports none of them), optional `persistent` (boolean, default false; a persistent effect is deck-scope only, created once per deck load, kept outside slide groups and given a per-frame `transition({ from, to, p })` hook — see deck3d-slide-layers), `tags.mood[]`, `tags.content[]`, optional `tags.topic[]` drawn from `ai`, `agents`, `geo`, `trust`, `security`, `compute`, `data`, `money`, `work`, `timeline`, `sales`, `process`, `cost` (1–5), `modes` (`dark` | `light` | `both`), `params` (JSON Schema with defaults and ranges), `conflicts[]` (effect ids), `source` (URL, or the literal `local` for a deck-local card) and `licence` (SPDX id). Only permissive licences (MIT, Zlib, BSD, CC0, Apache-2.0) are admitted; a card whose `licence` is missing or non-permissive SHALL fail the corpus test, as SHALL a corpus card whose `source` is `local` or whose `tags.topic` contains a value outside the vocabulary.

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

#### Scenario: Built-in effect reads a deck asset
- **WHEN** a slide lists `{ id: "slide-layer", params: { layout: "layout", slide: "s03" } }` and `overrides.assets` contains an entry with id `layout`
- **THEN** the effect constructs by reading the layout through `ctx.assets.get("layout")`, and no network request is made

#### Scenario: Layer kind is not a backdrop
- **WHEN** a slide composes `slide-layer` (kind `layer`)
- **THEN** its objects draw on the content layer and `check` reports no `fx-content-layer` finding for it

### Requirement: The reference deck presents the whole corpus
The `business-2031` fixture SHALL present every corpus card on exactly one slide: no card left unpresented, no card on two slides, and nothing parked at deck scope (deck-scope effects prepend to every slide, which is duplication by construction). The single exception is a card with `persistent: true`: it is never prepended to slides, so the fixture SHALL present each persistent card exactly once in deck-scope `overrides.effects`, and `overrides.effects` SHALL contain nothing else. A card the fixture cannot place SHALL fail the build of the corpus, not be silently skipped — the fixture is the corpus's only end-to-end demonstration.

#### Scenario: Every card is presented exactly once
- **GIVEN** the built `business-2031` IR after `applyOverrides`
- **WHEN** the per-slide effect lists are collected
- **THEN** every non-persistent `src/fx/*.meta.json` id appears in exactly one slide's list, every persistent id appears exactly once in `overrides.effects`, `overrides.effects` holds only persistent ids, and `check` reports clean

#### Scenario: A new card must be placed
- **GIVEN** a card added to `src/fx/` and not placed on a fixture slide
- **WHEN** the corpus-coverage test runs
- **THEN** it fails, naming the unplaced card

#### Scenario: The local-effect pipeline stays exercised
- **GIVEN** the fixture after its local modules were promoted into the corpus
- **WHEN** its `fx/` directory is read
- **THEN** exactly one local module remains, referenced as `local:` with a matching `sha256` pin

#### Scenario: Persistent card placed at deck scope
- **GIVEN** `frame-chrome` (persistent) listed once in the fixture's `overrides.effects`
- **WHEN** the corpus-coverage test runs
- **THEN** it passes, and no slide's composed effect list contains `frame-chrome`
