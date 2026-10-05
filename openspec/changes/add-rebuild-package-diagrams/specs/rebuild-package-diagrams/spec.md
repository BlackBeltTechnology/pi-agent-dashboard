## ADDED Requirements

### Requirement: Skill registration

The `packages/eng-disciplines` package SHALL register the `rebuild-package-diagrams` skill in `package.json` `pi.skills[]`. The skill SHALL NOT reference files outside its own directory; an optional peer skill (`bpmn-package-explorer`) is named, not path-referenced.

#### Scenario: Skill is discoverable
- **WHEN** pi loads the `eng-disciplines` package
- **THEN** `rebuild-package-diagrams` is available with a description naming ER-diagram and BPMN triggers

#### Scenario: Self-contained skill
- **WHEN** every relative `references/` or `scripts/` path in the skill's SKILL.md and references is resolved
- **THEN** each resolves to a file inside the skill directory

### Requirement: Deterministic model extraction

`diagrams.mjs extract-model <model.md>` SHALL parse a reverse-spec `model.md` into JSON listing each `## <Entity>` with its capabilities, identity, persistence, fields (name, type text, required, nullable, confidence) and relationships text, and SHALL flag an entity `persistent` when its persistence line names a table, row, collection or database.

#### Scenario: Entities and fields parsed
- **WHEN** `extract-model` runs on a model with two entities, one carrying a `Persistence: row of table ...` line
- **THEN** the JSON lists both entities with their fields and relationships text
- **AND** only the table-backed entity has `persistent: true`

#### Scenario: Missing file
- **WHEN** the model path does not exist
- **THEN** the command exits 2 and names the path on stderr

### Requirement: Evidence-gated ER rendering

`diagrams.mjs render-er <er.json> <model.json>` SHALL print a Mermaid `erDiagram` for the entities and relations in `er.json`. It SHALL exit 1, listing every violation, when an entity or field is not in the extracted model, or when a relation lacks an `evidence` string found verbatim in the relationships text or field names of either endpoint. Relations with `confidence` other than `confirmed` SHALL render with the dashed (non-identifying) connector.

#### Scenario: Valid ER rendered
- **WHEN** `er.json` names two model entities, a model field, and a `1:N` relation whose evidence occurs in the source entity's relationships text
- **THEN** the output starts with `erDiagram` and contains the relation with a `||--o{` or `||..o{` connector

#### Scenario: Hallucinated entity refused
- **WHEN** `er.json` names an entity absent from the model
- **THEN** the command exits 1 naming the entity

#### Scenario: Unevidenced relation refused
- **WHEN** a relation's evidence text occurs in neither endpoint
- **THEN** the command exits 1 naming the relation

#### Scenario: Inferred relation dashed
- **WHEN** a relation has `confidence: inferred`
- **THEN** its connector uses `..` instead of `--`

### Requirement: Traceable BPMN use cases

Each generated BPMN flow node other than start/end events SHALL carry a `bpmn:documentation` holding at least one package ref (`BR-NNN`, `QUIRK-NNN`, `GAP-NNN` or `spec:<capability>#<Requirement name>`). `diagrams.mjs check-trace <file.bpmn> <packageDir>` SHALL exit 1 listing every undocumented node and every ref that does not resolve in `rules.md`, `quirks.md`, `gaps.md` or the named capability spec's `### Requirement:` headings.

#### Scenario: Fully traced process passes
- **WHEN** every task and gateway documents a ref that exists in the package
- **THEN** `check-trace` exits 0

#### Scenario: Dangling ref refused
- **WHEN** a task documents `BR-999` absent from `rules.md`
- **THEN** `check-trace` exits 1 naming the element id and `BR-999`

#### Scenario: Undocumented node refused
- **WHEN** a gateway has no documentation
- **THEN** `check-trace` exits 1 naming the gateway id
