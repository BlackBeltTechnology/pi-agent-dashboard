## MODIFIED Requirements

### Requirement: IR carries every visual knob the renderer consumes
The IR SHALL expose, as plain JSON, every parameter the renderer reads: deck-level defaults (mode, palette, material, transition, camera rail, depth relief, background intensity, quality, `autoStyle`, `layout`, `spacing`), per-slide values (title, subtitle, bullets, background scene, diagram, `diagram.kind`, `diagram.data`, `diagram.scale`/`diagram.offset`, `camera.distance`, `labels.size`, `cardOffset`, `check.ignore` id list, `effects[]` derived defaults), deck-level and per-slide `overrides.effects[]` (`{id, params}` for corpus ids; `{id, sha256, params}` for `local:` ids), and per-diagram geometry (node position/size/shape/group, edge path samples/kind/label, layout direction). `palette` SHALL admit `blackbelt`, `zenit`, `dapp`, `midnight`, `ember`, `arctic`, `forest`, `mono`, `neon`, `custom`. `diagram.kind` SHALL admit `none`, `flowchart`, `sequence`, `brain`, `loop`, `swarm`, `bars`, `funnel`, `timeline-rail`, `globe`, `orbit-cluster`, `stack`; `overrides.slides["<slideId>"].diagram.kind` SHALL admit every value except `flowchart` and `sequence`. `diagram.data` SHALL be `{ labels?: string[], values?: number[] }` with every value `≥ 0`; `validate` SHALL reject a negative value naming its path. `layout` SHALL admit `split` (title and card left, diagram right) and `split-reverse` (mirrored), defaulting to `split`, and SHALL be settable deck-wide and per slide. `rail` SHALL admit `line` (straight dolly), `orbit` (ring, each slide turned to face its camera), `tunnel` (receding along -Z), `helix` (ascending orbit) and `grid` (rows and columns), defaulting to `line`, and SHALL be deck-level only. `spacing` SHALL be the world-unit gap between consecutive slide anchors (`> 0`, default `40`) and SHALL be deck-level only; the neighbour cull radius SHALL be derived from `spacing` and `rail` so no rail culls the slide in frame. `cardOffset` SHALL be `{ x?: number, y?: number }` in world units, applied to the text card after the layout preset places it, and SHALL be settable per slide. The renderer SHALL NOT read hidden state outside the IR.

#### Scenario: Layout preset mirrors the composition
- **WHEN** `overrides.slides["market"].layout` is `split-reverse`
- **THEN** the rendered slide places the title and card on the right and the diagram on the left, and `check` reports no overlap or fit finding

#### Scenario: Card offset nudges only the card
- **WHEN** `overrides.slides["market"].cardOffset` is `{ x: -0.5, y: 0.4 }`
- **THEN** the card moves by that amount and the title, diagram and background are unmoved

#### Scenario: Spacing is deck-level only
- **WHEN** `overrides.slides["market"].spacing` is set
- **THEN** `validate` exits non-zero naming the path as an unsupported property, while `overrides.deck.spacing: 60` validates and widens every anchor gap to 60

#### Scenario: Every rail renders the same slide identically
- **WHEN** the same deck is rendered with `overrides.deck.rail` set to each of `line`, `orbit`, `tunnel`, `helix` and `grid`
- **THEN** `check` is clean for every rail, because each rail places the camera at the same slide-local offset and the measured screen rect of a slide's contents is independent of how the slide is turned

#### Scenario: Turned slides measure true
- **WHEN** a slide sits on `orbit` and is therefore rotated about Y
- **THEN** `measure()` reports the same screen rect it would report for the identical slide on `line`, so a turned slide never raises a `fit` finding a straight one would not

#### Scenario: Knob edit is visible in output
- **WHEN** `overrides.nodes["<slideId>/<nodeId>"].shape` is set to `circle` for a `rect` node in `deck.json` and the deck is re-rendered
- **THEN** the rendered node uses the circle primitive and no other slide differs

#### Scenario: Reworded label
- **WHEN** a diagram label text in the IR is edited
- **THEN** the rendered label shows the edited text with the same font and outline treatment

#### Scenario: Check suggestions are real keys
- **WHEN** `check` suggests an `overrides` key for a finding
- **THEN** that key is spelled in the `overrides` grammar (e.g. `overrides.slides["<slideId>"].labels.size`, never a derived `slides[n]` path), is defined in the schema and documented in the field reference

#### Scenario: Built kind via override
- **WHEN** `overrides.slides["market"].diagram.kind` is `bars` and `diagram.data` is `{ labels: ["2026","2031"], values: [3, 9] }` on a slide without a mermaid block
- **THEN** the rendered slide shows two columns with heights in ratio 3:9 labelled `2026` and `2031`

#### Scenario: Negative value rejected
- **WHEN** `overrides.slides["market"].diagram.data.values` is `[3, -1]`
- **THEN** `validate` exits non-zero naming `overrides.slides["market"].diagram.data.values[1]` and `minimum 0`

