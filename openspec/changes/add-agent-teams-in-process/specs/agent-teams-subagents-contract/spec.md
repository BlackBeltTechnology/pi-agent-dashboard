## ADDED Requirements

### Requirement: Capability handshake

The lead bridge SHALL query `subagents:capabilities` and use the result as the only source of truth for what the installed `pi-dashboard-subagents` can do: `apiVersion`, `features` (`spawn`, `steer`, `managed`, `loader` required; `loader_skills`, `interrupt`, `cwd_scope` optional) and `limits`. It SHALL fail closed: no answer, a lower `apiVersion` or a missing required feature makes in-process mode unavailable and is never guessed from the package version.

#### Scenario: Compatible package
- **WHEN** the query returns `apiVersion` 1 with all required features
- **THEN** in-process mode is available and the optional features are recorded

#### Scenario: Old package
- **WHEN** the installed package is 0.8.1 and nobody answers the query
- **THEN** in-process mode is unavailable with reason `subagents_extension_missing`

#### Scenario: Optional feature absent
- **WHEN** the answer lacks `interrupt`
- **THEN** in-process mode is available and urgent messages degrade to steer

### Requirement: Spawn request contract

The lead bridge SHALL create a child only with `subagents:spawn`, setting `inline`, `isolated`, `managed {owner:"agent-teams", keepAlive:true}`, `ask:false`, the member's `tools` from the resolved spawn spec and the whitelisted `loader` options. It SHALL read the synchronous reply and map `ok:false` reasons (`no_context`, `cap`, `cwd_*`, `vetoed`, `unsupported`, `invalid`) to stable agent-teams errors. An empty reply (no handler) SHALL map to `subagents_extension_missing`.

#### Scenario: Accepted spawn
- **WHEN** the reply is `ok:true` with `id` and `agentId`
- **THEN** the bridge records the mapping and acknowledges the command

#### Scenario: Rejected cwd
- **WHEN** the reply is `ok:false` reason `cwd_out_of_scope`
- **THEN** the member becomes `failed` with `cwd_outside_scope` and no child exists

#### Scenario: Context not ready
- **WHEN** the reply is `no_context`
- **THEN** the bridge retries after the next `session_start` until `spawnTimeoutMs`

#### Scenario: Handler absent
- **WHEN** the spawn request returns with no `out`
- **THEN** the member becomes `failed` with `subagents_extension_missing`, the name is reusable and the capability probe is repeated

### Requirement: Exactly one activation executes a request

The upstream handlers for `subagents:spawn`, `subagents:steer_request` and `subagents:interrupt_request` SHALL act only when `out` is still unset, SHALL set it before returning, and SHALL answer an id-addressed request only from the activation whose registry holds that id. A second activation of the module on the same bus SHALL therefore never spawn a duplicate child.

#### Scenario: Duplicate activation on one bus
- **WHEN** the package is activated twice on the lead's bus and a spawn request is emitted
- **THEN** exactly one child is created and one reply is produced

#### Scenario: Id owned elsewhere
- **WHEN** a steer request names a child that this activation does not hold
- **THEN** this activation leaves `out` unset so the owning activation answers

### Requirement: Steer request contract

The lead bridge SHALL deliver mail only with `subagents:steer_request`, awaiting the returned promise, and SHALL map `queued` and `started` to handed over, `not_started` to retry after the next child event, and `not_alive` or `not_found` to member loss. An empty reply SHALL leave the mail queued and count a `delivery_timeout`.

#### Scenario: Started on an idle child
- **WHEN** the result is `started`
- **THEN** the mail is handed over and the member is expected to become `busy`

#### Scenario: Retry
- **WHEN** the result is `not_started`
- **THEN** the mail stays queued and is retried on the next `subagents:started` or slot event

#### Scenario: No handler
- **WHEN** the steer request returns with no `out`
- **THEN** the mail stays queued, the member is not marked gone and the capability probe is repeated

### Requirement: Interrupt request contract

With feature `interrupt`, `subagents:interrupt_request {id}` SHALL abort the child's current turn without a failure outcome and park the child idle, and the following `subagents:idle` SHALL carry `aborted:true`. Without the feature the bridge SHALL NOT emulate an interrupt by stopping the child.

#### Scenario: Silent abort
- **WHEN** an interrupt request hits a running child
- **THEN** the run ends without a failed outcome and `idle` carries `aborted:true`

