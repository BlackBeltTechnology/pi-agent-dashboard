## Purpose

Convert ```mermaid code blocks inside slide markdown into the graph IR consumed by the 3D builders — reusing Mermaid's own parser and layout engine rather than reimplementing either.

## ADDED Requirements

### Requirement: Supported diagram types
The harvest SHALL convert `flowchart` / `graph` (directions TD, TB, BT, LR, RL) and `sequenceDiagram` blocks. Any other diagram type SHALL be reported as unsupported.

#### Scenario: Flowchart converted
- **WHEN** a slide contains a ```mermaid `flowchart LR` block
- **THEN** the slide's IR `diagram.kind` is `flowchart` with `dir: LR`, and every node and edge from the source is present

#### Scenario: Sequence converted
- **WHEN** a slide contains a ```mermaid `sequenceDiagram` block
- **THEN** the IR contains the actors in declaration order and the messages in source order, each with sender, receiver, text and solid/dotted kind

#### Scenario: Unsupported type
- **WHEN** a slide contains a ```mermaid `gantt` block
- **THEN** parse emits a warning naming the slide and diagram type, the slide's `diagram` is `none`, and parse exits 0

#### Scenario: Syntax error in a supported type
- **WHEN** a slide contains a ```mermaid `flowchart` block that mermaid fails to parse
- **THEN** parse exits non-zero naming the slide id and the mermaid error text; no `deck.json` is written

### Requirement: Semantics come from the diagram model, layout from the rendered output
Node shape, edge kind, labels, subgraph membership and direction SHALL be taken from the diagram's semantic model. Node positions, node sizes and edge path geometry SHALL be taken from the diagram engine's rendered layout, normalised to a unit-free coordinate space in the IR.

#### Scenario: Shapes preserved
- **WHEN** the source uses `[box]`, `([stadium])`, `{{hexagon}}`, `((circle))`, `{diamond}`
- **THEN** the IR node `shape` is respectively `rect`, `stadium`, `hexagon`, `circle`, `diamond`

#### Scenario: Edge kinds preserved
- **WHEN** the source uses `-->`, `-.->`, `==>|label|`
- **THEN** the IR edge `kind` is respectively `normal`, `dotted`, `thick`, and the third edge carries `label`

#### Scenario: Layout follows the engine
- **WHEN** two nodes are placed left-to-right by the diagram engine
- **THEN** their IR `x` order matches the rendered order, and each edge's `path` samples follow the rendered curve (not a straight line between centres)

#### Scenario: Subgraph membership
- **WHEN** nodes are declared inside `subgraph Title ... end`
- **THEN** the IR lists a group with that title containing exactly those node ids

### Requirement: Hungarian text round-trips
Labels containing `á é í ó ö ő ú ü ű` and their capitals SHALL appear unchanged in the IR.

#### Scenario: Accented labels
- **WHEN** a node is labelled `Megfigyelés` and an actor `Fejlesztő`
- **THEN** the IR strings are identical to the source

### Requirement: Harvest is build-time only
Harvesting SHALL run in a headless browser during parse, with a 60 s timeout per mermaid block; on timeout parse SHALL exit non-zero naming the slide. The rendered deck SHALL NOT include the diagram engine or perform harvesting at view time.

#### Scenario: Harvest hangs
- **WHEN** the harness page does not resolve a block's render within 60 s
- **THEN** parse exits non-zero naming the slide id and `timeout`, and the browser process is closed

#### Scenario: No browser available
- **WHEN** parse runs on a host without a usable headless browser and the deck contains a mermaid block
- **THEN** parse exits non-zero with a message that names the missing prerequisite and how to install it

#### Scenario: Output has no diagram engine
- **WHEN** a rendered `deck.html` is inspected
- **THEN** it contains no reference to the diagram engine's script and no network request for it

### Requirement: Diagram engine version is pinned
The harvest SHALL depend on an exact diagram-engine version, and a fixture per supported diagram type SHALL fail if the engine's rendered id or structure scheme changes.

#### Scenario: Engine upgrade breaks ids
- **WHEN** the pinned engine is bumped to a version with a different rendered element id scheme
- **THEN** the fixture test for that diagram type fails, naming the first node it could not locate
