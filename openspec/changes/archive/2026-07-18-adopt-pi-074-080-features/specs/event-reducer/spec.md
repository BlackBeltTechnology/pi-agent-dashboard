## ADDED Requirements

### Requirement: Session idle transition resolves on agent_settled

The reducer SHALL treat `agent_settled` (real from pi ≥ 0.80.4, or bridge-synthesized on floor pi — see bridge-extension) as the single terminal signal that resolves `status:"idle"`. `agent_end` SHALL set the intermediate `status:"ended"` (the existing, currently-unassigned enum value in `SessionState.status: "idle"|"streaming"|"ended"` — no consumer reads it for behavior; only `"streaming"` gates the spinner, which correctly turns off at `"ended"`); only `agent_settled` SHALL resolve `"idle"`. No new `status` value is introduced. The reducer SHALL NOT branch on pi version or any `session_register` capability (it has no such channel) and SHALL NOT use a timer. The existing `agent_end` side-effects (last-error extraction, `retryState`/`pendingPrompt` clearing) SHALL be preserved; only the `status:"idle"` assignment moves to the `agent_settled` arm.

Because the bridge guarantees exactly one `agent_settled` per run — real (once, after the retry/compact loop) or synthesized (synchronously after each `agent_end` on floor pi) — the reducer behavior is byte-identical to today on floor pi and flicker-free on modern pi.

#### Scenario: No idle flicker across a retry (modern pi)
- **WHEN** the sequence is `agent_start → agent_end → (auto_retry) → agent_start → agent_end → agent_settled`
- **THEN** `status` SHALL be `"ended"` (not `"idle"`) after each `agent_end` and SHALL remain non-idle until the final `agent_settled`
- **AND** SHALL NOT report `"idle"` between the first `agent_end` and the retry's `agent_start`

#### Scenario: Floor pi resolves idle equivalently to today
- **WHEN** the bridge synthesizes an `agent_settled` synchronously after `agent_end` (floor pi)
- **THEN** the reducer SHALL resolve `status:"idle"` in the same dispatch batch as the `agent_end`
- **AND** the observable outcome SHALL equal today's `agent_end`→`idle`

#### Scenario: agent_end side-effects preserved
- **WHEN** `agent_end` carries a provider error / pending retry
- **THEN** the reducer SHALL still extract last-error and clear `retryState`/`pendingPrompt` on `agent_end`
- **AND** SHALL defer only the `status:"idle"` assignment to the `agent_settled` arm

### Requirement: Reducer captures compaction reason, willRetry, and post-compact estimate

The reducer SHALL capture `reason` (`"manual" | "threshold" | "overflow"`), `willRetry`, and the estimated post-compaction token count from `session_compact` (pi 0.79.8/0.79.10+) into session state when present. Absent fields SHALL leave state unchanged from today.

#### Scenario: Overflow compaction with retry recorded
- **WHEN** `session_compact` carries `reason:"overflow"`, `willRetry:true`, and an estimated post-compaction token count
- **THEN** the reducer SHALL store all three on session state

#### Scenario: Legacy compaction event without new fields
- **WHEN** `session_compact` carries none of `reason`/`willRetry`/estimate
- **THEN** the reducer SHALL store nothing new and behave as today
