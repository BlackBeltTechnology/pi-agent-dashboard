## ADDED Requirements

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
