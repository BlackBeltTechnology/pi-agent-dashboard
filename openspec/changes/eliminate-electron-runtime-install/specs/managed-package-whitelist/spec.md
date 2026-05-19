## REMOVED Requirements

### Requirement: `ELECTRON_OWNED_PACKAGES` whitelist as single source of truth for wipe/reinstall scope

**Reason for removal:** The whitelist (`packages/shared/src/managed-package-whitelist.ts`) existed to distinguish Electron-owned packages (which the bootstrap could safely wipe and reinstall) from user-owned packages in the shared `~/.pi-dashboard/node_modules/` directory. Because the shared directory no longer exists for new installs and no wipe/reinstall code path remains, the distinction is no longer meaningful. The parity regression test asserting set equality with `offline-packages.json` is also removed.

**Migration:** Pi, openspec, and tsx are now pre-installed at build time inside `resources/server/node_modules/` (read-only). User `pi install <ext>` continues to write to pi's own cache under `~/.pi/agent/...`. There is no shared writable directory to disambiguate.

#### Scenario: Whitelist module removed

- **GIVEN** the shared package
- **WHEN** `packages/shared/src/managed-package-whitelist.ts` is searched for
- **THEN** the file SHALL NOT exist
- **AND** the export `ELECTRON_OWNED_PACKAGES` SHALL NOT be available
- **AND** the function `isElectronOwnedPackage` SHALL NOT be exported

#### Scenario: Parity regression test removed

- **GIVEN** the shared test suite
- **WHEN** `npm test --workspace=@blackbelt-technology/pi-dashboard-shared` runs
- **THEN** no test asserting parity between `ELECTRON_OWNED_PACKAGES` and `offline-packages.json` SHALL execute
- **AND** the file `managed-package-whitelist-parity.test.ts` SHALL NOT exist

#### Scenario: Wipe and reinstall code paths removed

- **GIVEN** the Electron lib
- **WHEN** the codebase is grepped for `planSafeWipe`, `isElectronOwnedPackage`, or `force-reinstall`
- **THEN** no matches SHALL be found in production source files
