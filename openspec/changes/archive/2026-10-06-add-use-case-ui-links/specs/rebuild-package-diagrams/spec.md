## ADDED Requirements

### Requirement: Use-case UI links
The skill SHALL accept per-use-case link records `diagrams/uc-links/<UC-id>.json` that connect BPMN steps to UI actions with evidence, gate them with `check-uc-links`, and merge them into the use case's screens and UI actions.

#### Scenario: Candidate draft
- **WHEN** `uc-link-draft <pkg> <UC-id> <out>` runs
- **THEN** it lists the UI actions whose guard or effect refs intersect the use case's refs, ranked by overlap

#### Scenario: Evidence required
- **WHEN** a link shares no ref with the use case and carries no cite inside the action's handler or effect cites
- **THEN** `check-uc-links` fails naming the link

#### Scenario: Step must exist
- **WHEN** a link's `step` is not a task id of the use case's BPMN flows
- **THEN** `check-uc-links` fails

#### Scenario: No-UI use case
- **WHEN** a record has no links
- **THEN** it MUST carry a `noUi` reason, else the gate fails

#### Scenario: Completeness
- **WHEN** `check-uc-links --complete` runs and a use case has no record
- **THEN** it fails listing the use case

#### Scenario: Merge
- **WHEN** `build-site` runs with gated link records
- **THEN** each use case's screens and UI actions include the linked ones, and the CRUD, IFML and flow views use the merged set
