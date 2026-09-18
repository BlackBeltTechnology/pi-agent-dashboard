## Purpose

The Deck IR (`deck.json`) is the documented, validated intermediate representation between a markdown slide source and the rendered 3D deck. It is the surface an LLM (or a human) edits to fine-tune the converted result without touching engine code.

## ADDED Requirements

### Requirement: Parse is deterministic
The parse step SHALL produce a byte-identical `deck.json` for the same markdown input, same package version, and same pinned diagram-engine version. The IR SHALL NOT contain timestamps, random ids, or host-specific paths.

#### Scenario: Re-parse of unchanged source
- **WHEN** the same `deck.md` is parsed twice
- **THEN** the two `deck.json` outputs are byte-identical

#### Scenario: Node ids are stable
- **WHEN** a slide contains a diagram
- **THEN** every node and edge id in the IR derives from the author's diagram source (node names, message order), not from render-time counters

### Requirement: IR carries every visual knob the renderer consumes
The IR SHALL expose, as plain JSON, every parameter the renderer reads: deck-level defaults (mode, palette, material, transition, camera rail, depth relief, background intensity, quality), per-slide values (title, subtitle, bullets, background scene, diagram, `diagram.scale`/`diagram.offset`, `camera.distance`, `labels.size`, `check.ignore` id list, `effects[]` derived defaults), deck-level and per-slide `overrides.effects[]` (`{id, params}`), and per-diagram geometry (node position/size/shape/group, edge path samples/kind/label, layout direction). The renderer SHALL NOT read hidden state outside the IR.

#### Scenario: Knob edit is visible in output
- **WHEN** `overrides.nodes["<slideId>/<nodeId>"].shape` is set to `circle` for a `rect` node in `deck.json` and the deck is re-rendered
- **THEN** the rendered node uses the circle primitive and no other slide differs

#### Scenario: Reworded label
- **WHEN** a diagram label text in the IR is edited
- **THEN** the rendered label shows the edited text with the same font and outline treatment

#### Scenario: Check suggestions are real keys
- **WHEN** `check` suggests an `overrides` key for a finding
- **THEN** that key is spelled in the `overrides` grammar (e.g. `overrides.slides["<slideId>"].labels.size`, never a derived `slides[n]` path), is defined in the schema and documented in the field reference

### Requirement: Overrides survive re-parse
User edits SHALL be recorded under a dedicated `overrides` block with a single schema-enforced grammar: `deck`, `effects[]`, `props[]`, `slides{<slideId>}`, `nodes{<slideId>/<nodeId>}`, `edges{<slideId>/<edgeId>}`. Objects deep-merge over derived values; arrays replace. Slide ids SHALL be the ASCII-folded title slug (`-<ordinal>` on collision) unless pinned by `# Title {#id}`; edge ids SHALL be `<from>-><to>#<k>` by source order. Re-running parse on updated markdown SHALL regenerate derived fields and reapply every override whose target id still exists. Markdown inline overrides SHALL win over a `deck.json` override on the same key, with a warning. Parse SHALL store `meta.derivedHash` over the derived fields so `validate` can detect edits made outside `overrides` without the markdown.

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

### Requirement: IR is schema-validated
A JSON Schema SHALL define the IR. `validate` SHALL reject unknown fields, wrong types, out-of-range values, and dangling id references inside derived data (e.g. an edge to a missing node), reporting the JSON path of each violation; a dangling `overrides` target SHALL be a warning. `render` SHALL run the same validation before rendering.

#### Scenario: Bad edit fails before render
- **WHEN** `deck.json` sets `depthRelief: "high"` (string where a number is required)
- **THEN** `render` exits non-zero and prints the offending JSON path and expected type; no HTML is written

#### Scenario: Valid IR passes
- **WHEN** an unmodified parse output is validated
- **THEN** `validate` exits 0 with no warnings

### Requirement: Field reference is documented
Every IR field SHALL have a one-line description of its visual effect and allowed values, published with the skill so an editing agent can choose a knob without reading engine source.

#### Scenario: Agent looks up a knob
- **WHEN** the skill's IR reference is opened
- **THEN** each field of the schema appears with its effect, type, default, and range
