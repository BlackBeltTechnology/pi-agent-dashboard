## 1. Register the `role:resolve-model` adapter

- [x] 1.1 In `packages/extension/src/role-manager.ts` `activate()`, register `pi.events.on("role:resolve-model", ...)` before the `flow:role-*` handlers.
- [x] 1.2 Handler reads `probe.ref` (string guard), strips a leading `@`, ignores empty role names.
- [x] 1.3 Handler re-reads disk via `loadRoleConfig()` each call, sets `probe.available = cfg.roles`, and sets `probe.resolved` to the mapped literal `provider/modelId` when non-empty; leaves `probe.resolved` unset otherwise (fall-through).
- [x] 1.4 Reuse the existing single role reader; no duplicate `loadRoles` helper.

## 2. Test coverage

- [x] 2.1 `@role` ref resolves to the assigned model and populates `probe.available`.
- [x] 2.2 Bare role name (no `@`) resolves.
- [x] 2.3 Unassigned role leaves `probe.resolved` unset and `probe.available` empty.
- [x] 2.4 Cross-session edit visible (re-reads disk).
- [x] 2.5 Malformed probe (`{}`, `null`) ignored without throwing.

## 3. Validation

- [x] 3.1 `npm test -- role-manager` passes (26 tests).
- [x] 3.2 `openspec validate wire-subagents-role-resolver` passes.
