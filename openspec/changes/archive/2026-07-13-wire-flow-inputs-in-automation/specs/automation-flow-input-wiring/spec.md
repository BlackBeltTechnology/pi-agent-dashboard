## ADDED Requirements

### Requirement: Read a flow's declared inputs read-only

The automation UI SHALL read a selected flow's declared `inputs:` schema from its `flow.yaml` file (name, type, required) to render the wiring form. The automation UI SHALL NOT write, create, or modify any `flow.yaml` file. Flow discovery SHALL return each flow's declared input schema in addition to its id.

#### Scenario: Selected flow's inputs are read

- **WHEN** the user selects a flow that declares `inputs: { invoice: { type: string, required: true }, priority: { type: number } }`
- **THEN** flow discovery SHALL return that input schema for the flow, and the dialog SHALL render one wiring row per declared input.

#### Scenario: Flow files are never written

- **WHEN** the user creates or edits an automation that targets a flow
- **THEN** no `flow.yaml` file SHALL be created or modified by the automation UI or server.

#### Scenario: Flow with no declared inputs

- **WHEN** the user selects a flow that declares no `inputs:`
- **THEN** the wiring form SHALL render no input rows and the automation SHALL still be creatable.

### Requirement: Wire each declared input to a literal or the trigger value

For each declared flow input, the dialog SHALL let the user bind a value that is either a literal (entered per the input's declared type) or the trigger's fired value. The wired values SHALL persist to `automation.yaml` `action.payload.inputs` and SHALL NOT be written anywhere else.

#### Scenario: Bind an input to the trigger value

- **WHEN** the user binds the `invoice` input to the trigger's fired value
- **THEN** `automation.yaml` SHALL contain `action.payload.inputs.invoice` set to the canonical trigger token (`${{trigger}}`).

#### Scenario: Bind an input to a typed literal

- **WHEN** the user enters `5` for the number input `priority`
- **THEN** `automation.yaml` SHALL contain `action.payload.inputs.priority` as the value `5`.

#### Scenario: Re-selecting a flow drops orphan wirings

- **WHEN** the selected flow changes and a previously wired input key is not declared by the new flow
- **THEN** that key SHALL be dropped from `payload.inputs` and the form SHALL re-render from the new flow's schema.

### Requirement: Emit wired inputs on the flow run event with type preservation

The `flows.run` action SHALL emit the wired inputs as `data.inputs` on the `flow:run` event. A literal value SHALL be coerced to the input's declared type; an input bound to the trigger value SHALL receive the per-fire value. pi-flows consumes `data.inputs` as `flowInput` and exposes it as `${{flow.input.<name>}}` unchanged.

#### Scenario: Trigger-bound input carries the per-fire value

- **WHEN** the trigger fires with value `/spool/inv-042.pdf` and `payload.inputs.invoice` is `${{trigger}}`
- **THEN** the emitted `flow:run` event SHALL carry `data.inputs.invoice = "/spool/inv-042.pdf"`.

#### Scenario: Literal input preserves its declared type

- **WHEN** `payload.inputs.priority` is `5` and the flow declares `priority` as `number`
- **THEN** the emitted `data.inputs.priority` SHALL be the number `5`, not the string `"5"`.
