# dashboard-roles-ownership Specification

## Purpose

Establishes pi-agent-dashboard as the sole owner of `~/.pi/agent/providers.json#roles`, `#rolePresets`, and `#activePreset`. Hosts the relocated `flow:role-*` event handlers (previously in pi-flows' `role-manager.ts`), preserves bit-for-bit behaviour, and exposes a single role-reader function consumed by `model:resolve` for `@role` lookups. The `autonomousMode` key remains owned by pi-flows.

## Requirements

### Requirement: pi-agent-dashboard SHALL own `~/.pi/agent/providers.json#roles`, `#rolePresets`, and `#activePreset`

The dashboard extension SHALL be the sole writer of the `roles`, `rolePresets`, and `activePreset` keys in `~/.pi/agent/providers.json`. The dashboard SHALL be a reader of those keys as needed for serving `flow:role-*` events and for `model:resolve` `@role` lookups.

The on-disk format SHALL NOT change. Existing files written by pi-flows' (now-deleted) `role-manager.ts` SHALL be read without migration.

#### Scenario: Reads tolerate a missing file

- **GIVEN** `~/.pi/agent/providers.json` does NOT exist
- **WHEN** any role read is attempted
- **THEN** the read SHALL return an empty `{ roles: {}, rolePresets: [], activePreset: null }` object
- **AND** SHALL NOT throw or log a fatal error

#### Scenario: Reads tolerate malformed JSON

- **GIVEN** `~/.pi/agent/providers.json` contains unparseable JSON
- **WHEN** any role read is attempted
- **THEN** the read SHALL catch the parse error
- **AND** SHALL return the empty `{ roles: {}, … }` object
- **AND** SHALL log a clear warning to stderr including the file path

#### Scenario: Writes use atomic tmp+rename

- **WHEN** the dashboard writes the file
- **THEN** the implementation SHALL write to a `.tmp-<id>` sibling first, fsync, then `rename` to the final path
- **AND** the file MUST NEVER be observed in a partial state by readers

#### Scenario: Writes preserve unrelated keys

- **GIVEN** the file contains `providers`, `roles`, `autonomousMode`, and a hypothetical future key `foo`
- **WHEN** the dashboard updates `roles` only
- **THEN** the file's `providers`, `autonomousMode`, and `foo` keys SHALL be preserved bit-for-bit
- **AND** only the `roles` (and possibly `rolePresets` / `activePreset`) keys SHALL be rewritten

### Requirement: pi-agent-dashboard SHALL register the `flow:role-*` event handlers relocated from pi-flows

The dashboard extension SHALL register listeners for the five event names that today (pre-change) are answered by `pi-flows/extensions/role-manager.ts`:

- `flow:role-set` — set/clear a role's model assignment.
- `flow:role-get-all` — snapshot all roles, presets, and active preset name.
- `flow:role-preset-load` — replace the active roles map with a named preset's contents.
- `flow:role-preset-save` — capture the current roles map as a named preset.
- `flow:role-preset-delete` — remove a named preset.

Behaviour SHALL be preserved bit-for-bit from the pi-flows implementation, including (a) re-reading the file on every event so cross-session updates are visible, (b) the rule that loading a preset replaces `roles` wholesale, (c) the rule that setting a role while a preset is active updates that preset in-place, and (d) the `success` boolean response field on mutating events.

The event NAMES SHALL be preserved with the `flow:` prefix in this change. A rename to `roles:*` is out of scope and tracked separately.

#### Scenario: flow:role-get-all returns roles + presets + activePreset

- **GIVEN** the file contains `roles: { fast: "anthropic/opus" }, rolePresets: [{ name: "default", roles: { … } }], activePreset: "default"`
- **WHEN** an emitter calls `pi.events.emit("flow:role-get-all", data)`
- **THEN** after the emit returns, `data.roles` SHALL deep-equal `{ fast: "anthropic/opus" }`
- **AND** `data.presets` SHALL deep-equal `[{ name: "default", roles: { … } }]`
- **AND** `data.activePreset` SHALL equal `"default"`

#### Scenario: flow:role-set persists immediately

- **WHEN** an emitter calls `pi.events.emit("flow:role-set", { role: "coding", modelId: "anthropic/claude-opus-4" })`
- **THEN** `data.success` SHALL be set to `true`
- **AND** the on-disk file SHALL contain `roles.coding === "anthropic/claude-opus-4"` after the call returns
- **AND** a subsequent `flow:role-get-all` SHALL return that value

#### Scenario: flow:role-set with an active preset updates the preset too

- **GIVEN** `activePreset === "default"` and `rolePresets[0].name === "default"`
- **WHEN** `flow:role-set` runs with a new role assignment
- **THEN** both `roles[role]` and `rolePresets[0].roles[role]` SHALL be updated to the new value
- **AND** both updates SHALL be persisted in the same atomic write

#### Scenario: flow:role-preset-load replaces roles wholesale

- **GIVEN** `rolePresets` contains `{ name: "speed", roles: { fast: "x/y" } }` and the current `roles` map has `{ fast: "old", slow: "leftover" }`
- **WHEN** `flow:role-preset-load` runs with `{ name: "speed" }`
- **THEN** `data.success` SHALL be `true`
- **AND** the new `roles` map SHALL deep-equal `{ fast: "x/y" }` (NOT `{ fast: "x/y", slow: "leftover" }`)
- **AND** `activePreset` SHALL be `"speed"`

#### Scenario: flow:role-preset-load with unknown name fails cleanly

- **GIVEN** `rolePresets` does NOT contain an entry named `"nonexistent"`
- **WHEN** `flow:role-preset-load` runs with `{ name: "nonexistent" }`
- **THEN** `data.success` SHALL be `false`
- **AND** the existing `roles` map SHALL NOT be modified
- **AND** the file SHALL NOT be written

#### Scenario: Missing required fields produce success=false

- **WHEN** `flow:role-set` runs with `{}` (no role, no modelId)
- **THEN** `data.success` SHALL be `false`
- **AND** the file SHALL NOT be written

### Requirement: pi-agent-dashboard SHALL NOT read or write `~/.pi/agent/providers.json#autonomousMode`

The `autonomousMode` key in `providers.json` is owned by pi-flows (in its new `extensions/autonomous-mode.ts` module). The dashboard SHALL NOT read this key for any reason and SHALL preserve it during writes.

#### Scenario: Dashboard writes do not touch autonomousMode

- **GIVEN** the file contains `autonomousMode: false`
- **WHEN** the dashboard performs a `flow:role-set` that triggers a write
- **THEN** the post-write file SHALL still contain `autonomousMode: false`

### Requirement: The role-events back-end implementation SHALL live in its own module

The implementation of the five `flow:role-*` handlers SHALL live in a dedicated source file `packages/extension/src/role-manager.ts` (named to mirror pi-flows' soon-deleted file for diff symmetry during review). The module SHALL export an `activate(pi: ExtensionAPI)` function that registers all five handlers.

The dashboard's main bridge module (or `provider-register.ts`, whichever serves as the activation entry today) SHALL call this `activate` exactly once during extension startup.

#### Scenario: Single activate call

- **WHEN** the dashboard extension's top-level `activate(pi)` runs
- **THEN** `packages/extension/src/role-manager.ts::activate(pi)` SHALL be called exactly once
- **AND** that call SHALL register five `pi.events.on(…)` listeners (one per event name above)

### Requirement: `model:resolve` SHALL consult the same `role-manager.ts` reader for `@role` lookups

To avoid duplicate file-read logic, the `model:resolve` listener in `provider-register.ts` SHALL import the role-reader from `role-manager.ts` (a single function such as `getModelRole(role)` or `loadRoles()`) rather than maintaining its own inline `loadRoles()` helper.

#### Scenario: Single reader function is used by both listeners

- **WHEN** `model:resolve` handles `{ ref: "@fast" }`
- **THEN** the listener SHALL call into the same role-reader the `flow:role-get-all` handler uses
- **AND** the inline `loadRoles()` helper currently inside `provider-register.ts` SHALL be removed in favor of that single reader

### Requirement: pi-agent-dashboard SHALL register a `role:resolve-model` listener serving the subagents harness

The dashboard extension SHALL register a `pi.events.on("role:resolve-model", probe)` listener in `role-manager.ts::activate`. This serves `pi-dashboard-subagents` (>= 0.2.0), which resolves an agent definition's `model: "@role"` frontmatter by emitting `role:resolve-model` with a probe-shaped `{ ref: string, resolved?: string, available?: Record<string, string> }` and reading back `probe.resolved`.

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
