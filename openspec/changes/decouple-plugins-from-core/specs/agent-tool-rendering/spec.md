## MODIFIED Requirements

### Requirement: Shared AgentCardShell component
The system SHALL provide a reusable `AgentCardShell` component extracted from `FlowAgentCard` that encapsulates the common agent card visual pattern: status icon, name, status-based border coloring, and stat formatting helpers. The host SHALL register it as the `ui:agent-card` primitive; the `Agent` tool renderer, which now lives in the subagents plugin, SHALL reach it only through that primitive.

#### Scenario: FlowAgentCard uses AgentCardShell
- **WHEN** `FlowAgentCard` renders
- **THEN** it SHALL delegate to `AgentCardShell` for the card container, status icon, and header row, passing flow-specific content (recent tools, blocked-by) as children

#### Scenario: AgentToolRenderer uses AgentCardShell
- **WHEN** the `Agent` tool renderer renders
- **THEN** it SHALL use `AgentCardShell` for the card container, status icon, and header row, passing agent-specific content (activity, prompt, result) as children
- **AND** it SHALL obtain it through `useUiPrimitive("ui:agent-card")`, without importing host client source

#### Scenario: Shared formatting helpers
- **WHEN** any component needs to format agent tokens or duration
- **THEN** it SHALL use shared `formatTokens` and `formatDuration` helpers from a common module instead of duplicating them

### Requirement: Agent tool collapsed summary
The `ToolCallStep` collapsed summary for Agent-related tools SHALL be descriptive. The summaries SHALL stay in core as tool-name data (`tool-summary.ts`), import no plugin, and SHALL render the same whether or not the subagents plugin is enabled.

#### Scenario: Agent tool summary
- **WHEN** an `Agent` tool call is displayed in collapsed mode
- **THEN** the summary SHALL show the agent type and description (e.g. "▸ Explore: Fix auth bug")

#### Scenario: get_subagent_result summary
- **WHEN** a `get_subagent_result` tool call is displayed in collapsed mode
- **THEN** the summary SHALL show "Get result: {agent_id}"

#### Scenario: steer_subagent summary
- **WHEN** a `steer_subagent` tool call is displayed in collapsed mode
- **THEN** the summary SHALL show "Steer: {agent_id}"

#### Scenario: Summary without the subagents plugin
- **WHEN** the subagents plugin is disabled and an `Agent` tool call is displayed in collapsed mode
- **THEN** the summary SHALL still show the agent type and description

### Requirement: Agent tool auto-expand while running
The `ToolCallStep` SHALL default to expanded state for `Agent` tool calls that have status `running` while the subagents plugin's `tool-renderer` claim for `Agent` declares `expandWhileRunning: true`. `ToolCallStep` SHALL read that claim field and SHALL NOT hard-code the `Agent` tool name. With no such claim, an `Agent` call SHALL follow the default collapsed behavior.

#### Scenario: Running Agent auto-expands
- **WHEN** an `Agent` tool call is added with status `running` and the subagents plugin is enabled
- **THEN** the `ToolCallStep` SHALL render in expanded state

#### Scenario: Completed Agent stays collapsed
- **WHEN** an `Agent` tool call arrives already complete (e.g. during replay)
- **THEN** the `ToolCallStep` SHALL render in collapsed state (default behavior)

#### Scenario: No auto-expand without the plugin
- **WHEN** the subagents plugin is disabled and an `Agent` tool call is added with status `running`
- **THEN** the `ToolCallStep` SHALL render in collapsed state with `GenericToolRenderer`
