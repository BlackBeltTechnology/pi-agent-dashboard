# embed-session-lifecycle Specification (delta)

## ADDED Requirements

### Requirement: The pending-ask signal is the union of both pending registries

The reaper's pending-ask signal SHALL report `true` when **either** the extension-UI request registry (`pendingUiRequests`) **or** the PromptBus pending-prompt registry (`pendingPromptRequests`) holds an entry for the session. Wiring it to only one registry leaves the other's blocked sessions reapable, which violates the existing requirement that an `ask_user`-blocked session is never force-reaped.

The signal SHALL be explicit at the lifecycle wiring site. A non-null `currentTool` produced by the prompt-derived tool state SHALL NOT be relied upon as the veto: that value gates only the idle gear (`skip("current-tool")`), while the phantom force-reap path consults the pending-ask signal instead.

#### Scenario: Session blocked on a PromptBus prompt is not idle-reaped

- **WHEN** an `ephemeral` session is at rest past the idle timeout with no live children and no subscriber
- **AND** it has a tracked PromptBus pending prompt
- **THEN** the pending-ask signal SHALL be `true`
- **AND** the reaper SHALL skip it with reason `"pending-ask"`

#### Scenario: Session blocked on a PromptBus prompt is not phantom-reaped

- **WHEN** an `ephemeral` session is `streaming` past the hard ceiling with a ~0-CPU pi tree, no live children, and no subscriber
- **AND** it has a tracked PromptBus pending prompt
- **THEN** the reaper SHALL NOT force-reap it

#### Scenario: Extension-UI requests still block reaping

- **WHEN** a session has a tracked `pendingUiRequests` entry and no PromptBus prompt
- **THEN** the pending-ask signal SHALL remain `true` exactly as before this change

#### Scenario: Neither registry holds an entry

- **WHEN** a session has no entry in either registry
- **THEN** the pending-ask signal SHALL be `false`
- **AND** the reaper's existing verdicts SHALL be unchanged

#### Scenario: The veto does not depend on currentTool

- **WHEN** the phantom force-reap path evaluates a session blocked on a PromptBus prompt
- **THEN** the skip SHALL be attributable to the pending-ask signal
- **AND** SHALL NOT require `currentTool` to be non-null
