## ADDED Requirements

### Requirement: Runtime feature-detection governs all new-pi API adoption

The dashboard SHALL adopt every new pi runtime API (introduced above the compatibility `minimum`) behind runtime feature-detection — the presence of the concrete surface (e.g. `typeof ctx.scopedModels !== "undefined"`, acceptance of a `bash_execution_update` subscription, readback of a session env var) — and SHALL NOT gate behavior on the pi version string. Each detected surface SHALL have an explicit fallback path that reproduces the pre-adoption behavior. A session running on any pi at or above the compatibility `minimum` SHALL continue to function with no crash and no behavior regression when a newer surface is absent.

#### Scenario: New surface present is used

- **WHEN** a new pi API surface is detected at runtime
- **THEN** the dashboard SHALL use the enhanced path

#### Scenario: New surface absent falls back cleanly

- **GIVEN** a pi runtime at or above `minimum` that lacks a newer surface
- **WHEN** the dashboard reaches the corresponding code path
- **THEN** it SHALL execute the documented fallback
- **AND** SHALL NOT throw, block the session, or regress prior behavior

### Requirement: The "pending" streaming stop reason SHALL classify as a normal turn

The turn-actionability classifier (`turn-actionability.ts`) SHALL treat an assistant turn whose `stopReason` is `"pending"` (pi ≥ 0.83.0 partial-streaming) as `normal` (an in-progress turn), never as `empty-actionable`. Error precedence SHALL remain unchanged: a `"pending"` turn carrying an error object/message SHALL still classify as `error`, and newly-raw provider terminal stop reasons SHALL continue to resolve through the existing `error`/truncation branches.

#### Scenario: Pending partial is not treated as empty

- **GIVEN** an assistant turn with `stopReason === "pending"` and no visible text or tool call
- **WHEN** the turn is classified
- **THEN** the result SHALL be `normal`
- **AND** SHALL NOT be `empty-actionable`

#### Scenario: Raw provider terminal errors still classify as error

- **GIVEN** an assistant turn whose stop reason maps to a provider error
- **WHEN** the turn is classified
- **THEN** the result SHALL be `error`

### Requirement: outputPad adoption for custom message renderers is feasibility-gated

If the dashboard extension registers a pi custom message renderer, that renderer SHALL consume the `outputPad` setting (pi ≥ 0.82.1) exposed to custom message renderers. The extension registers no such renderer at present; in that case this requirement SHALL be satisfied as a documented no-op — the adoption SHALL NOT introduce a renderer solely to consume `outputPad`, and the absence of a renderer SHALL NOT be treated as a gap.

#### Scenario: Renderer present consumes outputPad

- **GIVEN** the extension registers a pi custom message renderer
- **WHEN** the renderer is invoked
- **THEN** it SHALL honor the `outputPad` setting

#### Scenario: No renderer resolves as a documented no-op

- **GIVEN** the extension registers no pi custom message renderer
- **WHEN** the adoption is evaluated
- **THEN** the requirement SHALL be considered satisfied without adding a renderer
