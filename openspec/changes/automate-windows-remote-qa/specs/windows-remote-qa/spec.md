## ADDED Requirements

### Requirement: Remote QA harness location and structure

The system SHALL provide a remote-Windows QA harness under `qa/remote/` consisting of a POSIX driver `run.sh` and the PowerShell scripts `remote-preflight.ps1`, `remote-cycle.ps1` and `remote-clean.ps1`, plus `config.example.json` and `AGENTS.md`. `qa/remote/config.json`, `qa/remote/logs/` and `qa/remote/.known_hosts` SHALL be gitignored. The change SHALL NOT modify production source, build configuration or CI workflows.

#### Scenario: Harness layout exists after the change is applied
- **WHEN** the change is applied to a clean checkout
- **THEN** `qa/remote/run.sh` exists and is executable
- **AND** `qa/remote/remote-preflight.ps1`, `qa/remote/remote-cycle.ps1`, `qa/remote/remote-clean.ps1`, `qa/remote/config.example.json` and `qa/remote/AGENTS.md` exist
- **AND** `.gitignore` lists `qa/remote/config.json`, `qa/remote/logs/` and `qa/remote/.known_hosts`

#### Scenario: Diff scope
- **WHEN** the change is applied as a commit set
- **THEN** every changed path matches one of `qa/remote/**`, `qa/tests/*.ps1`, `qa/Makefile`, `qa/README.md`, `qa/AGENTS.md`, `.gitignore`, `packages/shared/src/__tests__/qa-windows-ps1-compat.test.ts`, `packages/shared/src/__tests__/qa-remote-run-config.test.ts`, `openspec/changes/automate-windows-remote-qa/**`

### Requirement: SSH transport, script files only

The harness SHALL drive the target exclusively via OpenSSH `ssh`/`scp` with public-key authentication, `BatchMode=yes`, `StrictHostKeyChecking=accept-new` and a repo-local `UserKnownHostsFile`. It SHALL NOT require WinRM, PSRemoting, SMB, a password prompt, or any particular OpenSSH `DefaultShell`. Every remote step SHALL run a script file via `powershell -NoProfile -ExecutionPolicy Bypass -File <script> <args>`, in the invocation form preflight selected; no inline remote commands.

#### Scenario: Key and options on every call
- **WHEN** the driver performs any `ssh` or `scp` call
- **THEN** it passes the configured `sshKey` via `-i`, the configured `sshPort` via `-p`/`-P`, and `-o BatchMode=yes -o StrictHostKeyChecking=accept-new`

#### Scenario: Restricted execution policy on the target
- **WHEN** the target's Windows PowerShell `LocalMachine` execution policy is `Restricted` (the Windows 10/11 client default)
- **THEN** every harness phase still runs, because each remote script is launched with `-ExecutionPolicy Bypass -File`

### Requirement: Orchestrator needs only stock tooling

On the orchestrator, `run.sh` SHALL need only bash 3.2 or newer, `ssh`, `scp` and `node`. It SHALL NOT require `jq` or other extra tools.

#### Scenario: Stock macOS orchestrator
- **WHEN** the driver runs under macOS `/bin/bash` 3.2 with no `jq` on `PATH`
- **THEN** config parsing and validation work (config is read with `node -e`)

### Requirement: Preflight selects an exit-code-preserving invocation form

Before staging or cleaning, the driver SHALL copy `remote-preflight.ps1` into the remote user's home directory and run it. The script exits with the sentinel code 7. The driver SHALL first try the plain `-File` form. If it observes 1, it SHALL retry with the PowerShell-shell form (`…-File <script> <args>; exit $LASTEXITCODE`). It SHALL use whichever form returned 7 for every later remote call, and abort when neither does. Preflight SHALL abort when free space on `C:` is under 3 GB.

#### Scenario: Stock cmd DefaultShell
- **WHEN** the target uses its stock `cmd` default shell
- **THEN** the plain form returns 7 and is used for the run

#### Scenario: PowerShell DefaultShell (repo Packer image)
- **WHEN** the target's OpenSSH `DefaultShell` is `powershell.exe`, as `qa/packer/scripts/provision-windows.ps1` sets it
- **THEN** the plain form returns 1, the suffixed form returns 7, and the suffixed form is used for the run
- **AND** a later script exiting with code 21 is observed by the driver as 21

#### Scenario: Neither form relays
- **WHEN** neither form returns 7
- **THEN** the driver exits non-zero before any staging or clean step, printing both observed codes and naming `HKLM:\SOFTWARE\OpenSSH\DefaultShell`

