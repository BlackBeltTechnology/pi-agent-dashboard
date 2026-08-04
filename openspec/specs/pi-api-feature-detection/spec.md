# pi-api-feature-detection Specification

## Purpose
TBD - created by archiving change update-pi-core-0-83-adopt-apis. Update Purpose after archive.
## Requirements
### Requirement: Runtime feature-detection governs all new-pi API adoption

The dashboard SHALL adopt every new pi runtime API (introduced above the compatibility `minimum`) behind runtime feature-detection of the concrete surface, and SHALL NOT gate behavior on the pi version string. Detection SHALL test the surface in the form that is actually load-bearing for the adoption — for a value surface, that includes its meaningful shape (e.g. `ctx.scopedModels` is detected as a **non-empty array**, because it is present-but-empty on a default unscoped 0.83.0 session), not mere presence. Each detected surface SHALL have an explicit fallback path that reproduces the pre-adoption behavior. A session running on any pi at or above the compatibility `minimum` SHALL continue to function with no crash and no behavior regression when a newer surface is absent (or present in its no-op shape).

#### Scenario: New surface present is used

- **WHEN** a new pi API surface is detected at runtime in its load-bearing shape
- **THEN** the dashboard SHALL use the enhanced path

#### Scenario: New surface absent or no-op-shaped falls back cleanly

- **GIVEN** a pi runtime at or above `minimum` that lacks a newer surface, or exposes it only in a no-op shape (e.g. an empty scope array)
- **WHEN** the dashboard reaches the corresponding code path
- **THEN** it SHALL execute the documented fallback
- **AND** SHALL NOT throw, block the session, or regress prior behavior

### Requirement: The "pending" streaming stop reason SHALL NOT be misclassified as empty-actionable

`"pending"` (pi ≥ 0.83.0) is a partial-**streaming** stop reason. The change SHALL first establish whether `"pending"` can reach the terminal `agent_end` assistant message that `turn-actionability.ts` classifies (via `bridge.ts`); the classifier change SHALL be written only for the shapes that actually reach it, and the reachability finding SHALL be recorded. Where a `"pending"` turn does reach the classifier, it SHALL be treated as an in-progress turn and SHALL NOT be classified as `empty-actionable`. The change SHALL NOT suppress the `EmptyActionableGuard` for turns that are genuinely idle (non-`"pending"`). Error precedence SHALL remain unchanged: a `"pending"` turn carrying an error SHALL still classify as `error`. Because `#7272` converts unmapped terminal provider stop reasons to provider errors pi-side, the classifier SHALL continue to resolve provider-error turns through the existing `error` branch without expecting raw terminal reason strings.

#### Scenario: Pending partial is not treated as empty

- **GIVEN** an assistant turn with `stopReason === "pending"` reaching the classifier with no visible text or tool call
- **WHEN** the turn is classified
- **THEN** the result SHALL be an in-progress/`normal` classification
- **AND** SHALL NOT be `empty-actionable`

#### Scenario: Genuinely idle non-pending turn still guarded

- **GIVEN** an assistant turn that is empty and whose stop reason is NOT `"pending"`
- **WHEN** the turn is classified
- **THEN** the `EmptyActionableGuard` behavior SHALL be unchanged from today

#### Scenario: Provider-error turns still classify as error

- **GIVEN** an assistant turn whose stop reason maps to a provider error (including 0.83.0 unmapped-terminal-reason → error conversion)
- **WHEN** the turn is classified
- **THEN** the result SHALL be `error`

### Requirement: outputPad is a TUI setting with no dashboard surface (documented no-op)

`outputPad` is a pi **TUI horizontal-padding setting** (`docs/settings.md`, `#6168`) that predates the current pin — it is not a custom-message-renderer API and is not new in 0.82/0.83. The dashboard renders in its web client, not pi's TUI, so `outputPad` has no dashboard surface to consume. This requirement SHALL be satisfied as a documented no-op recording that rationale; the change SHALL NOT introduce a pi custom message renderer solely to consume `outputPad`, and the absence SHALL NOT be treated as a gap.

#### Scenario: outputPad has no web-client surface

- **GIVEN** the dashboard renders in the web client and registers no pi TUI custom message renderer
- **WHEN** the `outputPad` adoption is evaluated
- **THEN** the requirement SHALL be considered satisfied as a documented no-op
- **AND** no renderer SHALL be introduced and no code SHALL land for it

