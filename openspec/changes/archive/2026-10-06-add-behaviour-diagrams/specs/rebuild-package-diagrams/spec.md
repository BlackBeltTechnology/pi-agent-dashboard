## ADDED Requirements

### Requirement: Gated sequence and collaboration diagrams

The skill SHALL accept sequence records `diagrams/sequences/<id>.json` with participants (actor, screen or dialog, architecture element) and messages that may nest in `alt`, `opt`, `loop` or `par` fragments, SHALL refuse (exit 1, naming the record) an unknown participant, participant ref, use case, UI action, package ref or malformed cite, SHALL derive a draft sequence deterministically from a UI-model action with `sequence-from-ui`, and SHALL project each sequence into a collaboration diagram with numbered messages on participant links.

#### Scenario: Draft from a UI action
- **WHEN** `sequence-from-ui` runs for an action with a guard and effects
- **THEN** the draft holds the user, the screen and the architecture component matched by each effect's cite file, the effects inside an `alt` fragment named by the guard, and passes `check-sequences`

#### Scenario: Dangling participant refused
- **WHEN** a message targets a participant that is not declared
- **THEN** `check-sequences` exits 1 naming the sequence and the participant

### Requirement: Gated state machines

The skill SHALL accept state-machine records `diagrams/state-machines/<id>.json` for one entity field and SHALL refuse an unknown entity or field, a state value not among the field's allowed values in `model.md`, not exactly one initial state, a transition to or from an unknown state, a transition without cite, an unresolved ref, and a state not reachable from the initial state; it SHALL export Mermaid `stateDiagram-v2` and SCXML.

#### Scenario: Unreachable state refused
- **WHEN** a state has no incoming transition and is not initial
- **THEN** `check-states` exits 1 naming the state as unreachable

### Requirement: Gated object diagrams

The skill SHALL accept object records with instances of ER entities and links, SHALL refuse an attribute that is not a field of its entity, a link with no ER relation between the two entities, and a link set that breaks the relation's single-valued side, SHALL generate synthetic instances from the ER diagrams and the model with `objects-synth`, and SHALL extract instances from a JSON database snapshot with `objects-from-db`, refusing a join that matches no ER relation and masking every value whose field is not listed in the job's `keep`.

#### Scenario: Masked extraction
- **WHEN** `objects-from-db` extracts an order with its lines and `keep` lists only `status`
- **THEN** every other attribute value is replaced by a pseudonym, equal source values get equal pseudonyms, and no source value appears in the output

#### Scenario: Local objects stay out of the shared catalog
- **WHEN** a real-data record sits in `PKG/_local/objects/`
- **THEN** `build-site` omits it unless `--local` is given

### Requirement: Behaviour views in the catalog

`build-site` SHALL gate and embed sequences (with collaboration projection), state machines (with SCXML) and object diagrams, and the catalog SHALL show each on its own page with links from and to the rules, quirks, gaps, entities, use cases and screen actions they reference; `behaviour <pkg> <outDir>` SHALL write one Mermaid file per diagram and one SCXML file per state machine.

#### Scenario: Backlink from a rule
- **WHEN** a state-machine transition references `BR-001`
- **THEN** the `BR-001` page lists that state machine