#### Scenario: Feature absent
- **WHEN** an abort is requested and the feature is missing
- **THEN** the abort fails with `interrupt_unavailable` and the child keeps running

### Requirement: Managed children are invisible to the lead model

A `managed` child SHALL NOT be pushed to the lead model, SHALL be excluded from default `AgentControl` coverage, SHALL refuse every model-initiated `AgentControl` action naming it, SHALL ignore `subagents:before_spawn` patches (veto only), SHALL NOT count toward the pending or idle caps, and with `keepAlive` SHALL stay alive when idle until stopped or an optional `idleTtlSec` elapses. It SHALL still emit every `subagents:*` event and dashboard frame.

#### Scenario: No duplicate notice
- **WHEN** a managed child finishes a run
- **THEN** the lead model receives only the agent-teams idle notice, not a `subagents:mail` push

#### Scenario: Lead cannot wait on or steer teammates
- **WHEN** the lead model calls `AgentControl wait` without ids, or `steer` with a child id
- **THEN** managed children are not covered and the explicit action is refused

#### Scenario: Idle child survives the global TTL
- **WHEN** a managed child idles longer than the global idle TTL
- **THEN** it is not freed and keeps its context

#### Scenario: Dock still shows it
- **WHEN** a managed child runs
- **THEN** its row appears in the Processes lane with Stop and Open

### Requirement: Stop uses the existing channel

The bridge SHALL stop or free a child with `subagents:stop {agentId}`, which frees idle children as well as running or queued ones, and SHALL treat the resulting `disposed` or stopped event as confirmation that the member is `gone`.

#### Scenario: Shutdown approved
- **WHEN** a member approves shutdown and its final run settles
- **THEN** the bridge emits `subagents:stop` and the member becomes `gone` on the confirming event

#### Scenario: Stop of an unknown child
- **WHEN** `subagents:stop` finds no child
- **THEN** no event follows and the server marks the member `gone: not_alive` after the command timeout

### Requirement: Dependency declaration and version gate

The `agent-teams` manifest SHALL NOT add `pi-dashboard-subagents` to `requires.piExtensions`. The recommended-extension entry SHALL describe background runs and the team API and list `Agent` and `AgentControl`. The plugin SHALL document the minimum upstream release and gate only through the capability handshake.

#### Scenario: Session-only user sees no warning
- **WHEN** the package is not installed
- **THEN** the agent-teams plugin shows no missing-requirement pill

#### Scenario: Entry copy is current
- **WHEN** the recommended package list is read
- **THEN** the subagents entry no longer says "no background sessions"

### Requirement: Upstream acceptance criteria

The upstream release SHALL implement every required item of this contract with automated tests: the capability query, spawn with synchronous reply and all per-spawn options, steer, managed semantics, the claim rule, retention of `tool_call`, `before_agent_start` and `input` handlers in inline extensions, context capture and release, and a CHANGELOG and README entry. The release number SHALL be recorded here before the in-process driver is enabled by default.

#### Scenario: Contract test double
- **WHEN** the agent-teams tests run without the upstream package
- **THEN** a recorded contract double reproduces replies and events of the acceptance criteria

#### Scenario: Gate before enabling
- **WHEN** the upstream release is not yet published
- **THEN** the in-process driver stays behind the failing capability handshake

### Requirement: Stable error codes and refusal reason

Spawn failures SHALL reuse core's codes for cap and name in use and `invalid_args` for `invalid`, map `cwd_*` to `cwd_outside_scope`, `vetoed` to `spawn_vetoed` and `unsupported` to `subagents_extension_outdated`. The upstream refusal of a model-initiated `AgentControl` action on a managed child SHALL carry the reason `managed_child`.

#### Scenario: Vetoed spawn
- **WHEN** the reply is `ok:false` with reason `vetoed`
- **THEN** the member fails with `spawn_vetoed` and the name is reusable

### Requirement: Same-tick settle guarantee

The upstream SHALL emit `completed` (or `failed`) and the following `idle` of one run in the same tick. This guarantee SHALL be covered by the upstream acceptance tests and the recorded-vs-live drift test. The bridge SHALL add a ~50 ms mapper grace only if upstream declines the guarantee.

#### Scenario: Drift test
- **WHEN** the live upstream emits `completed` and `idle` in different ticks
- **THEN** the drift test fails
