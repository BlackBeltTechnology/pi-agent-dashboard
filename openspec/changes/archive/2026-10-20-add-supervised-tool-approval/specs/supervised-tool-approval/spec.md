# supervised-tool-approval — delta

## ADDED Requirements

### Requirement: Per-session supervised mode gates risky tool calls
The dashboard SHALL provide a per-session mode with two states, **Full access** (default)
and **Supervised**. When a session is Supervised, the bridge SHALL intercept agent tool
calls via pi's blockable `tool_call` hook and, for tools in the configured risky-tool set,
SHALL require an in-dashboard approval before the tool executes. When a session is Full
access, the interceptor SHALL be inert and existing behavior SHALL be unchanged.

#### Scenario: Mode survives a reload, a restart and a reconnect
- **GIVEN** a session the operator switched to Supervised
- **WHEN** the session's extensions reload, its pi process restarts and resumes the
  session, its bridge reconnects, or the dashboard server restarts
- **THEN** the session SHALL still be Supervised before its next tool call
- **AND** the next risky tool call SHALL raise an approval

#### Scenario: A failed mode restore fails closed
- **WHEN** the session's recorded mode cannot be read at session start
- **THEN** the session SHALL be treated as Supervised and the failure SHALL be logged

#### Scenario: A new session does not inherit another session's mode
- **GIVEN** a pi process whose current session is Supervised
- **WHEN** it switches to or forks a different session with no recorded mode
- **THEN** that session SHALL start in the configured default mode

#### Scenario: No interactive UI blocks at once
- **GIVEN** a Supervised session running without an interactive UI
- **WHEN** the agent calls a risky tool
- **THEN** the tool SHALL be blocked immediately with a no-UI reason, without waiting for
  the approval timeout

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
The prompt SHALL offer **Allow once** and **Deny**, none preselected. Allow once SHALL run
the tool unchanged. Any other answer SHALL block it with `{ block: true, reason }`; an
optional operator reason SHALL reach the agent. Timeout, dismissal and gate errors SHALL
block (the gate SHALL NOT rely on the host wrapper, whose error result means allow). One
clock SHALL govern a pending approval; on expiry its prompt SHALL be cancelled everywhere.

#### Scenario: Approve runs the tool
- **WHEN** the operator approves a pending tool approval
- **THEN** the tool SHALL execute and its result SHALL flow back to the session normally

#### Scenario: Deny blocks the tool
- **WHEN** the operator denies a pending tool approval
- **THEN** the bridge SHALL return `{ block: true }` for that tool call
- **AND** the agent SHALL receive the block reason and continue the turn

#### Scenario: Deny with a reason reaches the agent
- **WHEN** the operator denies a pending approval and types a reason
- **THEN** the tool SHALL be blocked
- **AND** the agent SHALL receive that reason text in the block reason

#### Scenario: Unanswered approval fails closed
- **WHEN** an approval prompt times out or is dismissed with no decision
- **THEN** the tool SHALL be blocked, not executed

#### Scenario: Approval timeout has a floor and no wait-forever
- **WHEN** the configured approval timeout is absent, non-numeric, or below 10 seconds
- **THEN** the gate SHALL use the default of 120 seconds
- **AND** a value above 3600 seconds, or a config parse error, SHALL also resolve to 120
- **AND** when the session's general prompt timeout is shorter, the effective approval
  window SHALL be just under it (never below 1 second), and Settings SHALL warn about it
- **AND** the Settings field SHALL reject a value below 10 or above 3600 seconds

#### Scenario: Gate internal error fails closed
- **WHEN** the gate throws or rejects while deciding or presenting an approval
- **THEN** the tool SHALL be blocked with a reason, NOT executed

#### Scenario: Aborting the turn withdraws a pending approval
- **GIVEN** a pending approval
- **WHEN** the operator aborts the turn
- **THEN** the tool SHALL be blocked
- **AND** the approval card SHALL be cancelled on every surface

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

#### Scenario: Default set does not silently drift from the host's built-in tools
- **WHEN** the pinned pi version's built-in tool list contains a tool outside the read
  family, the risky set and the known wrapper tools
- **THEN** a test SHALL fail, forcing that tool to be classified

#### Scenario: Unclassified tool runs and is logged
- **GIVEN** a Supervised session with the default risky-tool set
- **WHEN** the agent calls a tool that is in neither the read family, the risky set, nor
  the known wrapper tools
- **THEN** the tool SHALL execute without an approval prompt
- **AND** the unclassified tool name SHALL be logged once for that session
- **AND** tool annotations SHALL NOT change whether a tool is gated

#### Scenario: Custom set extends the default
- **WHEN** an operator adds a custom tool name to the risky-tool set
- **THEN** that tool SHALL be gated in Supervised sessions
- **AND** the configured set SHALL be authoritative even when it names a read-family tool

### Requirement: The tool gate is one shared primitive across surfaces
The supervised gate and the chat-gateway guard SHALL share one extracted policy engine and
settlement core (today in `packages/chat-gateway/src/guard/`), each injecting its own
approval transport. Supervised-only behaviour SHALL live outside the shared core. The
extraction SHALL NOT change chat-gateway decisions: an absent `defaultAction` SHALL still
resolve to `deny`, names SHALL still match exactly, and unanswered approvals SHALL still
fail closed.

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
- **THEN** at most ONE supervised or gateway approval SHALL be raised, decided by the
  gateway policy alone
- **AND** none SHALL be raised when the gateway policy allows the tool
- **AND** the agent path gate SHALL remain independent of this rule
- **AND** its path prompts SHALL NOT be enriched with supervised content and SHALL stay
  answerable in the chat channel

