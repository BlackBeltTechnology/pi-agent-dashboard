# electron-launch-source — delta

## ADDED Requirements

### Requirement: Differentiated error on missing bundled server
When `selectLaunchSource()` has exhausted all probe candidates and is about to throw an error, it SHALL first attempt to read `<resourcesPath>/server/.bundle-mode.json` via the pure helper `readBundleModeStamp()`. The choice of error class SHALL be driven by the stamp:

| Stamp state | Thrown error |
|---|---|
| Stamp present AND `mode === "source-only"` | `SourceOnlyBundleError` (new) |
| Stamp present AND `mode === "full"` | `BundledServerMissingError` (existing) |
| Stamp absent or malformed | `BundledServerMissingError` (existing — conservative fallback for legacy bundles) |

`SourceOnlyBundleError` SHALL carry `bundledAt` (the stamped ISO timestamp) and a message directing the user to either download a release or trigger a runnable CI build, including a clickable releases-page URL.

#### Scenario: Source-only bundle reports honest cause
- **WHEN** a user launches an Electron build whose `resources/server/.bundle-mode.json` has `mode: "source-only"` and whose `resources/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` is absent
- **THEN** `selectLaunchSource()` SHALL throw `SourceOnlyBundleError`, not `BundledServerMissingError`

#### Scenario: Full-mode bundle that is genuinely corrupted
- **WHEN** a user launches a build whose stamp says `mode: "full"` but `cli.ts` is somehow absent (disk corruption, AV quarantine, partial extract)
- **THEN** `selectLaunchSource()` SHALL throw `BundledServerMissingError` with the existing "installation may be corrupted; reinstall" message

#### Scenario: Pre-stamp legacy bundle
- **WHEN** a user launches a bundle produced before this change (no `.bundle-mode.json`) and `cli.ts` is absent
- **THEN** `selectLaunchSource()` SHALL throw `BundledServerMissingError` (no regression vs. today's behaviour)

### Requirement: `SourceOnlyBundleError` user-facing dialog
The Electron main process SHALL catch `SourceOnlyBundleError` distinctly from `BundledServerMissingError` and display a dialog whose:
- Title is `"PI Dashboard — Source-Only Build"`.
- Message body names the build's `bundledAt` timestamp and instructs the user to download a release or trigger a runnable CI build.
- Buttons are `["Open Releases Page", "OK"]`; choosing the first opens the GitHub releases URL via `shell.openExternal`.

After the dialog dismisses, the app SHALL exit cleanly via `app.quit()`.

#### Scenario: Dialog has actionable button
- **WHEN** the source-only dialog appears AND the user clicks "Open Releases Page"
- **THEN** the system browser SHALL navigate to the releases URL configured in `SOURCE_ONLY_RELEASES_URL`
- **AND** the app SHALL exit immediately after the browser is opened

#### Scenario: Dialog explains the difference
- **WHEN** the source-only dialog is rendered
- **THEN** the message text SHALL NOT include the substring "may be corrupted" (which would contradict the honest diagnosis)
- **AND** the message SHALL include both the `bundledAt` ISO timestamp and the literal substring "source-only"
