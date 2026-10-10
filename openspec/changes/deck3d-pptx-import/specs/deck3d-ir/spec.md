## MODIFIED Requirements

### Requirement: Overrides survive re-parse
User edits SHALL be recorded under a dedicated `overrides` block with a single schema-enforced grammar: `deck`, `effects[]`, `props[]`, `assets[]`, `slides{<slideId>}`, `nodes{<slideId>/<nodeId>}`, `edges{<slideId>/<edgeId>}`. Objects deep-merge over derived values; arrays replace; `slides{}.diagram.data` replaces as a whole object. Slide ids SHALL be the ASCII-folded title slug (`-<ordinal>` on collision) unless pinned by `# Title {#id}`; edge ids SHALL be `<from>-><to>#<k>` by source order. Re-running parse on updated markdown SHALL regenerate derived fields and reapply every override whose target id still exists. Markdown inline overrides SHALL win over a `deck.json` override on the same key, with a warning. A `diagram.kind` or `diagram.data` override on a slide that carries a supported mermaid block SHALL be kept but ignored, with a warning naming the key. Parse SHALL store `meta.derivedHash` over the derived fields so `validate` can detect edits made outside `overrides` without the markdown. `deck3d overrides apply <deck.json> <file>` SHALL merge a file in the `overrides` grammar into `overrides` under the same rules and re-validate.

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

#### Scenario: Assets survive re-parse
- **WHEN** `overrides.assets` lists 12 entries and the markdown is edited and re-parsed
- **THEN** all 12 entries are still present unchanged

### Requirement: IR is schema-validated
A JSON Schema SHALL define the IR. `validate` SHALL reject unknown fields, wrong types, out-of-range values, and dangling id references inside derived data (e.g. an edge to a missing node), reporting the JSON path of each violation; a dangling `overrides` target SHALL be a warning. When the deck's directory is known, `validate` SHALL also resolve every `local:` effect reference (file present, `sha256` matches, card present and valid, card kind allowed, size within cap) and report a mismatch as an error naming the override path and the file. It SHALL likewise resolve every `overrides.assets` entry (file present inside the deck directory, `sha256` matches, allowed mime, unique id) and SHALL reject a card with `persistent: true` referenced outside deck-scope `overrides.effects`, each as an error naming the override path. `render` SHALL run the same validation before rendering.

#### Scenario: Bad edit fails before render
- **WHEN** `deck.json` sets `depthRelief: "high"` (string where a number is required)
- **THEN** `render` exits non-zero and prints the offending JSON path and expected type; no HTML is written

#### Scenario: Valid IR passes
- **WHEN** an unmodified parse output is validated
- **THEN** `validate` exits 0 with no warnings

#### Scenario: Missing local effect file
- **WHEN** `overrides.slides["geo"].effects` references `local:globe` and `fx/globe.js` does not exist beside `deck.json`
- **THEN** `validate` exits non-zero naming `overrides.slides["geo"].effects[0]` and `fx/globe.js`

#### Scenario: Asset outside the deck directory
- **WHEN** `overrides.assets[0].path` is `../../etc/hosts`
- **THEN** `validate` exits non-zero naming `overrides.assets[0].path`
