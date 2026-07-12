## ADDED Requirements

### Requirement: Detect empty-actionable assistant turns

The system SHALL classify an assistant turn as **empty-actionable** when the turn reaches a terminal, non-error stop (e.g. `stopReason` = `stop`, not `length`/`max_tokens`, and no provider error) AND the turn's content contains **no visible text part** and **no tool call** — i.e. the content is thinking-only or wholly empty. This classification SHALL be distinct from both a normally-completed turn (has text or a tool call) and an errored turn (carries a provider/adapter error).

Evidence anchor (captured live): `content = [thinking]`, `usage.output` entirely `reasoning`, zero visible-text tokens, no tool call, `stopReason = stop`, `error = {}`.

#### Scenario: Thinking-only stop is classified as empty-actionable
- **WHEN** an assistant turn completes with `stopReason = stop`, content consisting only of a thinking block, zero text parts, and no tool call
- **THEN** the system SHALL classify the turn as empty-actionable
- **AND** SHALL NOT treat it as a normally-completed turn

#### Scenario: Wholly empty completion is classified as empty-actionable
- **WHEN** an assistant turn completes with `stopReason = stop` and empty content (no text, no thinking, no tool call)
- **THEN** the system SHALL classify the turn as empty-actionable

#### Scenario: Length-truncated turn is NOT empty-actionable
- **WHEN** an assistant turn ends with `stopReason = length`/`max_tokens`
- **THEN** the system SHALL NOT classify it as empty-actionable (it is a truncation, handled separately)

### Requirement: An empty-actionable turn SHALL never leave the session silently idle

When an empty-actionable turn is detected, the system SHALL take exactly one of two terminal actions and SHALL NOT leave the session idle with no visible output: (a) issue a bounded auto-continuation that prompts the model to emit its answer or next action, or (b) surface a clear, non-error status to the dashboard session card and `server.log` stating that the model returned only reasoning / no actionable output. The chosen behavior SHALL be configurable, defaulting to auto-continue where a continuation channel exists and surface-only otherwise.

#### Scenario: Auto-continue path emits an answer
- **WHEN** an empty-actionable turn is detected AND auto-continue is enabled
- **THEN** the system SHALL issue a continuation nudge to the same session
- **AND** the resulting turn's visible output SHALL be delivered to the session as normal

#### Scenario: Surface path shows a clear non-error status
- **WHEN** an empty-actionable turn is detected AND auto-continue is disabled or unavailable
- **THEN** the dashboard session card SHALL show a status such as "model returned only reasoning, no answer"
- **AND** a corresponding line SHALL be written to `server.log`
- **AND** the status SHALL NOT be rendered as an error

#### Scenario: Session is never left blank-and-idle
- **WHEN** an empty-actionable turn is detected
- **THEN** the session SHALL NOT transition to idle with zero visible assistant output and no status

### Requirement: Auto-continuation SHALL be bounded to prevent reasoning loops

When auto-continue handles empty-actionable turns, the system SHALL cap the number of consecutive continuation nudges at a configurable limit (default small, e.g. 2). On exceeding the cap, the system SHALL fall back to the surface path rather than continue nudging.

#### Scenario: Repeated empty-actionable turns fall back to surface
- **WHEN** a model produces empty-actionable turns on consecutive continuations up to the configured cap
- **THEN** the system SHALL stop auto-continuing
- **AND** SHALL surface the non-error "only reasoning, no answer" status

### Requirement: The guard SHALL be provider-agnostic

The empty-actionable-turn guard SHALL apply to any reasoning-capable model that can emit reasoning-then-stop with no visible output, not only `google-vertex/gemini-2.5-pro`. Classification SHALL rely on turn shape (stop reason + content parts), not on provider identity.

#### Scenario: Non-Gemini reasoning model triggers the guard
- **WHEN** any `reasoning: true` model returns a thinking-only `stop` turn
- **THEN** the guard SHALL classify and handle it identically to the Gemini case

### Requirement: Normal turns SHALL be unaffected

The guard SHALL NOT alter behavior for turns that contain visible text or a tool call. Latency, output, and idle transitions for normal turns SHALL be unchanged.

#### Scenario: Turn with visible text is untouched
- **WHEN** an assistant turn completes with a non-empty text part
- **THEN** the guard SHALL take no action and the turn SHALL complete normally

#### Scenario: Turn with a tool call is untouched
- **WHEN** an assistant turn completes with a tool call
- **THEN** the guard SHALL take no action and the tool-call loop SHALL proceed normally
