## Why

`pi-dashboard-subagents` (>= 0.2.0) resolves an agent definition's `model: "@role"` frontmatter by emitting `pi.events.emit("role:resolve-model", probe)` and reading back `probe.resolved` (a literal `provider/modelId`). See `extensions/agent.ts` `resolveModel` — on empty `probe.resolved` it hard-fails with `Cannot resolve role "@<role>"`.

The dashboard bridge owns role assignments (`dashboard-roles-ownership`) and model resolution (`dashboard-model-resolution`), but registers only `model:resolve` (and the deprecated `flow:resolve-model`). **Neither handler answers `role:resolve-model`.** Confirmed by `rg -n "role:resolve-model" packages/` returning no `pi.events.on` registration.

Consequence: every subagent whose `.md` uses a `@role` alias (e.g. `.pi/agents/Explore.md` → `model: "@fast"`) fails to spawn with:

```
Cannot resolve role "@fast".
Either the roles-plugin bridge is not loaded (no handler for
"role:resolve-model" on pi.events), or the role is not assigned in
~/.pi/agent/providers.json.
```

This blocks every `@role`-based subagent (Explore harvesting per AGENTS.md Investigation Protocol, any future role-aliased agents) even when the role IS assigned in `providers.json#roles`.

## What Changes

- `packages/extension/src/role-manager.ts` `activate()` registers a `role:resolve-model` listener. The handler reads `probe.ref` (e.g. `"@fast"` or bare `"fast"`), strips a leading `@`, looks up the role via the existing `role-manager.ts` reader against `providers.json#roles`, sets `probe.available` to the full roles map (for the subagents error listing), and sets `probe.resolved` to the assigned literal `provider/modelId` when present.
- The handler is read-only (no writes), re-reads disk on every event (cross-session visibility), and fail-soft: a malformed/empty probe is ignored without throwing.
- Reuses the same single role reader (`getModelRole` / `loadRoleConfig`) the `flow:role-*` handlers and `model:resolve` already use — no duplicate file-read logic.

## Capabilities

### New Capabilities
- _None._

### Modified Capabilities
- `dashboard-roles-ownership`: adds requirement that the bridge registers a `role:resolve-model` listener serving the subagents harness probe contract, resolving `@role` via the same role reader and leaving `probe.resolved` unset (fall-through) when unassigned.

## Impact

- **Touched files**: `packages/extension/src/role-manager.ts` (+1 listener), `packages/extension/src/__tests__/role-manager.test.ts` (+5 tests).
- **Probe contract**: additive. `model:resolve` and `flow:resolve-model` are untouched. Existing role data and on-disk format unchanged.
- **Behaviour change**: `@role` subagent model fields resolve when the role is assigned; unassigned roles still fall through to the subagents error (now including the `Available roles:` list since `probe.available` is populated).
- **No new dependencies, no schema migration.** Hot reload (`ctx.reload()`) does not re-import the module into an already-running process; the handler activates in newly started pi sessions (documented limitation, not a regression).
- **Unblocks** `@fast`-based Explore subagent delegation used by the AGENTS.md Investigation Protocol.
