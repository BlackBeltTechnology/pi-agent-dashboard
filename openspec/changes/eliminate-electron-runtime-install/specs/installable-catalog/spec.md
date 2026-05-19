## REMOVED Requirements

### Requirement: `installable.json` v2 catalog with kind/source/required fields

**Reason for removal:** The installable catalog (`packages/shared/src/installable-list.ts` + `~/.pi/dashboard/installable.json`) drove the per-launch reconcile loop and the wizard's package selector. With no runtime install and no package selector, the catalog has no consumer. The v1→v2 migration code, the three-tier assembly (`offline-cache` / `bundled-git` / `npm-registry`), and the `kind`/`source`/`required` schema all become dead code.

**Migration:** The build-time pin source (`packages/electron/offline-packages.json` versions for pi/openspec/tsx) moves into a constant inside `packages/electron/scripts/bundle-server.mjs`. Existing `~/.pi/dashboard/installable.json` files in the wild are ignored. They are not read, not migrated, not deleted.

#### Scenario: Installable list file is not read at startup

- **GIVEN** `~/.pi/dashboard/installable.json` exists on the user's disk
- **WHEN** the dashboard server starts
- **THEN** the file SHALL NOT be opened
- **AND** `bootstrap-install-from-list.ts` SHALL NOT exist
- **AND** no fs.readFile / fs.readFileSync call SHALL target `installable.json`

#### Scenario: Catalog assembly code removed

- **GIVEN** the Electron build
- **WHEN** the codebase is grepped for `installable-catalog.ts`
- **THEN** no matches SHALL be found in `packages/electron/src/`
- **AND** no matches SHALL be found in `packages/shared/src/`

#### Scenario: Schema types removed

- **GIVEN** the shared package
- **WHEN** the file `packages/shared/src/installable-list.ts` is referenced
- **THEN** the file SHALL NOT exist
- **AND** the types `InstallablePackage`, `InstallableList`, `readInstallableList`, `writeInstallableList`, `mergeInstallableList` SHALL NOT be exported
