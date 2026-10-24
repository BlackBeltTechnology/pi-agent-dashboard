# Spec Delta — dashboard-shell-slots

## MODIFIED Requirements

### Requirement: `editor-pane-tab` slot

The slot taxonomy SHALL include the slot id `editor-pane-tab`, with multiplicity `many`, React-only payload, and predicate input `never`. Each claim SHALL carry a body component name and a `pathPrefix`. It MAY carry a label component name and a `fileExtensions` list (see `editor-pane-plugin-tabs`). The body props SHALL carry the tab path, the session, an `isActive` flag, a close callback and the plugin context. The label props SHALL carry the tab path, the session and the plugin context. All claim fields SHALL survive manifest normalization and registry generation unchanged. Adding the slot SHALL be a minor version of `pi-dashboard-shared`. Plugins that do not reference it SHALL be unaffected.

#### Scenario: Validator accepts a well-formed claim
- **WHEN** a manifest declares an `editor-pane-tab` claim with a non-empty component and `pathPrefix: "browser"`
- **THEN** the validator SHALL accept it as a known slot

#### Scenario: Validator rejects a claim without a prefix
- **WHEN** a manifest declares an `editor-pane-tab` claim with no `pathPrefix`
- **THEN** the validator SHALL throw a manifest validation error naming the plugin and the slot

#### Scenario: Claim fields reach the runtime registry
- **WHEN** a plugin's `editor-pane-tab` claim declares `pathPrefix`, a label component and `fileExtensions`, and the registry is generated
- **THEN** the runtime claim entry SHALL expose the same `pathPrefix`, label component and `fileExtensions`

#### Scenario: Claim field edits change the registry hash
- **WHEN** a plugin changes only its `editor-pane-tab` claim's `pathPrefix`, label component or `fileExtensions`
- **THEN** the plugin registry hash SHALL change

#### Scenario: Missing label export fails generation
- **WHEN** a claim names a label component that the plugin's client entry does not export
- **THEN** registry generation SHALL fail with an error naming the plugin and the missing export

#### Scenario: Predicate classification
- **WHEN** type-checking `SlotPredicateInput<"editor-pane-tab">`
- **THEN** the resolved type SHALL be `never`
