## Purpose

Lets an agent author a topic-specific visual effect for one deck as a small pinned source file beside the markdown, so decks are not limited to the shipped corpus while render output stays byte-deterministic and offline.

## ADDED Requirements

### Requirement: Local effect files and reference grammar
A deck MAY carry effects in a `fx/` directory beside its `deck.md`: one `fx/<name>.js` module plus one `fx/<name>.meta.json` card per effect, `<name>` matching `^[a-z][a-z0-9-]{0,63}$` (1–64 chars, starts with a letter). An effect is referenced from `overrides.slides["<slideId>"].effects[]` or `overrides.effects[]` as `{ id: "local:<name>", sha256: "<hex sha256 of the .js bytes>", params? }`. The card SHALL use the corpus card schema with `source: "local"` and a permissive SPDX `licence`; its `kind` SHALL be `background` or `motion`. `validate` SHALL reject a `local:` reference whose file is missing, whose `sha256` does not match the file bytes, whose card is missing/invalid, whose card `kind` is not `background`/`motion`, or whose source exceeds 64 KiB — each error naming the override path and the file. `render` SHALL perform the same checks before embedding.

#### Scenario: Hash mismatch
- **WHEN** `fx/geo-arcs.js` is edited after its `sha256` was written into `overrides.slides["geo"].effects[0]`
- **THEN** `validate deck.json` exits non-zero naming `overrides.slides["geo"].effects[0].sha256` and `fx/geo-arcs.js`, and `render` writes no HTML

#### Scenario: Name grammar
- **WHEN** an override references `local:9lives` or `local:` followed by 65 characters
- **THEN** `validate` fails naming the id and the grammar `^[a-z][a-z0-9-]{0,63}$`; a 64-character name starting with a letter validates

#### Scenario: Unsupported local kind
- **WHEN** `fx/glow.meta.json` declares `kind: "post"`
- **THEN** `validate` fails naming the card and the allowed kinds `background`, `motion`

#### Scenario: Params bounded by the local card
- **WHEN** the local card bounds `density` to `0..1` and the override sets `params: { density: 4 }`
- **THEN** `validate` fails naming `overrides.slides["<slideId>"].effects[i].params.density` and the range, exactly as for a corpus card

### Requirement: Module shape and static lint
A local module SHALL be plain JavaScript whose first statement, after optional comments and whitespace, is `export default function (ctx, params) { … }` returning `{ object?, tick?(t), dispose() }`; it SHALL contain no other `export` and no `import`. `validate` SHALL reject a module that does not start with that statement, that contains a further `export`, or that contains the identifiers `import`, `require`, `eval`, `Function` (case-sensitive, word-bounded, outside strings and comments).

#### Scenario: Named export rejected
- **WHEN** a module adds `export const helper = 1` after the default export
- **THEN** `validate` fails naming the file and "single default export"

#### Scenario: Comment before the factory is fine
- **WHEN** a module begins with a licence comment block followed by `export default function (ctx, params) {`
- **THEN** `validate` accepts it and the effect renders

#### Scenario: `function` keyword is not `Function`
- **WHEN** the module uses `function` declarations inside the factory
- **THEN** the lint does not fire (case-sensitive match on `Function`)

### Requirement: Embedding is deterministic and self-contained
`render` SHALL inline each referenced module's source and card into the HTML with `<` escaped so a `</script>` sequence inside a module cannot terminate the script block. Same `deck.json` and same `fx/` bytes SHALL yield byte-identical HTML; the HTML SHALL load no external script for a local effect.

#### Scenario: Byte-identical with local effects
- **WHEN** a deck referencing two local effects is rendered twice
- **THEN** the two HTML files are byte-identical

#### Scenario: Script terminator in source
- **WHEN** a module contains the string literal `"</script>"`
- **THEN** the rendered deck still parses as one document and the effect runs

### Requirement: Runtime isolation and error containment
Inside a local module the identifiers `window`, `document`, `globalThis`, `self`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Image`, `Worker`, `WebAssembly`, `navigator`, `location`, `localStorage`, `sessionStorage`, `indexedDB`, `postMessage`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`, `Promise`, `Date`, `performance`, `crypto`, `eval`, `Function`, `importScripts` SHALL evaluate to `undefined`, and `Math.random` SHALL return the deck's seeded per-slide generator so a module using it is deterministic across loads. The module receives `ctx = { THREE, palette, mode, quality, rng, slide: { id, title, kind } }` and `params`. A throw from `create`, `tick` or `dispose` SHALL disable that effect for that slide only, leave the slide rendering, and be recorded as `{ slide, effectId, phase }` in `window.__deck3d.effects().errors`. This isolation is a determinism/offline guardrail, not a security boundary.

#### Scenario: Effect throws in tick
- **WHEN** a local effect's `tick` throws on the third frame
- **THEN** the slide's title, bullets and other effects keep rendering and `__deck3d.effects().errors` contains `{ slide: "<id>", effectId: "local:<name>", phase: "tick" }`

#### Scenario: Deterministic random
- **WHEN** a local effect scatters 200 points with `Math.random()`
- **THEN** the point positions are identical on every load of the same deck

#### Scenario: Timer unavailable
- **WHEN** a local effect calls `setTimeout(...)`
- **THEN** it throws a TypeError, is disabled for that slide with `phase: "create"`, and no timer is scheduled

### Requirement: Local effects enter composition
`local:` effects SHALL be composed with corpus effects under the same conflict, mode and cost-budget rules using the embedded card; an unknown `local:` id at runtime SHALL be skipped with a warning like an unknown corpus id.

#### Scenario: Local cost counts toward budget
- **WHEN** a `quality: low` slide composes corpus effects summing to 5 and a local card with `cost: 3`
- **THEN** the over-budget warning reports sum 8 against budget 6

### Requirement: Local effect CLI
`fx scaffold <name> [--kind background|motion] [--for <slideId>]` SHALL write `fx/<name>.js` (a working stub using `ctx.THREE`, `ctx.rng`, `tick` and `dispose`) and `fx/<name>.meta.json`, and print the override entry with the computed `sha256`. `fx hash <name>` SHALL print the current `sha256` of the module. `fx preview local:<name> [--palette p] [-o png]` SHALL render a fixture slide with only that effect and snapshot it. `fx promote <name> --source <url> --licence <spdx>` SHALL move the pair into the corpus with `source` and `licence` rewritten from the flags, fail if the licence is not permissive, and regenerate the catalogue; both flags are required.

#### Scenario: Scaffold is immediately valid
- **WHEN** `fx scaffold neural-mesh --for ai` runs and the printed entry is pasted into `overrides.slides["ai"].effects`
- **THEN** `validate` exits 0 and `fx preview local:neural-mesh` writes a non-black PNG

#### Scenario: Promote without licence
- **WHEN** `fx promote neural-mesh --source https://…` runs without `--licence`
- **THEN** the command exits non-zero naming the missing flag and moves nothing
