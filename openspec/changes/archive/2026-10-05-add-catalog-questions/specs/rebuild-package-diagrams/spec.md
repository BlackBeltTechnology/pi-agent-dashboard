## ADDED Requirements

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
