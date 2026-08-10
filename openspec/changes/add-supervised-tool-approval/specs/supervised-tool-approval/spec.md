# supervised-tool-approval — delta

## ADDED Requirements

### Requirement: Per-session supervised mode gates risky tool calls
The dashboard SHALL provide a per-session mode with two states, **Full access** (default)
and **Supervised**. When a session is Supervised, the bridge SHALL intercept agent tool
calls via pi's blockable `tool_call` hook and, for tools in the configured risky-tool set,
SHALL require an in-dashboard approval before the tool executes. When a session is Full
access, the interceptor SHALL be inert and existing behavior SHALL be unchanged.

#### Scenario: Full access is the default and unchanged
- **WHEN** a session starts with no supervised configuration
- **THEN** it SHALL be in Full access
- **AND** risky tools SHALL execute without any approval prompt, exactly as before this change

#### Scenario: Supervised session prompts before a risky tool
- **GIVEN** a Supervised session
- **WHEN** the agent emits a `bash` tool call
- **THEN** the bridge SHALL escalate an approval prompt to the dashboard before the command runs

#### Scenario: Non-risky tools never prompt
- **GIVEN** a Supervised session
- **WHEN** the agent emits a read-family tool call (e.g. `read`, `grep`)
- **THEN** the tool SHALL execute without an approval prompt

### Requirement: Approve and deny semantics
An Approve response SHALL allow the tool to execute unchanged. A Deny response SHALL block
the tool by returning `{ block: true, reason }` to pi so the tool is cancelled and the agent
is informed. An approval that is not answered (PromptBus timeout or dismissal) SHALL fail
closed — the tool SHALL be blocked, never silently executed.

#### Scenario: Approve runs the tool
- **WHEN** the operator approves a pending tool approval
- **THEN** the tool SHALL execute and its result SHALL flow back to the session normally

#### Scenario: Deny blocks the tool
- **WHEN** the operator denies a pending tool approval
- **THEN** the bridge SHALL return `{ block: true }` for that tool call
- **AND** the agent SHALL receive the block reason and continue the turn

#### Scenario: Unanswered approval fails closed
- **WHEN** an approval prompt times out or is dismissed with no decision
- **THEN** the tool SHALL be blocked, not executed

### Requirement: Approval round-trip reuses the existing PromptBus surface
The approval prompt SHALL be delivered and answered over the existing interactive-prompt
path (`prompt_request` → `prompt_response`) used by `ask_user` and `multiselect`. The change
SHALL NOT introduce a new session event-protocol message for the approve/deny round-trip.
Enabling supervised mode MAY use one session-scoped control signal to set the flag.

#### Scenario: Approval inherits reconnect replay
- **GIVEN** a pending tool approval on a Supervised session
- **WHEN** the web client reloads
- **THEN** the pending approval SHALL be replayed and re-rendered from the cached PromptBus state

#### Scenario: First response wins across surfaces
- **WHEN** a session is viewed on two devices and a tool approval is pending
- **THEN** a decision from either device SHALL resolve the prompt and dismiss it on the other

### Requirement: Configurable risky-tool set
The gated tool set SHALL default to `bash`, `write`, and `edit` and SHALL be configurable.
Matching SHALL use typed tool-call inspection so the approval prompt can present the concrete
action (command text for `bash`; target path and a change summary for `write`/`edit`).

#### Scenario: Default set gates exec and mutation
- **WHEN** the risky-tool set is unconfigured
- **THEN** `bash`, `write`, and `edit` SHALL be gated and read-family tools SHALL NOT

#### Scenario: Custom set extends the default
- **WHEN** an operator adds a custom tool name to the risky-tool set
- **THEN** that tool SHALL be gated in Supervised sessions

### Requirement: Supervised mode is approval-gating, not sandboxing
Supervised mode SHALL be presented as per-action approval, not OS isolation. An approved
tool SHALL run with the full permissions of the pi process. The approval surface SHALL NOT
describe the session as "sandboxed" or "safe"; documentation SHALL direct users needing
write-confinement to the container path.

#### Scenario: Approved tool has full permissions
- **WHEN** a tool is approved in a Supervised session
- **THEN** it SHALL execute with the same permissions it would have in Full access

#### Scenario: UI does not claim isolation
- **WHEN** the supervised toggle and approval prompt are rendered
- **THEN** their copy SHALL NOT assert OS-level sandboxing or safety guarantees

### Requirement: Approval decisions are observable
Each approval decision SHALL be logged with the session id, tool name, an action summary,
the outcome (approved/denied/blocked-unanswered), and who answered, so a Supervised
session's action history is auditable and blocked-tool outcomes are diagnosable.

#### Scenario: Decision is logged
- **WHEN** an operator approves or denies a tool
- **THEN** a log entry SHALL record the tool, action summary, and outcome
