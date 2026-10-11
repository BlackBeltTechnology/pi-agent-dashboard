## MODIFIED Requirements

### Requirement: Electron delegates to shared for non-UI platform concerns
Platform concerns that do NOT require Electron APIs (binary lookup, machine info via `sysctl`/`systemd-detect-virt`/`wmic`, jiti register-hook resolution) SHALL be implemented in `packages/shared/src/platform/` and consumed by Electron via import. `packages/electron/src/lib/server-lifecycle.ts` SHALL NOT contain a duplicate jiti resolver.

#### Scenario: Electron jiti resolver is removed
- **WHEN** a developer inspects `packages/electron/src/lib/server-lifecycle.ts` after the migration
- **THEN** the function `resolveJitiFromAnchor` SHALL NOT exist
- **AND** the function `resolveJitiFromPi` SHALL NOT exist; Electron SHALL resolve jiti via `ToolResolver.resolveJiti` from `packages/shared/src/platform/binary-lookup.ts`

#### Scenario: Electron machine-info uses shared primitive
- **WHEN** `packages/electron/src/main.ts` logs machine info at startup
- **THEN** it SHALL call `platform/commands.ts:detectMachineInfo()` rather than branching on `process.platform` to invoke `sysctl`, `systemd-detect-virt`, or `wmic` inline
