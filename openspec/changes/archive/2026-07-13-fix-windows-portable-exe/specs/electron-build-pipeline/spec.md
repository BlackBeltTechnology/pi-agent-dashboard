## MODIFIED Requirements

### Requirement: Windows artifact set
The Windows release pipeline SHALL produce only artifacts that have been verified to launch successfully on a clean Windows host (x64 and arm64). Artifacts that fail this verification MUST NOT be uploaded to the GitHub Release, and the build step that produces them MUST be either fixed or removed.

#### Scenario: Portable .exe verified before release
- **WHEN** the publish workflow runs the `Build Windows ZIP and portable exe` step on `windows-latest`
- **THEN** EITHER the resulting `PI-Dashboard-<arch>-portable.exe` SHALL be verified by an automated smoke test (downloading the artifact, executing it on a clean Windows host, and asserting the dashboard reaches `/api/health` within a bounded timeout)
- **OR** the portable build step SHALL be removed from `.github/workflows/publish.yml` and the matching scripts (`packages/electron/scripts/build-windows-zip.sh`, `packages/electron/scripts/docker-make.sh`)

#### Scenario: Broken portable artifact never uploaded
- **WHEN** a Windows artifact fails its smoke test
- **THEN** the publish workflow SHALL fail the job and NOT upload the broken artifact to the GitHub Release

#### Scenario: Documentation matches shipped artifacts
- **WHEN** the publish workflow completes
- **THEN** `README.md`, `site/src/components/InstallTabs.tsx`, and `site/src/lib/github-release.ts` SHALL only reference Windows artifact kinds that the workflow actually produces (e.g. if portable is dropped, no source advertises portable)

### Requirement: Electron bootstrap survives transient install location
When the Electron app is launched from a 7-Zip SFX self-extracted location (a transient `%LOCALAPPDATA%\Temp\<random>\` path that may be deleted between launches), the bootstrap (`selectLaunchSource()` and `bundle-extract.ts`) SHALL EITHER (a) succeed by treating transient locations as never-cacheable and re-extracting on every launch, OR (b) detect the transient-location scenario early and abort with a user-visible error dialog explaining the unsupported configuration. The bootstrap MUST NOT silently exit with no diagnostic.

#### Scenario: Portable launch from fresh SFX temp dir
- **WHEN** `PI-Dashboard-portable.exe` is launched on a clean Windows host
- **AND** the 7-Zip SFX has extracted the app to a fresh `%LOCALAPPDATA%\Temp\<random>\` directory
- **THEN** EITHER the dashboard SHALL reach `/api/health` within the bounded timeout
- **OR** a user-visible error dialog SHALL appear naming the unsupported configuration

#### Scenario: Portable second launch with stale extracted-marker
- **WHEN** `PI-Dashboard-portable.exe` has been launched once and the SFX temp dir from that launch has been cleaned up
- **AND** the user launches `PI-Dashboard-portable.exe` again (new SFX temp dir, but `~/.pi-dashboard/` still contains a marker pointing at the previous, now-deleted temp dir)
- **THEN** the bootstrap SHALL recognize the marker as stale and re-extract from the current SFX temp dir
- **AND** the dashboard SHALL reach `/api/health` within the bounded timeout

#### Scenario: No silent failure
- **WHEN** the bootstrap cannot resolve a launch source on Windows
- **THEN** it SHALL write a diagnostic line to `%LOCALAPPDATA%\pi-agent-dashboard\launch.log` naming every probed source and why each was rejected
- **AND** it SHALL display a user-visible error dialog before exiting
