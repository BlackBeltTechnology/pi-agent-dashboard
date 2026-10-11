## MODIFIED Requirements

### Requirement: IFML projection and XMI export

`diagrams.mjs ifml <packageDir> <out.xmi>` SHALL project the package UI model into IFML 1.0 and write an XMI file in namespace `http://www.omg.org/spec/IFML/20140301`: one `Window` per screen or dialog record (`isModal` for dialogs and modal records), one `Form` per referenced form record and per screen with template fields, `SimpleField`/`SelectionField` parts with `ValidationRule` constraints, one event per action (`OnSubmitEvent` when the action validates a form, else `ViewElementEvent`) with a `NavigationFlow` to an `Action` that has a normal `ActionEvent`, an `ActivationExpression` nested in the event for actions with guards, and `NavigationFlow`s for recorded navigation and dialogs opened from actions. Element ids SHALL encode the trace as dot-separated parts (`W.<screen>`, `F.<screen>.<form>`, `P.<screen>.<form>.<field>`, `E.<screen>.<action>`, `A.<screen>.<action>`, `AE.<screen>.<action>`, `X.<screen>.<action>`, `VR.<screen>.<form>.<field>.<n>`). The file SHALL carry IFML-DI geometry (`IFMLDiagram`, `IFMLNode` bounds, `IFMLConnection` waypoints) for every window, form, field, event, guard, action and flow, from a deterministic layout. The command SHALL exit 2 when the package has no UI model and 1 when its own output fails the conformance check.

#### Scenario: Screen projected to IFML XMI
- **WHEN** the package holds a screen with a form and an action that validates the form, is guarded by a rule and opens a dialog
- **THEN** the XMI contains a `Window` for the screen and a modal `Window` for the dialog, a `Form` with its fields, an `OnSubmitEvent` containing an `ActivationExpression`, an `Action` with an `ActionEvent`, `NavigationFlow`s from event to action and from action event to the dialog, and an `IFMLNode` or `IFMLConnection` for each of them

#### Scenario: No UI model
- **WHEN** the package has no `ui/screens`
- **THEN** `ifml` exits 2 and writes nothing

## ADDED Requirements

### Requirement: IFML rendering with an IFML viewer

`build-site` SHALL accept `--ifml-js <file>` and `--ifml-css <file>` (repeatable) and inline them. When present, the catalog IFML view SHALL render the embedded XMI with that viewer, zoom to the in-scope windows, dim out-of-scope elements, highlight actions named by the shown use cases, and open the screen, form or action of a clicked element; without them the existing diagram fallback SHALL be used.

#### Scenario: IFML viewer inlined
- **WHEN** `build-site` is given `--ifml-js` and `--ifml-css` files
- **THEN** the HTML contains both files inline and the embedded data reports the IFML viewer as available

### Requirement: IFML import to a UI model

`diagrams.mjs ifml-to-ui <file.xmi> <outDir>` SHALL write `ui/screens/*.json` and `ui/forms/*.json` from any IFML XMI: windows to screen records (dialog windows reached only from action events to the dialogs of the source screen), forms and fields to form records or template fields, events to actions (label, guards from the nested activation expression), actions to an effect step, navigation flows between windows to navigation. Record and action ids SHALL come from dot-separated trace ids when present, else from the element names; every record SHALL carry `source: "ifml"`.

#### Scenario: Export then import preserves the IFML model
- **WHEN** a package UI model is exported with `ifml` and the file is imported with `ifml-to-ui`
- **THEN** exporting the imported UI model yields the same IFML elements (ids, types, names, owners) and flows

### Requirement: IFML round-trip diff and apply

`diagrams.mjs ifml-diff <packageDir> <file.xmi>` SHALL compare the IFML file with the package UI model element by element and list added, removed and changed elements (name, guard body, validation body) and added or removed flows, exiting 1 when they differ and 0 when equal. With `--apply` it SHALL merge additions, renames, guard and validation changes into the package `ui/` records, keep every existing cite and effect, mark added items `source: "ifml"`, never apply removals (only report them), and leave a UI model that passes the UI gate.

#### Scenario: Edited IFML diffed and applied
- **WHEN** an exported IFML file is edited to rename an action, add a new event with an action on a screen, change a guard and delete an event
- **THEN** `ifml-diff` exits 1 listing the rename, the added elements, the guard change and the removal; with `--apply` the package action carries the new label and guard, the new action exists with `source: "ifml"`, the deleted action is still present, and a second `ifml-diff` reports only the removal
