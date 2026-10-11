## MODIFIED Requirements

### Requirement: The "pending" streaming stop reason SHALL NOT be misclassified as empty-actionable

`"pending"` (pi ≥ 0.83.0) is a partial-**streaming** stop reason. The change SHALL first establish whether `"pending"` can reach the terminal `agent_end` assistant message that `turn-actionability.ts` classifies (via the bridge extension); the classifier change SHALL be written only for the shapes that actually reach it, and the reachability finding SHALL be recorded. Where a `"pending"` turn does reach the classifier, it SHALL be treated as an in-progress turn and SHALL NOT be classified as `empty-actionable`. The change SHALL NOT suppress the `EmptyActionableGuard` for turns that are genuinely idle (non-`"pending"`). Error precedence SHALL remain unchanged: a `"pending"` turn carrying an error SHALL still classify as `error`. Because `#7272` converts unmapped terminal provider stop reasons to provider errors pi-side, the classifier SHALL continue to resolve provider-error turns through the existing `error` branch without expecting raw terminal reason strings.

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