#### Scenario: New palette validates
- **WHEN** `overrides.deck.palette` is `ember`
- **THEN** `validate` exits 0 and the rendered deck uses the `ember` colours in both modes

### Requirement: Overrides survive re-parse
User edits SHALL be recorded under a dedicated `overrides` block with a single schema-enforced grammar: `deck`, `effects[]`, `props[]`, `slides{<slideId>}`, `nodes{<slideId>/<nodeId>}`, `edges{<slideId>/<edgeId>}`. Objects deep-merge over derived values; arrays replace; `slides{}.diagram.data` replaces as a whole object. Slide ids SHALL be the ASCII-folded title slug (`-<ordinal>` on collision) unless pinned by `# Title {#id}`; edge ids SHALL be `<from>-><to>#<k>` by source order. Re-running parse on updated markdown SHALL regenerate derived fields and reapply every override whose target id still exists. Markdown inline overrides SHALL win over a `deck.json` override on the same key, with a warning. A `diagram.kind` or `diagram.data` override on a slide that carries a supported mermaid block SHALL be kept but ignored, with a warning naming the key. Parse SHALL store `meta.derivedHash` over the derived fields so `validate` can detect edits made outside `overrides` without the markdown. `deck3d overrides apply <deck.json> <file>` SHALL merge a file in the `overrides` grammar into `overrides` under the same rules and re-validate.

#### Scenario: Slide re-parsed after override
- **WHEN** a slide has an override `mode: light` and its bullets are edited in markdown, then parse runs again
- **THEN** the new bullets appear and the slide is still in light mode

#### Scenario: Override target vanished
- **WHEN** an override targets a node id that no longer exists in the diagram source
- **THEN** parse keeps the override, emits a warning naming the orphan id, and exits 0; a subsequent `validate`/`render` treats the orphan as a warning, not an error

#### Scenario: Title rename with pinned id
- **WHEN** a slide heading `# Architektúra {#arch}` is renamed to `# Rendszer-architektúra {#arch}` and re-parsed
- **THEN** `overrides.slides["arch"]` still applies and no orphan warning is emitted

#### Scenario: Title rename without pin
- **WHEN** an unpinned slide's title changes and `overrides.slides` has an entry for its old slug
- **THEN** parse warns naming the orphan and suggests adding `{#<old-slug>}` to the heading

#### Scenario: Inline override clobbers deck.json
- **WHEN** markdown sets `<!-- deck3d: {"mode":"light"} -->` on a slide whose `deck.json` override has `mode: dark`
- **THEN** parse writes `light`, warns naming the key, and exits 0

#### Scenario: Edit outside overrides detected
- **WHEN** `slides[2].nodes[0].position` is edited directly and `validate deck.json` runs
- **THEN** `validate` warns that `meta.derivedHash` mismatches and the edit will be lost on re-parse

#### Scenario: Mermaid wins over built kind
- **WHEN** `overrides.slides["flow"].diagram.kind` is `brain` and the markdown later gains a `flowchart` block on that slide
- **THEN** parse renders the flowchart, keeps the override, and warns that `overrides.slides["flow"].diagram.kind` is ignored while the slide has a mermaid diagram

#### Scenario: Data replaces, never merges
- **WHEN** derived `diagram.data` is `{ labels: [a,b], values: [1,2] }` and the override sets `diagram.data: { labels: [x,y] }`
- **THEN** the merged view has `diagram.data` equal to `{ labels: [x,y] }` with no `values`

#### Scenario: Overrides apply merges
- **WHEN** `deck3d overrides apply deck.json export.json` runs with `export.json` = `{ slides: { geo: { camera: { distance: 11 } } } }` and `overrides.slides.geo` already has `mode: light`
- **THEN** `overrides.slides.geo` becomes `{ mode: "light", camera: { distance: 11 } }` and `validate` exits 0

### Requirement: IR is schema-validated
A JSON Schema SHALL define the IR. `validate` SHALL reject unknown fields, wrong types, out-of-range values, and dangling id references inside derived data (e.g. an edge to a missing node), reporting the JSON path of each violation; a dangling `overrides` target SHALL be a warning. When the deck's directory is known, `validate` SHALL also resolve every `local:` effect reference (file present, `sha256` matches, card present and valid, card kind allowed, size within cap) and report a mismatch as an error naming the override path and the file. `render` SHALL run the same validation before rendering.

#### Scenario: Bad edit fails before render
- **WHEN** `deck.json` sets `depthRelief: "high"` (string where a number is required)
- **THEN** `render` exits non-zero and prints the offending JSON path and expected type; no HTML is written

#### Scenario: Valid IR passes
- **WHEN** an unmodified parse output is validated
- **THEN** `validate` exits 0 with no warnings

#### Scenario: Missing local effect file
- **WHEN** `overrides.slides["geo"].effects` references `local:globe` and `fx/globe.js` does not exist beside `deck.json`
- **THEN** `validate` exits non-zero naming `overrides.slides["geo"].effects[0]` and `fx/globe.js`
