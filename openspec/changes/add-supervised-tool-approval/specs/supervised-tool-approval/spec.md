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

#### Scenario: Tools outside the configured set never prompt
- **GIVEN** a Supervised session with the default risky-tool set
- **WHEN** the agent emits a read-family tool call (e.g. `read`, `grep`)
- **THEN** the tool SHALL execute without an approval prompt
- **AND** this SHALL follow from the configured set alone — there SHALL be no hardcoded
  read-family exemption that could override an operator's explicit configuration

### Requirement: Approve and deny semantics
An Approve response SHALL allow the tool to execute unchanged. A Deny response SHALL block
the tool by returning `{ block: true, reason }` to pi so the tool is cancelled and the agent
is informed. An approval that is not answered (timeout or dismissal) SHALL fail closed — the
tool SHALL be blocked, never silently executed. The gate SHALL fail closed on its own
internal errors as well: it SHALL NOT rely on the host's throw-is-fail-safe behavior, since
the bridge wraps handlers in an error-swallowing wrapper whose return value means *allow*.
Exactly one approval clock SHALL govern a pending approval; on expiry the gate SHALL cancel
the rendered prompt so no surface shows an answerable card for an already-blocked tool.

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

#### Scenario: Gate internal error fails closed
- **WHEN** the gate throws or rejects while deciding or presenting an approval
- **THEN** the tool SHALL be blocked with a reason, NOT executed

#### Scenario: Expired approval leaves no answerable card
- **GIVEN** a pending approval that reaches its timeout and blocks the tool
- **WHEN** the operator looks at any connected surface
- **THEN** the approval card SHALL have been cancelled, so no late Approve is possible

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
The gated tool set SHALL default to the host's execution and mutation tools — `bash`,
`powershell` (the Windows shell tool), `write`, `edit` — plus `Agent`, and SHALL be
configurable. Tool-name matching SHALL be case-insensitive. Matching SHALL use typed
tool-call inspection of the call's input so the approval prompt can present the concrete
action (command text for `bash`/`powershell`; target path and a change summary for
`write`/`edit`), not an opaque tool name.

#### Scenario: Default set gates exec and mutation
- **WHEN** the risky-tool set is unconfigured
- **THEN** `bash`, `powershell`, `write`, `edit`, and `Agent` SHALL be gated and read-family
  tools SHALL NOT

#### Scenario: Windows shell is gated
- **GIVEN** a Supervised session on Windows
- **WHEN** the agent calls the `powershell` tool
- **THEN** it SHALL be gated, exactly as `bash` is on POSIX

#### Scenario: Default set does not silently drift from the host's tools
- **WHEN** the host exposes a mutating or execution tool that the default risky set omits
- **THEN** a test SHALL fail, so an allow-first default can never silently stop gating it

#### Scenario: Custom set extends the default
- **WHEN** an operator adds a custom tool name to the risky-tool set
- **THEN** that tool SHALL be gated in Supervised sessions
- **AND** the configured set SHALL be authoritative even when it names a read-family tool

### Requirement: The tool gate is one shared primitive across surfaces
The supervised gate SHALL reuse the existing shipped tool-call guard
(`createToolCallGuard` + `decideToolCall`, today in `packages/chat-gateway/src/guard/`)
rather than introducing a second interceptor. The guard SHALL be extracted into a
surface-agnostic module that both the dashboard and the chat gateway consume, injecting
their own approval transport. The extraction SHALL preserve the chat-gateway capability's
existing behavior: an absent `defaultAction` SHALL continue to resolve to `deny`, and an
unanswered approval SHALL continue to fail closed on both surfaces.

#### Scenario: Chat-gateway posture is unchanged by the extraction
- **GIVEN** a chat-gateway policy that omits `defaultAction`
- **WHEN** an unrecognised tool is called in a gateway-spawned session
- **THEN** it SHALL be denied, exactly as before the extraction

#### Scenario: Supervised uses the allow-first arm
- **GIVEN** a Supervised dashboard session with the default risky-tool set
- **WHEN** the agent calls a tool that is in neither the risky set nor any allow list
- **THEN** the tool SHALL execute without prompting

#### Scenario: A gateway-spawned session is not double-gated
- **GIVEN** a chat-gateway-spawned session that also has supervised mode enabled
- **WHEN** the agent calls a risky tool
- **THEN** exactly ONE approval SHALL be raised, governed by the gateway's stricter
  deny-first policy

#### Scenario: Only one tool-gate implementation exists
- **WHEN** the change is complete
- **THEN** the dashboard gate and the chat-gateway guard SHALL resolve to the same decision
  engine and the same block/fail-closed code path

### Requirement: Supervised mode is approval-gating, not sandboxing
Supervised mode SHALL be presented as per-action approval of **agent-initiated** tool calls,
not OS isolation. An approved tool SHALL run with the full permissions of the pi process.
The approval surface SHALL NOT describe the session as "sandboxed" or "safe"; documentation
SHALL direct users needing write-confinement to the container path. The copy SHALL NOT claim
coverage of operator-initiated shell (the `!` prefix) or extension-initiated execution, which
do not traverse the tool-call gate.

#### Scenario: Approved tool has full permissions
- **WHEN** a tool is approved in a Supervised session
- **THEN** it SHALL execute with the same permissions it would have in Full access

#### Scenario: UI does not claim isolation
- **WHEN** the supervised toggle and approval prompt are rendered
- **THEN** their copy SHALL NOT assert OS-level sandboxing or safety guarantees

### Requirement: Approval decisions are observable
Each approval decision SHALL be logged with the session id, tool name, an action summary,
the outcome (approved / denied / blocked-unanswered / blocked-gate-error), and the
answering **surface** (`dashboard` | `tui` | `chat-gateway` | `timeout`), so a Supervised
session's action history is auditable and blocked-tool outcomes are diagnosable.
Per-**viewer** attribution is explicitly out of scope: the prompt response carries a fixed
adapter label, not an identity, and carrying one would require the protocol change this
change forbids.

#### Scenario: Decision is logged
- **WHEN** an operator approves or denies a tool
- **THEN** a log entry SHALL record the tool, action summary, outcome, and answering surface

#### Scenario: Gate-blocked outcomes are distinguishable
- **WHEN** a tool is blocked by timeout versus by an explicit deny versus by a gate error
- **THEN** the logged outcome SHALL distinguish the three
