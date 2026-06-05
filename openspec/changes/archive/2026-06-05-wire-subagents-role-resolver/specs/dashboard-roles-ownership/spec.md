## ADDED Requirements

### Requirement: pi-agent-dashboard SHALL register a `role:resolve-model` listener serving the subagents harness

The dashboard extension SHALL register a `pi.events.on("role:resolve-model", probe)` listener in `role-manager.ts::activate`. This serves `pi-dashboard-subagents` (>= 0.2.0), which resolves an agent definition's `model: "@role"` frontmatter by emitting `role:resolve-model` with a probe shaped `{ ref: string, resolved?: string, available?: Record<string, string> }` and reading back `probe.resolved`.

The handler SHALL:

- Read `probe.ref` and ignore the event when `probe` is missing/null or `probe.ref` is not a string.
- Strip a single leading `@` from `probe.ref` to obtain the role name; ignore the event when the resulting role name is empty.
- Re-read `~/.pi/agent/providers.json#roles` on every event via the same role reader used by the `flow:role-*` handlers (no duplicate file-read logic).
- Set `probe.available` to the current roles map (so the subagents harness can list assignable roles in its error output).
- Set `probe.resolved` to the role's assigned literal `provider/modelId` when that value is a non-empty string; otherwise leave `probe.resolved` unset (the subagents harness treats an unset `probe.resolved` as a resolution failure and falls through to its own error).

The handler SHALL be read-only (no writes to `providers.json`) and SHALL NOT throw on malformed input.

This requirement is additive: the existing `model:resolve` and deprecated `flow:resolve-model` listeners (capability `dashboard-model-resolution`) are unchanged and continue to use their own probe shapes.

#### Scenario: `@role` ref resolves to the assigned model

- **GIVEN** `~/.pi/agent/providers.json#roles` contains `{ fast: "my-google/gemma-4-31b-it" }`
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "@fast" })`
- **THEN** after the emit returns, `probe.resolved` SHALL equal `"my-google/gemma-4-31b-it"`
- **AND** `probe.available` SHALL deep-equal `{ fast: "my-google/gemma-4-31b-it" }`

#### Scenario: Bare role name without `@` resolves

- **GIVEN** `roles` contains `{ fast: "anthropic/haiku" }`
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "fast" })`
- **THEN** `probe.resolved` SHALL equal `"anthropic/haiku"`

#### Scenario: Unassigned role leaves `probe.resolved` unset

- **GIVEN** `roles` does NOT contain an entry named `ghost`
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "@ghost" })`
- **THEN** `probe.resolved` SHALL remain `undefined`
- **AND** `probe.available` SHALL deep-equal the current (possibly empty) roles map

#### Scenario: Cross-session role edit is visible

- **GIVEN** the handler is registered
- **WHEN** another writer sets `roles.fast = "x/y"` on disk after activation
- **AND** an emitter then calls `pi.events.emit("role:resolve-model", { ref: "@fast" })`
- **THEN** `probe.resolved` SHALL equal `"x/y"` (the handler re-read disk)

#### Scenario: Malformed probe is ignored without throwing

- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", {})` or `pi.events.emit("role:resolve-model", null)`
- **THEN** the handler SHALL return without throwing
- **AND** SHALL NOT write `~/.pi/agent/providers.json`
