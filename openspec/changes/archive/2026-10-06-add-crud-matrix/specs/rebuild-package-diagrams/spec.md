## ADDED Requirements

### Requirement: CRUD draft and gate

The diagram tool SHALL draft, per screen, every `write`/`read`/`export`/`call` UI effect with entity
candidates from an alias index of `model.md`, and SHALL gate CRUD records
(`diagrams/crud/<screen>.json`): the screen, action and effect index SHALL exist, the entity SHALL
exist in `model.md`, the op SHALL be one of C, R, U, D, entries SHALL be unique, and every
`write`/`read`/`export`/`call` effect of the screen SHALL be classified or listed as unmapped with a
reason. With `--complete` every screen having such effects SHALL have a record.

#### Scenario: Draft candidates
- **WHEN** an effect target reads `Cal_Resources.___mod(obj)` and `model.md` names table `cal_resources` for `CalResource`
- **THEN** the draft lists `CalResource` among the effect's candidates

#### Scenario: Unclassified effect refused
- **WHEN** a screen record omits one of its screen's write effects
- **THEN** `check-crud` names the effect and exits 1

### Requirement: CRUD matrix, findings and catalog

The diagram tool SHALL assemble an entity × use case matrix (a use case's actions are its UI
actions, else every action of its screens) and an entity × screen matrix from gated records,
SHALL report findings for persistent entities (never written, never read, created but never
deleted, untouched by the UI), SHALL export them as `crud.csv`, `crud-screens.csv` and
`crud-findings.md`, and the catalog SHALL show the matrix with its findings and a CRUD section
on entity and use-case pages. `build-site` SHALL refuse a package whose CRUD records fail the gate.

#### Scenario: Matrix cell
- **WHEN** a use case's UI action creates `Order` and another of its actions reads it
- **THEN** the `Order` row of that use case shows `CR`

#### Scenario: Finding
- **WHEN** persistent entity `Line` is created but never deleted
- **THEN** the findings list `Line` under "created but never deleted"
