# flows-anthropic-bridge-activation Specification

## Purpose

The bridge extension entry auto-loads `@pi/anthropic-messages` transform hooks into a pi process and into every flow agent it spawns, but only when both required peers resolve. It probes for its peers at activation and again at every session boundary, wires hooks exactly once per process, re-announces a stable agent factory so pi-flows re-acquires it after re-seeding, degrades terminally when a peer disappears, and broadcasts per-PID status. The bridge is pure plumbing: it never reimplements or configures the peer's transform, and treats the peer's per-agent gate as an opaque boolean it merely forwards.

## Requirements

### Requirement: Peer probing on activation

The bridge SHALL probe for both required peers — `@pi/anthropic-messages` (probed under its current scoped name first, then its legacy name) and `pi-flows` — on activation, anchoring module resolution at `process.cwd()`, and SHALL only proceed to wire hooks when both peers resolve.

#### Scenario: Both peers present at activation

- **WHEN** the bridge activates and both `@pi/anthropic-messages` and `pi-flows` resolve
- **THEN** it loads `@pi/anthropic-messages`, runs its default export against the main pi instance, and transitions status to `active`

#### Scenario: A peer is missing at activation

- **WHEN** the bridge activates and either peer fails to resolve
- **THEN** it does not wire any hooks and sets status to `waiting_peers`, retaining the failing peer's resolution reason for reporting

#### Scenario: anthropic-messages resolved under the legacy name

- **WHEN** the current scoped `@blackbelt-technology/pi-anthropic-messages` name does not resolve but the legacy `@pi/anthropic-messages` name does
- **THEN** the peer is treated as present and the bridge proceeds using whichever name resolved

#### Scenario: pi-flows detected via its event listener

- **WHEN** the `pi-flows` module specifier does not resolve but at least one listener is registered for the `flow:register-agent-extension` event
- **THEN** `pi-flows` is treated as present with reason indicating it was detected via the listener

### Requirement: Two-tier peer resolution

The bridge SHALL resolve each peer using a two-tier strategy: first Node's cwd-anchored resolver, then a pi-packages fallback that reads pi's settings for peers installed via pi (npm/git/local) but unreachable from Node's `node_modules` walk.

#### Scenario: Peer reachable from cwd node_modules

- **WHEN** Node's cwd-anchored resolver resolves a peer specifier
- **THEN** the probe records the hit with tier `node`

#### Scenario: Peer installed only via pi packages

- **WHEN** Node's resolver throws for a peer but the pi-packages fallback returns an absolute entry path
- **THEN** the probe records the hit with tier `pi-packages` and the absolute entry path

#### Scenario: Import selects the specifier matching the resolution tier

- **WHEN** the anthropic-messages peer resolved via the `pi-packages` tier
- **THEN** the bridge imports it by its absolute entry path; otherwise it imports the bare specifier so Node ESM yields a shared module instance

### Requirement: Load hooks into main session and every spawned flow agent

When both peers are present, the bridge SHALL run the `@pi/anthropic-messages` default export against the main pi instance AND build a stable agent-factory reference (once) that runs the same default export against each spawned flow agent, emitting the factory over `flow:register-agent-extension` so pi-flows applies it at agent spawn.

#### Scenario: Main session wired on first successful probe

- **WHEN** both peers resolve for the first time
- **THEN** the bridge runs the anthropic-messages default export against the main pi instance and marks itself wired

#### Scenario: Spawned flow agent receives the same hooks

- **WHEN** the agent factory is applied to a spawned flow agent's pi instance
- **THEN** it runs the anthropic-messages default export against that agent
- **AND** registers a `session_start` handler on the agent that emits `flows-anthropic-bridge:agent-active` with the process pid, the agent's model id, and an opaque `gateOpen` boolean computed as `!!isClaudeAnthropicMessages?.(agentCtx)` and forwarded verbatim

#### Scenario: Stable factory identity across re-emits

- **WHEN** the bridge re-emits the agent factory after it has already been built
- **THEN** it emits the same stable factory reference so pi-flows can dedupe, rather than constructing a new one

#### Scenario: Import fails after resolution succeeds

- **WHEN** both peers resolve but importing `@pi/anthropic-messages` throws
- **THEN** the bridge stays unwired at status `waiting_peers` and surfaces the import failure reason, allowing a later reload to complete wiring

### Requirement: Re-probe at session boundaries

The bridge SHALL re-probe on every `session_start` to catch peers installed late (e.g. after `/reload`), wiring hooks the first time both peers appear, and SHALL re-announce the stable agent factory on each subsequent boundary so pi-flows re-acquires it after re-seeding its agent-extension array or after an activation-order race.

#### Scenario: Late peer install detected on reload

- **WHEN** the bridge is in `waiting_peers` and a later `session_start` probe finds both peers present
- **THEN** it wires the hooks and transitions to `active`

#### Scenario: Factory re-announced on session boundary after wiring

- **WHEN** a `session_start` fires after the bridge is already wired and both peers remain present
- **THEN** the bridge re-emits the stable agent factory over `flow:register-agent-extension` without re-running the main-session wiring

### Requirement: Terminal degradation when a peer disappears

After hooks are wired, the bridge SHALL detect on a later probe that a peer no longer resolves and transition status to `degraded` while leaving the already-registered hooks in place for the process lifetime. Degradation is guarded on `status !== "degraded"` and is terminal: once `degraded`, later probes fall to the else branch, which re-fires `emitAgentFactory()` even while peers are absent, and status never recovers to `active`.

#### Scenario: Peer removed after wiring

- **WHEN** the bridge is wired and a subsequent probe finds one or both peers no longer present with status not yet `degraded`
- **THEN** it transitions status to `degraded` and broadcasts the new status, keeping the existing hooks registered

#### Scenario: Degraded status never recovers

- **WHEN** the bridge is already `degraded` and a later `session_start` probe runs
- **THEN** it takes the else branch and re-emits the stable agent factory via `emitAgentFactory()` — even when peers are still absent — and status remains `degraded`, never returning to `active`

### Requirement: Per-PID status broadcasting

The bridge SHALL broadcast a status event carrying the current status, both peers' probe results, the process pid, and a timestamp, and SHALL suppress consecutive broadcasts whose serialized payload is unchanged. Broadcasting SHALL never throw.

#### Scenario: Status change is broadcast

- **WHEN** the bridge's status or peer probe result changes
- **THEN** it emits `flows-anthropic-bridge:status` with status, both peer probes, pid, and timestamp

#### Scenario: Duplicate status suppressed

- **WHEN** a probe produces a payload identical to the last broadcast
- **THEN** the bridge does not re-emit the status event
