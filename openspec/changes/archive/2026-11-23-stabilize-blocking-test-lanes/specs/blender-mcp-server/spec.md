## MODIFIED Requirements

### Requirement: Performance budget
On the `ubuntu-latest` runner of the nightly budget lane, with a valid cached runtime, a session SHALL reach ready within 15 seconds of the first tool call. `blender_scene` on the factory scene of a live session SHALL return within 2 seconds. The Blender host process's resident memory SHALL stay at or below 2.5 GB after booting and serving one factory-scene GLB export. These budgets are measured only there: the `blender-real` legs of `ci.yml` on macOS, Windows and Linux run the functional real-runtime cases and do not assert them.

#### Scenario: Warm boot
- **WHEN** the cache holds a valid runtime and the first `blender_scene` call of a server process is made
- **THEN** its result arrives within 15 seconds

#### Scenario: Scene call on a live session
- **WHEN** a session is live with the factory scene and `blender_scene` is called
- **THEN** its result arrives within 2 seconds

#### Scenario: Host memory after an export
- **WHEN** a fresh session has booted and `blender_export` has written a GLB of the factory scene
- **THEN** the host process's resident memory is at or below 2.5 GB

#### Scenario: Budgets are not asserted on the pull-request legs
- **WHEN** `blender-real (macos-latest)` runs on a pull request
- **THEN** it SHALL run the functional cases of `real-binary.test.ts` and SHALL NOT assert the boot, scene-call or memory budget
