## ADDED Requirements

### Requirement: Module schema SHALL support the rjsf-form view type

The shared package `@blackbelt-technology/pi-dashboard-shared` MUST extend `UiView.kind` to include the literal `"rjsf-form"`. When `view.kind === "rjsf-form"`, the descriptor MUST carry:

- `rjsfSchema: JSONSchema7` — the data schema. Required.
- `rjsfUiSchema?: UiSchema` — RJSF `uiSchema` for layout / widget hints. Optional.
- `rjsfFallback: "ctx-ui" | "defaults" | "reject"` — pure-pi fallback strategy. Required (no default).
- `dataEvent?: string` — submit event name. Optional; defaults to `${module.id}:submit`.
- `initialDataEvent?: string` — optional event name fetched on mount to pre-fill the form.

Schemas MUST be valid JSON Schema draft 7. `$ref` values MUST be internal (`#/...` form) only; descriptors carrying external-URL `$ref` MUST be rejected by the dashboard at parse time with an inline error and MUST NOT be sent to RJSF.

#### Scenario: Well-formed rjsf-form module passes validation
- **WHEN** an extension pushes `{ kind: "management-modal", id: "judo-save", command: "/judo:save", title: "Save Changes", view: { kind: "rjsf-form", rjsfSchema: {...}, rjsfFallback: "reject" } }`
- **THEN** the descriptor passes runtime type validation in the shared package
- **AND** the dashboard interprets `view.kind === "rjsf-form"` and prepares to render an RJSF dialog

#### Scenario: External $ref is rejected
- **WHEN** an `rjsf-form` descriptor carries a schema with `$ref: "https://example.com/schema.json"`
- **THEN** the dashboard renders an inline parse-error message inside the modal
- **AND** the dashboard does NOT pass the schema to RJSF
- **AND** the dashboard does NOT issue any network request for the external `$ref`

#### Scenario: Missing rjsfFallback is a type error at descriptor creation
- **GIVEN** TypeScript build of an extension declaring an `rjsf-form` view without `rjsfFallback`
- **THEN** the `tsc` build fails with a type error citing the missing `rjsfFallback` field

### Requirement: Client SHALL render rjsf-form via lazy-loaded RJSF bundle

