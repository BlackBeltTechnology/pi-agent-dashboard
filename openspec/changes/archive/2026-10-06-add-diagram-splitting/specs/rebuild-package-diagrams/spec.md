## ADDED Requirements

### Requirement: Diagram size budget

The diagram generator SHALL measure every generated diagram against a size budget given as
parameters (`--max-nodes`, default 30; `--max-edges`, default 40; `render.sh` `MAX_NODES` /
`MAX_EDGES`) and SHALL split a diagram over budget into an overview plus parts. Splitting SHALL be
deterministic: the same package and budget SHALL produce byte-identical output. A diagram within
budget SHALL render unchanged.

#### Scenario: Budget from parameters
- **WHEN** `build-site` runs with `--max-nodes 10`
- **THEN** a diagram with 12 nodes is split and a diagram with 8 nodes is not

#### Scenario: Size report
- **WHEN** `check-size <pkg> --strict` finds a part still over budget
- **THEN** it lists the part with its node and edge count and exits 1

### Requirement: IFML areas and parts

The IFML projection SHALL group screens into areas: each route record with the non-route records
it reaches by navigation or dialog opening (ties to the alphabetically first route; unreached
records form a shared area). The catalog SHALL show an overview map of areas with cross-area
navigation counts. Each area within budget SHALL be one part; otherwise each screen SHALL be a
part, and a screen over budget SHALL be split into action groups by trigger kind, chunked to the
budget; adjacent groups that fit together SHALL share one part. Every part SHALL carry its own laid-out IFML XMI that passes `check-ifml`.

#### Scenario: Small groups packed
- **WHEN** a screen over budget has several trigger kinds with one action each
- **THEN** they share one part named after the joined kinds, within budget

#### Scenario: Large screen split by trigger kind
- **WHEN** a screen has toolbar, context-menu and keyboard actions and exceeds the budget
- **THEN** it becomes one part per trigger kind, each within budget, each with its own XMI

#### Scenario: Drill-down
- **WHEN** the reader clicks an area in the IFML overview
- **THEN** the catalog opens that area's part and offers a link back to the overview

### Requirement: Split behaviour diagrams

A state machine over the edge budget SHALL be drawn with transitions between the same two states
merged into one edge labelled with their count; its transitions table and SCXML export SHALL keep
every transition. A sequence over the edge budget SHALL be split into parts of consecutive
top-level steps, each within budget; a fragment SHALL be cut only when it alone exceeds the
budget, and each piece SHALL keep the fragment frame (`alt` label with piece number, `else`
branch as its own piece), and its main
diagram SHALL show each part as a `ref` block linking to it.

#### Scenario: Parallel transitions merged
- **WHEN** a state machine has 5 transitions from `a` to `b` and is over budget
- **THEN** the diagram has one `a --> b` edge labelled `5 transitions` and SCXML still has 5

#### Scenario: Oversized fragment
- **WHEN** one `alt` fragment holds 41 messages with budget 20
- **THEN** it becomes 3 pieces framed `alt <label> (1/3)` … none above 20 messages

#### Scenario: Sequence parts
- **WHEN** a sequence has 45 top-level messages with budget 20
- **THEN** it has 3 parts and a main diagram with 3 `ref` blocks

### Requirement: Split ER sets

An ER entity set over the node budget SHALL be drawn as one diagram per authored ER cluster
(`diagrams/er/*.json` other than `overview.json`) intersecting the set, plus budget-sized chunks
of the remaining entities, in a stable order; adjacent pieces that fit together SHALL share one
diagram, named after the joined clusters.

#### Scenario: Merged use-case view
- **WHEN** selected use cases touch 40 entities with budget 30
- **THEN** the merged view draws one ER per cluster they fall in, none above 30 entities