#### Scenario: Only one decision engine exists
- **WHEN** the change is complete
- **THEN** the dashboard gate and the chat-gateway guard SHALL resolve to the same
  `decideToolCall` and the same settlement/fail-closed core

#### Scenario: Supervised case-folding does not leak into the gateway
- **GIVEN** a gateway policy that allows `bash`
- **WHEN** a separately registered tool named `Bash` is called in a gateway-spawned session
- **THEN** the gateway decision SHALL be the same as before the extraction

### Requirement: Supervised gate composes with the agent path gate
The supervised gate SHALL run after the agent path gate. A call the path gate blocks SHALL
NOT raise a supervised approval. In a Supervised session the path gate's prompt for a risky
call SHALL also show the supervised action content, and allowing it SHALL count as the
supervised approval for that call. A call the path gate allowed without asking SHALL get the
supervised policy. YOLO SHALL NOT answer supervised approvals, and a pending supervised
approval SHALL NOT delay a path-gate YOLO answer.

#### Scenario: Path-gate denial suppresses the approval
- **GIVEN** a Supervised session
- **WHEN** the agent edits a file outside its workspace and the operator denies the path prompt
- **THEN** the tool SHALL be blocked and no supervised approval SHALL be raised

#### Scenario: One prompt per call, with the content shown
- **GIVEN** a Supervised session
- **WHEN** the agent edits a file outside its workspace
- **THEN** the path prompt SHALL show the edit's change summary and diff
- **AND** when the operator answers Allow once on the dashboard or the terminal, the edit
  SHALL run without a second prompt
- **AND** a call without a tool-call id, or a path prompt opened before the session became
  Supervised, MAY raise a second prompt (never zero)

#### Scenario: YOLO does not answer supervised approvals
- **GIVEN** a Supervised session with an active YOLO window covering the target directory
- **WHEN** the agent edits a file there
- **THEN** the supervised approval SHALL still be raised to the operator

### Requirement: A waiting approval asks for attention without a modal
While a supervised approval is pending, the session SHALL be marked as awaiting a tool
approval, its session card SHALL show the existing "Needs you" attention label, and a
non-modal notification SHALL announce it. The approval SHALL NOT be raised as an
application-wide modal.

#### Scenario: Pending approval surfaces on the session card
- **GIVEN** a Supervised session with a pending approval
- **WHEN** the operator views the session list
- **THEN** that session's card SHALL show the "Needs you" label
- **AND** the label SHALL clear once the approval resolves, is cancelled, or times out

### Requirement: Supervised approvals are not answerable from chat or the question API
The chat gateway SHALL NOT render a supervised approval prompt, nor a path-gate prompt
enriched with supervised content, in a chat channel, whether the session was spawned or
attached. The question stack SHALL list such prompts read-only, SHALL NOT accept answers
for them over its REST API, and SHALL NOT brief them. Dashboard WebSocket answers stay
accepted, as for path-gate prompts. A supervised approval SHALL be answerable only from
the dashboard or the session's terminal.

#### Scenario: The question stack cannot answer a supervised approval
- **GIVEN** a pending supervised approval
- **WHEN** a client lists pending questions or posts an answer through the question API
- **THEN** the approval SHALL be listed read-only and the answer SHALL be rejected
- **AND** its content SHALL NOT be sent to a model for a brief

#### Scenario: Chat channel never shows a supervised approval
- **GIVEN** a session bound to a chat channel, with supervised mode on
- **WHEN** a supervised approval is pending
- **THEN** no interactive prompt for it SHALL be posted to the channel

### Requirement: Supervised mode is approval-gating, not sandboxing
Supervised mode SHALL be presented as approval of **agent-initiated** tool calls, not OS
isolation. An approved tool SHALL run with the pi process's full permissions, and an
approval SHALL cover the input as presented. The copy SHALL NOT say "sandboxed" or "safe",
SHALL NOT claim coverage of operator `!` shell or extension-initiated execution, and the
docs SHALL point to the container path for confinement.

#### Scenario: Approved tool has full permissions
- **WHEN** a tool is approved in a Supervised session
- **THEN** it SHALL execute with the same permissions it would have in Full access

#### Scenario: UI does not claim isolation
- **WHEN** the supervised toggle and approval prompt are rendered
- **THEN** their copy SHALL NOT assert OS-level sandboxing or safety guarantees

#### Scenario: Gateway-spawned session shows the governing policy instead of a toggle
- **GIVEN** a session spawned by the chat gateway
- **WHEN** the operator opens the session view
- **THEN** the supervised toggle SHALL be absent when the gateway's tool guard is active in
  that session
- **AND** a note SHALL name the gateway tool policy as the one in effect

#### Scenario: Subagent approval states its limit
- **WHEN** an approval is raised for starting a subagent
- **THEN** the prompt SHALL state that the subagent's own commands and edits are not
  approved one by one

### Requirement: Approval decisions are observable
Each decision SHALL be logged with session id, tool, a capped and redacted action summary,
outcome (`approved` | `denied` | `dismissed` | `timeout` | `aborted` | `error`), answering surface
(`dashboard` | `tui` | `timeout` | `error`) and the carrying prompt
(supervised or path-gate). Per-viewer attribution is out of scope: the prompt response
carries an adapter label, not an identity.

#### Scenario: Decision is logged
- **WHEN** an operator approves or denies a tool
- **THEN** a log entry SHALL record the tool, action summary, outcome, and answering surface

#### Scenario: Gate-blocked outcomes are distinguishable
- **WHEN** a tool is blocked by timeout versus by an explicit deny versus by a gate error
- **THEN** the logged outcome SHALL distinguish the three
