## ADDED Requirements

### Requirement: Remote QA harness location and structure

The system SHALL provide a remote-Windows QA harness under `qa/remote/` consisting of a POSIX driver script and a set of PowerShell remote scripts. The harness MUST NOT modify any file outside `qa/remote/`, `qa/Makefile`, `qa/README.md`, or `.gitignore`.

#### Scenario: Harness layout exists after change is applied
- **WHEN** the change is applied to a clean checkout
- **THEN** the following files exist:
  - `qa/remote/run.sh` — orchestrator driver, executable
  - `qa/remote/remote-clean.ps1`
  - `qa/remote/remote-deploy-zip.ps1`
  - `qa/remote/remote-deploy-portable.ps1`
  - `qa/remote/remote-deploy-npm.ps1`
  - `qa/remote/remote-run-tests.ps1`
  - `qa/remote/config.example.json`
- **AND** `qa/remote/config.json` and `qa/remote/logs/` are listed in `.gitignore`

#### Scenario: Production code is untouched
- **WHEN** the change is applied
- **THEN** no files outside `qa/remote/`, `qa/Makefile`, `qa/README.md`, `.gitignore` are added or modified

### Requirement: SSH transport with public-key auth

The harness SHALL drive the target Windows host exclusively via OpenSSH using public-key authentication. The harness MUST NOT require WinRM, PSRemoting, SMB shares, or password prompts.

#### Scenario: SSH key path is read from config
- **WHEN** the operator runs `qa/remote/run.sh`
- **THEN** the driver reads `sshKey` from `qa/remote/config.json`
- **AND** every `ssh` and `scp` invocation passes that key via `-i`

#### Scenario: No password prompt
- **WHEN** the SSH key is valid and pre-installed in the target's `authorized_keys`
- **THEN** the driver completes a full clean-deploy-test-clean cycle without any interactive prompt

### Requirement: Configuration via `qa/remote/config.json`

The harness SHALL read its configuration from `qa/remote/config.json`. A committed `qa/remote/config.example.json` SHALL document the schema. The real `config.json` MUST be gitignored.

#### Scenario: Required fields are validated before any remote call
- **WHEN** `qa/remote/run.sh` starts and `config.json` is missing or lacks `host`, `user`, `sshKey`, or `mode`
- **THEN** the driver exits non-zero with a message naming the missing field
- **AND** no `ssh` or `scp` is invoked

#### Scenario: Mode field selects deploy script
- **WHEN** `config.json` has `mode: "zip"` (resp. `"portable"`, `"npm"`)
- **THEN** the driver invokes `remote-deploy-zip.ps1` (resp. `-portable`, `-npm`) on the target

#### Scenario: Unknown mode rejected
- **WHEN** `config.json` has a `mode` value other than `zip`, `portable`, or `npm`
- **THEN** the driver exits non-zero with a message listing the three valid modes

### Requirement: Three artifact deploy modes

The harness SHALL support three deploy modes, each producing a runnable dashboard server on the target host.

#### Scenario: ZIP mode
- **WHEN** `mode = "zip"` and `artifactPath` points to a valid `PI-Dashboard-win32-x64-*.zip`
- **THEN** the driver scp's the ZIP to `C:\Temp\pi-dashboard-qa\`
- **AND** `remote-deploy-zip.ps1` extracts it to `C:\Temp\pi-dashboard-test\`
- **AND** launches `PI Dashboard.exe` from the extracted directory
- **AND** confirms the server responds on `http://localhost:8000/api/health` within 60 s

#### Scenario: Portable mode
- **WHEN** `mode = "portable"` and `artifactPath` points to a valid `PI-Dashboard-portable.exe`
- **THEN** the driver scp's the executable to `C:\Temp\pi-dashboard-qa\`
- **AND** `remote-deploy-portable.ps1` launches it directly (no extraction step)
- **AND** confirms the server responds on `http://localhost:8000/api/health` within 60 s

#### Scenario: NPM mode
- **WHEN** `mode = "npm"` with optional `npmVersion` (default `latest`)
- **THEN** `remote-deploy-npm.ps1` runs `npm i -g @blackbelt-technology/pi-dashboard@<npmVersion>`
- **AND** runs `pi-dashboard start`
- **AND** confirms the server responds on `http://localhost:8000/api/health` within 60 s

### Requirement: Idempotent remote cleanup

The `remote-clean.ps1` script SHALL leave the target host in a known-clean state regardless of prior state. The script MUST be safe to run repeatedly without error.

