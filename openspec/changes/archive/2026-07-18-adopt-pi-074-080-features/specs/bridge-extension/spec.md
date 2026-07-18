## ADDED Requirements

### Requirement: Bridge normalizes agent_settled to one terminal signal per run

The bridge SHALL subscribe to pi's `agent_settled` event (pi 0.80.4+) and forward it as an `event_forward`, setting `getBridgeState().isAgentStreaming = false`. When the running pi does NOT emit `agent_settled` natively (pi < 0.80.4, determined from the pi version the bridge already reports in `session_register`), the bridge SHALL synthesize an `agent_settled` event synchronously immediately after each forwarded `agent_end`, so the dashboard receives exactly one terminal `agent_settled` per run on every supported pi. The bridge SHALL NOT require or advertise a `session_register` capability flag for this.

#### Scenario: Native agent_settled forwarded, streaming cleared
- **WHEN** the bridge runs against pi ≥ 0.80.4 and pi emits `agent_settled`
- **THEN** the bridge SHALL forward one `event_forward{eventType:"agent_settled"}` and set `isAgentStreaming=false`
- **AND** SHALL NOT synthesize an additional `agent_settled`

#### Scenario: Floor pi gets a synthesized settle after agent_end
- **WHEN** the bridge runs against pi < 0.80.4 (no native `agent_settled`)
- **THEN** the bridge SHALL synthesize one `agent_settled` synchronously after each forwarded `agent_end`
- **AND** SHALL set `isAgentStreaming=false` on that synthesized settle

### Requirement: Bridge pushes external renames from session_info_changed via the auto-namer's self-filter

The bridge SHALL register `pi.on("session_info_changed", ...)` (pi 0.80.3+, try/catch) and SHALL route the new name through the existing `autoNamer.onObservedName(name)`, which classifies self-applied vs external via `classifyNameChange` and reports (locking out auto-naming) ONLY when external. The bridge's own `pi.setSessionName(...)` auto-name echoing back through the event SHALL be classified self and SHALL NOT push or lock out. The recorded self-applied name SHALL be normalized with pi's own name sanitization (`replace(/[\r\n]+/g, " ").trim()`) so a self-applied title containing internal newlines still matches the sanitized name pi carries in the event. The turn-end name poll SHALL remain as a fallback.

#### Scenario: External rename pushes and locks out
- **WHEN** `session_info_changed` fires with a name the auto-namer classifies external
- **THEN** the bridge SHALL push exactly one `session_name_update{nameSource:"user"}` and lock out auto-naming

#### Scenario: Bridge's own auto-name echo is ignored, including a newline-bearing title
- **WHEN** the bridge auto-applies a multi-word title containing a newline and pi emits `session_info_changed` with the sanitized (newline-collapsed) form
- **THEN** the normalized self-applied comparison SHALL classify it self
- **AND** the bridge SHALL NOT push a `session_name_update` and SHALL NOT lock out auto-naming

#### Scenario: Absent event falls back to poll
- **WHEN** pi does not emit `session_info_changed`
- **THEN** the existing turn-end name poll SHALL still detect an external rename (today's behavior)

### Requirement: Bridge auto-decides project_trust for dashboard-spawned headless sessions in the activation cwd

The bridge SHALL capture `activationCwd = process.cwd()` at bridge **activation** (before any `project_trust` event can fire — the event is emitted during resource-loader reload, ahead of `session_start`). It SHALL register a `project_trust` handler (pi 0.79.0+) that reads `eventCwd` from its own per-event `ctx` argument inside try/catch, and decides "trust" for this run ONLY when all hold: `dashboardSpawned === true`, `isHeadlessRpcSession(...)` is true, AND `eventCwd === activationCwd`. Any other case — including a `ctx.cwd` read that throws — SHALL defer to pi's default. Trust SHALL be per-run (not remembered) in v1. `ctx.isProjectTrusted()` SHALL be logging-only.

#### Scenario: Dashboard-spawned headless session in its activation cwd auto-trusts
- **WHEN** a dashboard-spawned headless RPC session raises `project_trust` while `eventCwd` equals `activationCwd`
- **THEN** the handler SHALL decide "trust" for this run

#### Scenario: Interactive/TUI session defers
- **WHEN** an interactive (non-headless) session raises `project_trust`
- **THEN** the handler SHALL defer to pi's default

#### Scenario: Cwd differs from the activation cwd defers
- **WHEN** a headless session raises `project_trust` with `eventCwd` different from `activationCwd`
- **THEN** the handler SHALL defer to pi's default

#### Scenario: Non-dashboard-spawned session defers
- **WHEN** a session with `dashboardSpawned === false` raises `project_trust`
- **THEN** the handler SHALL defer to pi's default

#### Scenario: ctx.cwd read that throws defers
- **WHEN** reading `eventCwd` from the event `ctx` throws (stale/replaced session)
- **THEN** the handler SHALL defer to pi's default (no crash)
