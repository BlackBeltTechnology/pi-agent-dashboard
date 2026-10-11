## ADDED Requirements

### Requirement: IFML projection and XMI export

`diagrams.mjs ifml <packageDir> <out.xmi>` SHALL project the package UI model into IFML 1.0 and write an XMI file in namespace `http://www.omg.org/spec/IFML/20140301`: one `Window` per screen or dialog record (`isModal` for dialogs and modal records), one `Form` per referenced form record and per screen with template fields, `SimpleField`/`SelectionField` parts with `ValidationRule` constraints, one event per action (`OnSubmitEvent` when the action validates a form, else `ViewElementEvent`) with a `NavigationFlow` to an `Action` that has a normal `ActionEvent`, an `ActivationExpression` for actions with guards, and `NavigationFlow`s for recorded navigation and dialogs opened from actions. Every element SHALL carry an `Annotation` tracing it to its screen, action, form, field or dialog. The command SHALL exit 2 when the package has no UI model and 1 when its own output fails the conformance check.

#### Scenario: Screen projected to IFML XMI
- **WHEN** the package holds a screen with a form and an action that validates the form, is guarded by a rule and opens a dialog
- **THEN** the XMI contains a `Window` for the screen and a modal `Window` for the dialog, a `Form` with its fields, an `OnSubmitEvent` with an `ActivationExpression`, an `Action` with an `ActionEvent`, and `NavigationFlow`s from event to action and from action event to the dialog

#### Scenario: No UI model
- **WHEN** the package has no `ui/screens`
- **THEN** `ifml` exits 2 and writes nothing

### Requirement: IFML conformance check

`diagrams.mjs check-ifml <file.xmi>` SHALL validate the file against the IFML 1.0 metamodel reference shipped with the skill and exit 1 listing every element whose `xmi:type` is unknown or abstract, every attribute or child feature not declared on the class or a superclass, every id reference that does not resolve, and every repeated single-valued feature.

#### Scenario: Non-conforming XMI refused
- **WHEN** an XMI uses an unknown metaclass, an undeclared feature and a dangling flow target
- **THEN** `check-ifml` exits 1 naming the metaclass, the feature and the dangling id

### Requirement: IFML catalog view

`build-site` SHALL embed the IFML projection and its XMI when the package has a UI model. The catalog SHALL draw the IFML model (windows as containers holding their forms, events, actions and navigation flows), restricted to the screens of the selected use cases when any are selected; clicking an element SHALL open its screen, form or action; screen, use-case and merged views SHALL link to the IFML view; and the page SHALL offer the XMI for download. A use case SHALL list the actions named by `ui: <screen>#<action>` lines in its alternate flows, and `build-site` SHALL exit 1 naming any such line whose screen or action does not exist.

#### Scenario: IFML view filtered to selected use cases
- **WHEN** use cases UC-01 and UC-09 are selected and the IFML view is opened
- **THEN** only the windows of their screens and the dialogs those screens open are drawn, and each element links to its screen or action

#### Scenario: Dangling ui line refused
- **WHEN** an alternate flow documents `ui: SCR-order#ACT-nope` and the screen has no such action
- **THEN** `build-site` exits 1 naming `ACT-nope`