#### Scenario: Low disk
- **WHEN** `C:` has less than 3 GB free
- **THEN** preflight fails and nothing is staged or cleaned

### Requirement: Configuration is validated before any remote call

The driver SHALL read `qa/remote/config.json`, apply CLI overrides (`--mode`, `--artifact`, `--npm-version`), and validate the result before invoking `ssh` or `scp`. Every value that reaches a remote command line SHALL be checked against an allowlist or a regex.

#### Scenario: Missing field
- **WHEN** `config.json` is missing or lacks `host`, `user`, `sshKey` or `mode`
- **THEN** the driver exits non-zero naming the missing field
- **AND** no `ssh` or `scp` is invoked

#### Scenario: Unknown or retired mode
- **WHEN** `mode` is `portable` or any value other than `zip`, `nsis`, `npm`
- **THEN** the driver exits non-zero listing the three valid modes, without contacting the host

#### Scenario: Artifact required for file-based modes
- **WHEN** `mode` is `zip` or `nsis` and `artifactPath` is absent or does not exist locally
- **THEN** the driver exits non-zero without contacting the host

#### Scenario: npmVersion defaults and format
- **WHEN** `mode = "npm"` and `npmVersion` is absent
- **THEN** `latest` is used
- **AND** any provided value must match `^(latest|next|[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.]+)?)$`

#### Scenario: Injection-shaped value rejected
- **WHEN** `npmVersion` is `1.0.0; Remove-Item C:\ -Recurse`, or the artifact basename contains a space, quote or `;`
- **THEN** the driver exits non-zero before any `ssh` or `scp`

### Requirement: Fresh staging tree per run

The driver SHALL recreate `C:\pi-dashboard-qa\harness`, `tests`, `art` and `logs` on the target by running `remote-preflight.ps1 -Stage`, which takes no config-derived arguments. It SHALL do this before uploading `qa/remote/*.ps1` to `harness\`, `qa/tests/` to `tests\` and the artifact to `art\<basename>`.

#### Scenario: Re-run does not nest uploaded trees
- **WHEN** the harness runs twice in a row against the same host
- **THEN** after the second staging, `C:\pi-dashboard-qa\tests\run-all.ps1` exists
- **AND** `C:\pi-dashboard-qa\tests\tests` does not exist

### Requirement: Single-session cycle per artifact mode

The driver SHALL run deploy, health gate, suite and log capture in exactly one ssh invocation of `remote-cycle.ps1`, because processes started in an OpenSSH session on Windows are killed when that session ends. The health gate SHALL poll `http://127.0.0.1:<port>/api/health` for at most `healthTimeoutSec` seconds (config, default 180).

#### Scenario: ZIP mode
- **WHEN** `mode = "zip"` with an artifact `PI-Dashboard-win32-<arch>.zip`
- **THEN** `remote-cycle.ps1` extracts it under `C:\pi-dashboard-qa\app\` and launches the contained `pi-dashboard.exe`
- **AND** the health gate passes only when `/api/health` reports `launchSource = "electron"`
- **AND** unless `--smoke-only`, the zip is staged at `C:\qa-artifacts\PI-Dashboard-win32-x64.zip`, the deployed app is stopped, and `tests\run-all.ps1` runs

#### Scenario: NSIS mode
- **WHEN** `mode = "nsis"` with an artifact `PI-Dashboard-Setup-<v>-<arch>.exe`
- **THEN** `remote-cycle.ps1` runs `windows-nsis-install.ps1 -Setup`, `windows-nsis-no-permachine.ps1`, `windows-nsis-branding.ps1 -Setup`, `windows-nsis-launch.ps1` and `windows-nsis-uninstall.ps1`, in that order
- **AND** stops at the first non-zero script and exits with that script's code

#### Scenario: npm mode
- **WHEN** `mode = "npm"` with `npmVersion = V`
- **THEN** `remote-cycle.ps1` runs `npm i -g @blackbelt-technology/pi-agent-dashboard@V` and `pi-dashboard start`
- **AND** the health gate passes only when `launchSource = "standalone"` and, if `V` is a semver, `version = V`
- **AND** unless `--smoke-only`, it stops the server and runs `tests\run-all.ps1` with `QA_NPM_SPEC=@blackbelt-technology/pi-agent-dashboard@V`

#### Scenario: Exit codes
- **WHEN** `remote-cycle.ps1` finishes
- **THEN** it exits `0` on pass, `20` when deploy failed, `21` when the health gate timed out, `22` on bad arguments, and otherwise with the suite's exit code

#### Scenario: Smoke-only
- **WHEN** the driver is given `--smoke-only`
- **THEN** `remote-cycle.ps1` runs deploy and the health gate, skips the suite, and still writes logs and `summary.json`

#### Scenario: Server started in an earlier ssh call is not relied on
- **WHEN** any verdict-producing phase runs
- **THEN** no phase depends on a process launched by a previous ssh invocation

### Requirement: Logs and summary round-trip on every outcome

`remote-cycle.ps1` SHALL write into `C:\pi-dashboard-qa\logs\`: a PowerShell transcript, copies of `%USERPROFILE%\.pi\dashboard\server.log` and `%TEMP%\pi-dashboard-electron.log` when present, and a `summary.json` containing `mode`, `artifact`, `version`, `launchSource`, `healthSec`, `suiteRc`, `exitCode`, `startedAt` and `finishedAt`. The driver SHALL copy `logs\` to `qa/remote/logs/<host>-<UTC timestamp>/` from an exit trap, before post-clean, and print the local path.

#### Scenario: Logs on failure
- **WHEN** the cycle exits non-zero (deploy, health gate or suite)
- **THEN** `qa/remote/logs/<host>-<timestamp>/summary.json` exists locally with the same `exitCode`
- **AND** the driver prints that directory before exiting

#### Scenario: One-time secrets are redacted
- **WHEN** the Electron stdout log contains `http://localhost:8000/auth/local-proof?code=AbC123`
- **THEN** the collected copy contains `local-proof?code=<redacted>` and not `AbC123`

