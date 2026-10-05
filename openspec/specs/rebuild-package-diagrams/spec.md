# rebuild-package-diagrams Specification

## Purpose
Define the contract of the `rebuild-package-diagrams` skill: visual and browsable views over a `reverse-spec-for-rebuild` package — an evidence-gated ER diagram of its entities, use cases as traceable BPMN flows, and one self-contained HTML catalog that merges selected use cases — where every drawn element is checked against the package by a deterministic script.

## Requirements

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

### Requirement: Gated use-case catalog

Use cases SHALL be recorded in `diagrams/use-cases.json` (`id`, `name`, `actor`, `trigger`, `requirements[]` as `spec:<cap>#<Requirement>`, `refs[]`, `entities[]`, optional `bpmn` path relative to the diagrams dir). `diagrams.mjs check-use-cases <packageDir>` SHALL exit 1 listing every requirement or ref that does not resolve in the package, every entity absent from `model.md`, every missing `bpmn` file and every duplicate use-case id.

#### Scenario: Valid catalog passes
- **WHEN** every requirement, ref, entity and bpmn path of `use-cases.json` resolves
- **THEN** `check-use-cases` exits 0

#### Scenario: Unknown entity refused
- **WHEN** a use case lists an entity absent from `model.md`
- **THEN** `check-use-cases` exits 1 naming the use case and the entity

### Requirement: Single-file browsable catalog

`diagrams.mjs build-site <packageDir> <out.html> [--bpmn-js <file>] [--bpmn-css <file>]... [--mermaid <file>]` SHALL write one self-contained HTML file embedding the package (capability requirements with scenarios and cites, rules, quirks, gaps, entities with fields, ER relations, use cases, laid-out BPMN XML and roles) as JSON plus the given viewer libraries inline. The page SHALL let the user select several use cases and show their merged view: flows, the union of requirements, rules/quirks/gaps and an ER sub-diagram of their entities, items shared by two or more selected use cases marked, and related use cases ranked by overlap. Every catalog item SHALL link to the items and use cases that reference it. Without a viewer library the page SHALL still build and SHALL show a notice where the diagram would be.

#### Scenario: Catalog embeds package content
- **WHEN** `build-site` runs on a package with one use case, one requirement and one rule
- **THEN** the HTML contains an embedded JSON block holding the use case, the requirement's scenarios and the rule statement
- **AND** no `</script` sequence from package text breaks the JSON block

#### Scenario: Viewer libraries inlined
- **WHEN** `--bpmn-js` and `--mermaid` files are given
- **THEN** their contents appear inline in the HTML and the page references no external URL for them

#### Scenario: Missing viewer degrades
- **WHEN** no viewer library is given
- **THEN** the HTML is still written and records that the BPMN and ER viewers are unavailable

### Requirement: Gated question register

When `diagrams/questions.json` exists, `build-site` SHALL embed its questions (`id`, `text`, `severity`, optional `status`, `source`, `claim`, `note`, `codeCite`, `group`, and `refs[]` of `BR-`/`QUIRK-`/`GAP-` ids) and SHALL exit 1, naming the question, when a ref does not resolve in the package catalogs or an id is duplicated. Without the file the catalog builds with an empty register.

#### Scenario: Questions embedded with their refs
- **WHEN** `questions.json` holds a question referencing an existing rule
- **THEN** the embedded catalog data contains the question with that ref

#### Scenario: Dangling question ref refused
- **WHEN** a question references `BR-999` absent from `rules.md`
- **THEN** `build-site` exits 1 naming the question id and `BR-999` and writes no HTML

#### Scenario: Duplicate question id refused
- **WHEN** two questions share an id
- **THEN** `build-site` exits 1 naming the duplicated id

### Requirement: Cross-linked catalog parts

The catalog page SHALL link every part both ways: a question to its rules/quirks/gaps and, through them, to the requirements and use cases that reference those items; a rule/quirk/gap to its capabilities, its questions and the flow steps whose documentation references it; a capability to its rules/quirks/gaps and questions; a requirement and a use case to the questions reached through their refs. The merged view SHALL list the open questions of the selected use cases and mark those reached by two or more of them as shared.

#### Scenario: Question reaches use case through a rule
- **WHEN** a question references a rule that a selected use case uses
- **THEN** the merged view lists the question under open questions with that use case

#### Scenario: Rule shows its flow steps
- **WHEN** a flow step's documentation references a rule
- **THEN** the rule's page lists that flow step with its use case

### Requirement: Gated UI model in the catalog

When `ui/screens/*.json` exist, `build-site` SHALL embed the screen and dialog records and the form records from `ui/forms/*.json`, and SHALL exit 1 without writing HTML, naming the record, when a screen, action or dialog id is duplicated, a `guards`, `refs` or effect `refs` entry is not a resolvable `BR-`/`QUIRK-`/`GAP-` id or `spec:<cap>#<Requirement>`, or a screen's `forms[].form` has no form record. Without `ui/` the catalog builds with an empty UI model.

#### Scenario: UI model embedded
- **WHEN** the package holds a screen whose action guards an existing rule and uses an existing form record
- **THEN** the embedded catalog data contains the screen, its action and the form

#### Scenario: Dangling UI ref refused
- **WHEN** a screen action references `BR-999` absent from `rules.md`, or names a form without a record
- **THEN** `build-site` exits 1 naming the screen, `BR-999` and the missing form, and writes no HTML

### Requirement: Use-case screens and alternate flows

`use-cases.json` entries MAY list `screens[]` (screen record ids) and `altFlows[]` (`{label, bpmn}` paths under `diagrams/`). `check-use-cases` and `build-site` SHALL report an unknown screen id or a missing alternate flow file. The catalog SHALL offer every alternate flow next to the main flow and SHALL link use cases and screens in both directions.

#### Scenario: Unknown screen and missing alternate flow refused
- **WHEN** a use case lists screen `SCR-nope` and an alternate flow file that does not exist
- **THEN** `check-use-cases` exits 1 naming `SCR-nope` and the missing file

#### Scenario: Alternate flow embedded
- **WHEN** a use case lists an existing alternate flow labelled "from code"
- **THEN** the embedded use case carries the alternate flow's label and BPMN XML

### Requirement: UI cross-links

The catalog SHALL show a Screens tab, a page per screen or dialog (actions with trigger, handler, guards, effects, dialogs, navigation, forms) and a page per form (fields with labels, type, required, editable, computed, validations, views and cites), and SHALL link: rule/quirk/gap → UI actions that guard, reference or have an effect citing it; requirement → UI actions referencing it; form → screens using it; use case and merged view → their screens and forms.

#### Scenario: Rule page lists the UI actions it guards
- **WHEN** an action of a screen lists `BR-001` as a guard
- **THEN** the page of `BR-001` lists that screen and action