`GenericExtensionDialog` MUST render `view.kind === "rjsf-form"` by dynamically importing the RJSF bundle (`@rjsf/core` + `@rjsf/validator-ajv8` + the dashboard's Tailwind theme) on first render. Sessions whose `uiModules` contains no `rjsf-form` module MUST NOT load the RJSF bundle.

The dialog MUST render the RJSF form using the dashboard's bundled Tailwind widget set (`packages/client/src/components/extension-ui/rjsf-theme/`). The widget set MUST cover at minimum: text input, number input, checkbox, select, textarea, date input, array field, object field, error list, base field template.

While the RJSF bundle is loading, the dialog MUST display a loading indicator and MUST NOT show the form skeleton.

#### Scenario: RJSF bundle loads on first rjsf-form open
- **GIVEN** a session whose `uiModules` contains exactly one `rjsf-form` module
- **AND** the user has not yet opened the modal in this session
- **WHEN** the user invokes the matching slash command
- **THEN** the dashboard issues a network request for the RJSF chunk
- **AND** displays a loading indicator until the chunk resolves
- **AND** then renders the form

#### Scenario: No RJSF chunk loads when no rjsf-form module exists
- **GIVEN** a session whose `uiModules` contains only `form` / `table` / `grid` views (no `rjsf-form`)
- **WHEN** the dashboard initializes and the user uses the app normally
- **THEN** no network request for the RJSF chunk is issued

### Requirement: Client SHALL validate via AJV before submit

The dashboard MUST run RJSF's AJV-8 validation on form submission. On validation error, the dashboard MUST:

- prevent the `ui_management { action: "submit" }` dispatch,
- render RJSF's per-field error messages inline next to the affected fields,
- keep the modal open so the user can correct the input.

On valid submit, the dashboard MUST dispatch `ui_management { sessionId, action: "submit", event: <view.dataEvent ?? `${module.id}:submit`>, params: <validated form data> }` to the server.

#### Scenario: Invalid input blocks submit
- **GIVEN** an `rjsf-form` schema requiring `name: { type: "string", minLength: 1 }`
- **WHEN** the user clicks Submit with an empty `name` field
- **THEN** the dashboard does NOT send a `ui_management` message
- **AND** the form displays an inline error next to the `name` field
- **AND** the modal remains open

#### Scenario: Valid submit dispatches ui_management
- **GIVEN** the same schema and the user has typed `"abc"` into `name`
- **WHEN** the user clicks Submit
- **THEN** the dashboard sends `ui_management { sessionId, action: "submit", event: "<inferred>", params: { name: "abc" } }`

### Requirement: Bridge SHALL handle async submit reply errors

The bridge MUST forward `ui_management { action: "submit", ... }` to extensions via `pi.events.emit(event, { params, action: "submit", _reply })`. Extensions MAY call `_reply({ ok: false, error: "..." })` to reject the submit; the dashboard MUST surface the error string in an inline banner above the submit button without closing the modal.

`_reply({ ok: true })` (or `_reply()` with no argument) MUST close the modal. If the extension never replies within 30 seconds, the dashboard MUST display a generic timeout error in the same banner and re-enable the submit button.

#### Scenario: Extension rejects submit
- **GIVEN** the user submits a valid form
- **WHEN** the extension's handler calls `_reply({ ok: false, error: "URL is not reachable" })`
- **THEN** the dashboard displays "URL is not reachable" in an error banner inside the modal
- **AND** the modal stays open
- **AND** the submit button is re-enabled

#### Scenario: Extension confirms submit
- **WHEN** the extension's handler calls `_reply({ ok: true })`
- **THEN** the dashboard closes the modal
- **AND** the dashboard does NOT keep the form state for re-open

#### Scenario: No reply within timeout
- **GIVEN** the user submits a valid form
- **WHEN** the extension does not call `_reply` within 30 seconds
- **THEN** the dashboard displays a generic timeout error banner
- **AND** the submit button is re-enabled so the user can retry

### Requirement: Bridge SHALL enforce pure-pi fallback strategy for rjsf-form

When the bridge has no active dashboard server connection AND the user invokes a slash command bound to an `rjsf-form` module, the bridge MUST execute the strategy declared in `view.rjsfFallback`:

- `"ctx-ui"`: the bridge MUST iterate the schema's top-level `properties` and prompt the user via the matching `ctx.ui.*` primitive for each primitive-typed property (`string` → `ctx.ui.input`; `boolean` → `ctx.ui.confirm`; `number`/`integer` → `ctx.ui.input` with numeric coercion; `string` with `enum` → `ctx.ui.select`). Properties whose type is `object`, `array`, or otherwise non-primitive MUST be skipped (the assembled object omits them). The bridge MUST return the assembled object via the slash command's output channel.
- `"defaults"`: the bridge MUST synchronously assemble an object from the schema's top-level `default` values (or `const` values where present) and return it without prompting the user.
- `"reject"`: the bridge MUST throw `NoDashboardError` from the slash-command handler. The error message MUST identify the offending command for debuggability.

The bridge MUST NOT attempt to render or simulate RJSF in pure-pi.

#### Scenario: ctx-ui fallback prompts top-level primitives
- **GIVEN** a pure-pi session with no dashboard connection
- **AND** an `rjsf-form` module whose schema is `{ properties: { name: { type: "string" }, force: { type: "boolean" } } }` and `rjsfFallback: "ctx-ui"`
- **WHEN** the user invokes the matching slash command
- **THEN** the bridge calls `ctx.ui.input("name")` and `ctx.ui.confirm("force")` in declared order
- **AND** the bridge returns `{ name: <input>, force: <confirm> }`

#### Scenario: defaults fallback returns schema defaults
- **GIVEN** a pure-pi session and `rjsfFallback: "defaults"` with schema `{ properties: { mode: { type: "string", default: "auto" } } }`
- **WHEN** the user invokes the matching slash command
- **THEN** the bridge synchronously returns `{ mode: "auto" }`
- **AND** no `ctx.ui.*` prompt is issued

#### Scenario: reject fallback throws NoDashboardError
- **GIVEN** a pure-pi session and `rjsfFallback: "reject"`
- **WHEN** the user invokes the matching slash command
- **THEN** the slash-command handler throws `NoDashboardError`
- **AND** the error message identifies the offending command

#### Scenario: ctx-ui silently skips non-primitive properties
- **GIVEN** `rjsfFallback: "ctx-ui"` and a schema with a top-level `array` property
- **WHEN** the bridge runs the fallback
- **THEN** the bridge does NOT prompt for the array property
- **AND** the assembled return object omits the array property

### Requirement: Dashboard SHALL not render extension HTML through dangerous sinks

The Tailwind RJSF theme (`packages/client/src/components/extension-ui/rjsf-theme/`) and the `rjsf-form` rendering path MUST NOT use `dangerouslySetInnerHTML` anywhere. All extension-supplied text (schema `description`, `title`, custom error messages, enum labels) MUST flow through React text nodes only.

#### Scenario: Schema description does not allow HTML injection
- **GIVEN** an `rjsf-form` schema with `description: "<img src=x onerror=alert(1)>"`
- **WHEN** the dashboard renders the form
- **THEN** the literal string is shown as visible text, not interpreted as HTML
- **AND** no `<img>` element appears in the DOM