#### Scenario: Unreachable host during collection
- **WHEN** the host becomes unreachable after the cycle started
- **THEN** the driver warns that collection failed and still exits with the cycle's code (or 255 when the cycle produced none)

### Requirement: Idempotent, footprint-complete remote cleanup

`remote-clean.ps1` SHALL return the target to a state with no pi-dashboard installation, process, listener or user state, regardless of prior state. It SHALL exit 0 when clean and 3 when residue remains, printing each residue item. It SHALL NOT delete `C:\pi-dashboard-qa\logs`.

#### Scenario: Clean from a running NSIS install
- **WHEN** an NSIS per-user install is present and its app is running with ports 8000 and 9999 listening
- **AND** `remote-clean.ps1` runs
- **THEN** the app is stopped and the installer's own uninstaller runs silently
- **AND** afterwards none of these remain: `%LOCALAPPDATA%\Programs\PI Dashboard`, `%LOCALAPPDATA%\@blackbelt-technologypi-dashboard-electron-updater`, `%APPDATA%\pi-dashboard`, `%USERPROFILE%\.pi`, `%USERPROFILE%\.pi-dashboard`, the Start-Menu and Desktop `PI Dashboard.lnk`, an HKCU Uninstall entry whose `DisplayName` is `PI Dashboard`, `HKCU:\Software\BlackBelt Technology`, a listener on 8000/8112/9999
- **AND** the script exits 0

#### Scenario: Clean from an npm-global install
- **WHEN** `@blackbelt-technology/pi-agent-dashboard` is installed globally and its server is running
- **AND** `remote-clean.ps1` runs
- **THEN** the server is stopped, the package is absent from `npm root -g`, and the script exits 0

#### Scenario: Clean from an already-clean host
- **WHEN** nothing pi-dashboard related exists on the host
- **AND** `remote-clean.ps1` runs three times in a row
- **THEN** each run exits 0 and writes nothing to stderr

#### Scenario: Cleanup brackets every cycle
- **WHEN** `run.sh` executes a full cycle
- **THEN** `remote-clean.ps1` runs once after preflight and staging and before the cycle, and once from the exit trap after log collection, even when the cycle failed
- **AND** a passing cycle whose post-clean exits 3 makes the driver exit 3

### Requirement: Makefile entry points

`qa/Makefile` SHALL expose `test-windows-remote-zip`, `test-windows-remote-nsis`, `test-windows-remote-npm` and `clean-windows-remote`. Each SHALL invoke `qa/remote/run.sh` and propagate its exit code. `test-windows-remote-nsis` SHALL keep its `SETUP=` guard. No `test-windows-remote-portable` target SHALL exist.

#### Scenario: NSIS target wired to the harness
- **WHEN** the operator runs `make -C qa test-windows-remote-nsis SETUP=path/to/PI-Dashboard-Setup-0.10.0-x64.exe`
- **THEN** `qa/remote/run.sh --mode nsis --artifact <SETUP>` runs and make's exit code equals the driver's