#### Scenario: Clean from running state
- **WHEN** the dashboard server is currently running and ports 8000/9999 are in use
- **AND** `remote-clean.ps1` is invoked
- **THEN** processes named `PI Dashboard`, `pi-dashboard`, `node`, `electron` are stopped
- **AND** any remaining process owning ports 8000 or 9999 is stopped
- **AND** the script exits zero

#### Scenario: Clean from already-clean state
- **WHEN** no dashboard processes are running and no state directories exist
- **AND** `remote-clean.ps1` is invoked
- **THEN** the script exits zero with no errors and no warnings about missing items

#### Scenario: User state is fully removed
- **WHEN** `remote-clean.ps1` runs successfully
- **THEN** the following paths are absent on the target:
  - `%USERPROFILE%\.pi`
  - `%USERPROFILE%\.pi-dashboard`
  - `%APPDATA%\pi-agent-dashboard`
  - `%LOCALAPPDATA%\pi-agent-dashboard`
- **AND** no `%LOCALAPPDATA%\Temp\*pi-dashboard*` or `*PI-Dashboard*` directories remain

#### Scenario: Cleanup runs at start and end of every cycle
- **WHEN** `qa/remote/run.sh` executes a full cycle
- **THEN** `remote-clean.ps1` is invoked once before deploy and once after the test phase finishes
- **AND** the post-run clean executes even if the test phase exits non-zero

### Requirement: Test execution reuses existing PowerShell suite

The harness SHALL run the existing `qa/tests/run-all.ps1` against the deployed install. The harness MUST NOT duplicate or modify test assertions defined in `qa/tests/`.

#### Scenario: Tests are scp'd before execution
- **WHEN** `remote-run-tests.ps1` is about to run
- **THEN** the contents of `qa/tests/` are copied to `C:\Temp\pi-dashboard-qa\tests\` on the target
- **AND** `run-all.ps1` is invoked from that directory

#### Scenario: Test exit code propagates
- **WHEN** `qa/tests/run-all.ps1` exits with code N on the target
- **THEN** `qa/remote/run.sh` exits with code N on the orchestrator (after log collection and post-clean)

### Requirement: Log collection back to orchestrator

The harness SHALL collect test and server logs from the target before the post-run cleanup deletes them.

#### Scenario: Logs round-trip on success
- **WHEN** the test phase exits zero
- **THEN** `qa/remote/run.sh` scp's `C:\Temp\pi-dashboard-qa\logs\` to `qa/remote/logs/<host>-<timestamp>/` on the orchestrator before invoking post-clean

#### Scenario: Logs round-trip on failure
- **WHEN** the test phase exits non-zero
- **THEN** logs are still collected to `qa/remote/logs/<host>-<timestamp>/` before post-clean
- **AND** the orchestrator prints the local log path before propagating the non-zero exit

### Requirement: Makefile targets

`qa/Makefile` SHALL expose four targets that wrap the driver script.

#### Scenario: Mode-specific test targets
- **WHEN** the operator runs `make -C qa test-windows-remote-zip` (resp. `-portable`, `-npm`)
- **THEN** `qa/remote/run.sh` is invoked with the corresponding mode
- **AND** the Makefile's exit code matches the driver's exit code

#### Scenario: Standalone clean target
- **WHEN** the operator runs `make -C qa clean-windows-remote`
- **THEN** `remote-clean.ps1` is invoked on the configured host without any deploy or test step

### Requirement: README documentation

`qa/README.md` SHALL include a "Remote Windows host" section covering one-time setup, configuration, and troubleshooting.

#### Scenario: One-time setup is documented
- **WHEN** the operator reads `qa/README.md` after the change is applied
- **THEN** the section documents OpenSSH server enablement, firewall rule for port 22, public-key install in both per-user `authorized_keys` and `C:\ProgramData\ssh\administrators_authorized_keys`, and the `DefaultShell` registry tweak to PowerShell

#### Scenario: Config layout is documented
- **WHEN** the operator reads `qa/README.md`
- **THEN** the section documents the schema of `qa/remote/config.json` with one example per mode (zip, portable, npm)

#### Scenario: Troubleshooting covers AV quarantine and stale state
- **WHEN** the operator reads `qa/README.md`
- **THEN** the section calls out: portable.exe AV quarantine and the Defender exclusion path; the consequence of co-resident `node.exe` from other tools being killed; how to recover from a stuck SSH session.

### Requirement: No production code changes

This change SHALL NOT modify any file under `src/`, `packages/`, `scripts/` (root), `forge.config.ts`, or any production configuration.

#### Scenario: Diff scope check
- **WHEN** the change is applied as a single commit
- **THEN** every changed path matches one of: `qa/remote/**`, `qa/Makefile`, `qa/README.md`, `.gitignore`, `openspec/changes/automate-windows-remote-qa/**`
