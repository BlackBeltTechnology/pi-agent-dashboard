## Why

The custom-roles UI (`add-custom-roles-ui`, #282) is dead on the dashboard: the "＋ Add custom role" control and the Built-in/Custom grouping never render, so users cannot define `@fast`-style custom named roles. Root cause: `builtinRoleNames` — which the bridge sends and the spec REQUIRES to reach the client (`dashboard-roles-ownership`, "The `roles:get-all` payload SHALL advertise the built-in role-name set") — is silently dropped at both server→browser relay hops. This is a spec-conformance regression, not a missing feature.

## What Changes

- Add `builtinRoleNames?: string[]` to the browser-facing `BrowserRolesListMessage` (server→browser protocol type).
- Forward `builtinRoleNames` in the server's `roles_list` re-broadcast (`event-wiring.ts`), instead of dropping it.
- Carry `builtinRoleNames` into the roles plugin config in the client's `roles_list` handler (`useMessageHandler.ts`), instead of dropping it.
- Add a regression guard asserting the field survives the full bridge→server→client relay so the custom-role UI renders.

No behavior change for consumers that ignore the field (additive/optional). No bridge change — the extension already sends it correctly.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `dashboard-roles-ownership`: strengthen the existing "advertise the built-in role-name set" requirement with an explicit end-to-end relay scenario — the browser-facing `roles_list` message and the client's plugin-config write SHALL both preserve `builtinRoleNames`. Codifies the boundary the regression crossed.

## Impact

- `packages/shared/src/browser-protocol.ts` — `BrowserRolesListMessage` gains `builtinRoleNames?: string[]`.
- `packages/server/src/event-wiring.ts` — `roles_list` broadcast forwards the field (server runs via jiti; restart only, no build).
- `packages/client/src/hooks/useMessageHandler.ts` — `roleInfo` includes the field (requires client rebuild + server restart to deploy).
- Tests: server relay + client handler regression coverage.

## Discipline Skills

- `systematic-debugging` — the fix completes a root-caused relay-drop regression; a reproducing regression test anchors it before the one-line relays land.
