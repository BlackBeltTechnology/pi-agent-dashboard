## REMOVED Requirements

### Requirement: Tool surface is a guarded allowlist over the plugin server context
**Reason**: The curated 4-tool allowlist assumed one flat trust level per
token. With tiered tokens (`mcp-tool-tiers`) the full capability surface can
be exposed without giving every holder destructive control, and a
hand-maintained table does not scale to it.
**Migration**: Replaced by `Requirement: Tool surface is a tier-filtered
manifest over REST, WS verbs and the plugin server context`. The four
existing tools keep their names and argument shapes and become `observe`
(`list_sessions`) and `control` (`send_prompt`, `spawn_session`, `abort`)
rows of the manifest.

## ADDED Requirements

### Requirement: Tool surface is a tier-filtered manifest over REST, WS verbs and the plugin server context
Advertised tools SHALL be defined by the reviewed manifest described in
`mcp-tool-tiers`, each bound to one REST route, browser-WS verb or
`ServerPluginContext` capability, and filtered by the caller's tier. The
server SHALL NOT advertise a tool for UI-only verbs, transport verbs, or
non-allowlisted context members.

#### Scenario: UI-only and transport verbs stay excluded
- **WHEN** an `operate` caller calls `tools/list`
- **THEN** the result SHALL NOT contain a tool for a UI-only verb such as `reorder_pinned_dirs` or `set_session_process_drawer`
- **AND** it SHALL NOT contain a tool for a transport verb such as `subscribe` or `watch_files`

#### Scenario: Every advertised tool has a handler
- **WHEN** the manifest is enumerated
- **THEN** each row SHALL resolve to an invocable handler
- **AND** a row without a resolvable handler SHALL fail the build

#### Scenario: Non-allowlisted context members are not exposed
- **WHEN** the manifest is enumerated
- **THEN** it SHALL NOT expose `registerPiHandler`, `registerBrowserHandler`, `broadcastToSubscribers`, `emitEventToSession`, or the raw Fastify instance

#### Scenario: Abort uses the general session primitive
- **WHEN** an `abort` tool is invoked for a session
- **THEN** it SHALL target the general session-abort primitive
- **AND** it SHALL NOT be backed by the plugin-spawned-run hard-kill primitive

#### Scenario: Hard kill is a distinct operate-tier tool
- **WHEN** the manifest is enumerated
- **THEN** the hard-kill primitive SHALL be reachable only through a tool named `force_kill` at `operate` tier with `destructiveHint: true`

#### Scenario: Session id is an ordinary tool argument
- **WHEN** a tool operates on a session
- **THEN** the target session SHALL be identified by a `sessionId` argument in the tool's `arguments` object
- **AND** the server SHALL NOT rely on connection-scoped state to determine the target

#### Scenario: Existing tools keep their contract
- **WHEN** a `control` caller invokes `list_sessions`, `send_prompt`, `spawn_session` or `abort` with the arguments accepted before this change
- **THEN** the result SHALL be unchanged

## MODIFIED Requirements

### Requirement: A session cannot drive itself through the MCP endpoint
The server SHALL refuse a tool call whose target session equals the caller's
server-resolved originating session. This SHALL apply to every session-targeting
tool in the manifest, including prompt delivery that routes to extension-command
dispatch, prompt-response, model and thinking-level changes, lifecycle tools
and hard kill. The tier check SHALL run before the self-target check.

#### Scenario: Self-targeted prompt is refused
- **WHEN** a caller whose originating session resolves to `A` invokes a session-targeting tool with `sessionId` equal to `A`
- **THEN** the server SHALL refuse the call
- **AND** it SHALL NOT deliver the prompt

#### Scenario: Self-targeted slash command is refused
- **WHEN** a caller whose originating session resolves to `A` invokes prompt delivery targeting `A` with text beginning `/`
- **THEN** the server SHALL refuse the call
- **AND** it SHALL NOT reach extension-command dispatch

#### Scenario: Every session-targeting manifest row is guarded
- **WHEN** the manifest is enumerated
- **THEN** every row whose schema has a `sessionId` argument SHALL be marked session-targeting
- **AND** a caller whose originating session resolves to `A` invoking any such tool with `sessionId` equal to `A` SHALL be refused

#### Scenario: Cross-session control is permitted
- **WHEN** a caller whose originating session resolves to `A` targets a different session `B`
- **THEN** the call SHALL be permitted subject to the remaining authorization rules

#### Scenario: Sessionless caller is unaffected
- **WHEN** a caller with no originating session targets any session
- **THEN** the self-target guard SHALL NOT refuse the call

#### Scenario: Refusal is observable
- **WHEN** a self-targeted call is refused
- **THEN** the refusal SHALL be recorded with the resolved caller session, the target session, and the tool name
