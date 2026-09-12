## MODIFIED Requirements

### Requirement: Bridge normalizes agent_settled to one terminal signal per run

The bridge SHALL subscribe to pi's native `agent_settled` event and forward it as an `event_forward`, setting `getBridgeState().isAgentStreaming = false`. Because `piCompatibility.minimum` now tracks the pinned runtime in lockstep, every pi whose version is known and at or above the floor emits `agent_settled` natively; the bridge SHALL NOT synthesize an `agent_settled` event, SHALL NOT gate this behavior on the reported pi version, and SHALL NOT carry a version-comparison helper for this purpose. The bridge SHALL NOT require or advertise a `session_register` capability flag for this.

**Unknown-version carve-out.** `pi-runtime-selection` exempts a candidate whose version cannot be determined from the floor check, so such a runtime remains selectable and could in principle predate native `agent_settled` (pi < `0.80.4`). The "exactly one terminal settle per run" contract is therefore guaranteed only for known-version runtimes at or above the floor. This is accepted deliberately: an unknown-version runtime is outside every other guarantee the floor provides, and restoring synthesis for it would reintroduce the untestable below-floor branch class the lockstep floor exists to remove.

Removing the synthesis path also removes a latent defect: the retired comparator evaluated the major component first and returned "supported" for any major ≥ 1, so the gate would have silently mis-answered on a future pi `1.x`.

#### Scenario: Native agent_settled forwarded, streaming cleared
- **WHEN** pi emits `agent_settled`
- **THEN** the bridge SHALL forward one `event_forward{eventType:"agent_settled"}` and set `isAgentStreaming=false`
- **AND** SHALL NOT emit any additional `agent_settled`

#### Scenario: agent_end alone does not produce a settle
- **WHEN** the bridge forwards an `agent_end`
- **THEN** the bridge SHALL NOT emit a synthesized `agent_settled` alongside or after it
- **AND** the dashboard SHALL receive exactly one terminal `agent_settled` per run, sourced from pi

#### Scenario: No version gate on the settle path
- **WHEN** the bridge initializes its event subscriptions
- **THEN** the `agent_settled` subscription SHALL be unconditional
- **AND** SHALL NOT read the reported pi version to decide its behavior

### Requirement: Bridge listens to thinking_level_select

The bridge SHALL register a `pi.on("thinking_level_select", ...)` listener and SHALL push a `model_update` message via the existing `sendModelUpdateIfChanged` debouncer whenever the listener fires. The bridge SHALL NOT rely on `model_select` to surface thinking-level changes.

The model-tracker's equality check that gates `model_update` pushes SHALL consider both `model` and `thinkingLevel` — a change in thinkingLevel alone (model unchanged) SHALL still produce a push.

Supported Anthropic transports now persist per-turn thinking effort themselves and recover from signed-thinking mismatches. The bridge SHALL therefore remain a pure observer of thinking level: it SHALL report the level pi reports and SHALL NOT re-apply, cache-and-replay, or otherwise re-assert a thinking level onto the session. Where the dashboard derives selectable levels (`deriveSupportedThinkingLevels`), that derivation SHALL remain a read-only capability projection and SHALL NOT double-handle effort that pi already persists.

#### Scenario: Thinking level change without model change
- **WHEN** the user changes thinking level from `medium` to `high` (model unchanged)
- **AND** pi emits `thinking_level_select`
- **THEN** the bridge SHALL emit one `model_update` with the existing model and the new thinkingLevel `"high"`

#### Scenario: Repeated event with same level is a no-op
- **WHEN** `thinking_level_select` fires twice with the same value
- **THEN** the bridge SHALL push at most one `model_update` for that value (the second is suppressed by the existing debouncer)

#### Scenario: Bridge does not re-assert persisted effort
- **GIVEN** pi persists thinking effort across turns on a supported Anthropic transport
- **WHEN** a new turn begins
- **THEN** the bridge SHALL NOT write a thinking level back onto the session
- **AND** the level surfaced to the dashboard SHALL be the one pi reports

#### Scenario: No version gate on the thinking-level listener
- **WHEN** the bridge registers its `thinking_level_select` listener
- **THEN** the registration SHALL be unconditional
- **AND** SHALL NOT read the reported pi version to decide whether to register

#### Scenario: Signed-thinking mismatch is handled upstream
- **GIVEN** a provider returns a signed-thinking mismatch that pi recovers from internally
- **WHEN** the turn completes
- **THEN** the bridge SHALL NOT implement its own mismatch recovery
- **AND** SHALL forward the resulting events unchanged