#### Scenario: NSIS target without SETUP
- **WHEN** `SETUP` is not given
- **THEN** make prints usage and exits 2 without contacting any host

#### Scenario: Standalone clean
- **WHEN** the operator runs `make -C qa clean-windows-remote`
- **THEN** only preflight, staging and `remote-clean.ps1` run

### Requirement: Windows QA scripts load under Windows PowerShell 5.1

Every `qa/tests/*.ps1` and `qa/remote/*.ps1` file SHALL be UTF-8 with a byte-order mark. PowerShell web cmdlets (`Invoke-WebRequest`, `Invoke-RestMethod`) in those files SHALL NOT target `http://localhost`; they SHALL use `127.0.0.1`. `qa/tests/01-install.ps1` SHALL install `$env:QA_NPM_SPEC`, defaulting to `@blackbelt-technology/pi-agent-dashboard`. A vitest guard SHALL enforce all three on POSIX CI.

#### Scenario: Non-ASCII script without BOM is rejected
- **WHEN** a `qa/tests/*.ps1` file is committed without a UTF-8 BOM
- **THEN** `packages/shared/src/__tests__/qa-windows-ps1-compat.test.ts` fails and names the file

#### Scenario: localhost health probe is rejected
- **WHEN** a `qa/tests/*.ps1` file contains `Invoke-WebRequest -Uri "http://localhost:8000/api/health"`
- **THEN** the guard test fails and names the file and line
- **AND** an `Origin: http://localhost:8000` header value does not trigger the guard

#### Scenario: Wrong npm package name is rejected
- **WHEN** `qa/tests/01-install.ps1` installs `@blackbelt-technology/pi-dashboard` (no `-agent`)
- **THEN** the guard test fails

### Requirement: README documents setup and destructive scope

`qa/README.md` SHALL include a "Remote Windows host" section that lets an operator set up a target, configure and run the harness, and troubleshoot it. The section SHALL warn that the target must be QA-dedicated.

#### Scenario: Setup content
- **WHEN** an operator reads the section
- **THEN** it covers OpenSSH Server enablement, sshd start, the firewall rule, admin key placement in `C:\ProgramData\ssh\administrators_authorized_keys` with an Administrators+SYSTEM-only ACL (per-user `authorized_keys` for non-admins), and leaving `DefaultShell` unset

#### Scenario: Usage and troubleshooting content
- **WHEN** an operator reads the section
- **THEN** it documents the config schema with one example per mode, the CLI flags, the log layout, and recovery from a preflight rc mismatch, a host-key change and residue exit 3

#### Scenario: Destructive scope is explicit
- **WHEN** an operator reads the section
- **THEN** a bold warning states that cleanup deletes `%USERPROFILE%\.pi` and kills every `node.exe`, so the host must be QA-dedicated

#### Scenario: Operator can set up a target from the README alone
- **WHEN** an operator follows the section on a fresh Windows 11 machine
- **THEN** `make -C qa clean-windows-remote` passes preflight without any step not written in the README

### Requirement: One run per target at a time

`remote-preflight.ps1 -Stage` SHALL refuse to stage while `C:\pi-dashboard-qa\.lock` exists and is younger than 2 hours. It SHALL then write the lock with the orchestrator's host name and a UTC timestamp. The driver SHALL remove the lock from its exit trap after post-clean. A lock older than 2 hours SHALL be treated as stale and replaced, with a warning.

#### Scenario: Concurrent run refused
- **WHEN** a second operator starts a run against a host whose lock is 10 minutes old
- **THEN** the second driver exits non-zero, naming the lock owner and age, without cleaning or deploying anything

#### Scenario: Stale lock replaced
- **WHEN** the lock is older than 2 hours
- **THEN** staging proceeds and prints a stale-lock warning

### Requirement: Optional Mark-of-the-Web emulation

With `--motw`, the harness SHALL write a `Zone.Identifier` alternate data stream (`ZoneId=3`) on the staged artifact before deploy, so Windows treats it like a browser download (SmartScreen and attachment-execution checks). Without `--motw`, the README SHALL state that scp'd artifacts carry no Mark-of-the-Web and therefore do not reproduce download-time SmartScreen behaviour.

#### Scenario: MOTW applied
- **WHEN** the driver runs with `--motw`
- **THEN** `Get-Content <artifact> -Stream Zone.Identifier` on the target returns a block containing `ZoneId=3` before deploy starts
- **AND** `summary.json` records `motw: true`
