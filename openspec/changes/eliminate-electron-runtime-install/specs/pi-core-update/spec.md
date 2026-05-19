## REMOVED Requirements

### Requirement: In-place upgrade of pi/openspec/tsx via REST endpoint

**Reason for removal:** `POST /api/pi-core/update` and `GET /api/pi-core/changelog` enabled in-place upgrade of pi/openspec/tsx inside a running dashboard, by running `npm install <pkg>@<version>` against `~/.pi-dashboard/`. This capability was the single load-bearing reason the entire runtime-install pyramid existed (writable managed dir, offline cache, preflight, whitelist, force-reinstall recovery). It is now replaceable by `electron-updater` whole-`.app` replacement: pi-version bumps ride a normal dashboard release.

**Migration:**
1. Pi version pin moves into `packages/electron/scripts/bundle-server.mjs` (the build-time install source).
2. Pi-version bumps are cut as normal dashboard releases via `.pi/skills/release-cut/SKILL.md`.
3. `electron-updater` (already in place) notifies users of new releases.
4. Power users wanting independent pi-version control use the standalone arm (`npm i -g @blackbelt-technology/pi-dashboard`).

This is a **one-way change.** Restoring `/api/pi-core/update` would require rebuilding most of the deleted machinery (writable managed dir, offline cache, reconcile loop, recovery surfaces).

#### Scenario: REST endpoints removed

- **GIVEN** the dashboard server is running
- **WHEN** a client issues `POST /api/pi-core/update` with any payload
- **THEN** the server SHALL respond with HTTP 404
- **AND** when a client issues `GET /api/pi-core/changelog` the server SHALL respond with HTTP 404

#### Scenario: Updater modules removed

- **GIVEN** the server source tree
- **WHEN** the files `pi-core-updater.ts`, `pi-core-checker.ts`, and `routes/pi-core-routes.ts` are searched for
- **THEN** none SHALL exist
- **AND** no import of `PiCoreUpdater` or `PiCoreChecker` SHALL remain in production source

#### Scenario: Pi version bump rides app release

- **GIVEN** a maintainer wants to ship pi `X.Y.Z`
- **WHEN** the maintainer updates the pi version constant in `bundle-server.mjs`
- **AND** runs `.pi/skills/release-cut/SKILL.md`
- **THEN** the next built `.dmg`/`.deb`/`.exe`/`.AppImage` SHALL ship with pi `X.Y.Z` pre-installed in `resources/server/node_modules/@earendil-works/pi-coding-agent`
- **AND** users on prior releases SHALL receive an `electron-updater` notification
- **AND** accepting the update SHALL replace the whole `.app` with the new version
