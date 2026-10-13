## ADDED Requirements

### Requirement: Binding status reads the same everywhere
Every surface that shows a binding status (the roles settings "Used by" list and the Blackhole chain-slot summary) SHALL show `detached` as a warning-severity pill "Detached" and `dangling` as a warning-severity pill "Role unassigned, keeps its last model", keep the raw status in `data-status`, and SHALL show nothing for `ok`. Where a re-attach action exists, the reason ("This slot was edited outside the dashboard, so it no longer follows @<role>.") and a secondary button "Reattach to @<role>" SHALL sit in a warning callout. Status words SHALL NOT be shown as raw codes such as "(detached)" or "(dangling)".

#### Scenario: Used-by shows a detached binding
- **GIVEN** blackhole `observerModel` follows `@fast` with status `detached`
- **WHEN** the Model roles page opens
- **THEN** the `@fast` "Used by" row shows the role through the shared role-ref display, the entry text "blackhole · observerModel", and a warning pill "Detached" with `data-status="detached"`

#### Scenario: Chain slot shows a dangling binding
- **GIVEN** a Blackhole chain entry follows `@research` with status `dangling`
- **THEN** its summary shows the warning pill "Role unassigned, keeps its last model" with `data-status="dangling"`

#### Scenario: Dangling keeps its model, unassigned without a value does not
- **GIVEN** a chain entry follows `@research` with status `dangling` and last model `anthropic/claude-haiku-4-5`, and a second entry was just set to `@research` with no projected model yet
- **THEN** the first shows "claude-haiku-4-5" with the pill "Role unassigned, keeps its last model", and the second shows the pill "No model assigned"

#### Scenario: Re-attach action is labelled with the role
- **GIVEN** a detached chain entry bound to `@coding`
- **THEN** the slot shows a warning callout naming `@coding` with a "Reattach to @coding" button
