## Why

Verifying clean-state install + runtime on real Windows hardware is currently a manual, error-prone loop: stop processes, hunt down `%USERPROFILE%\.pi*` and AppData paths, copy a build over, click through. The existing `qa/` harness only targets ephemeral Packer VMs reached over SSH; bare-metal LAN boxes have no automation. Releases now ship three Windows surfaces (ZIP, portable.exe, npm-global CLI), each with its own state-cleanup nuances, so manual QA scales poorly and regressions slip through.

## What Changes

- Add `qa/remote/` harness driving a real Windows host over **OpenSSH** — same transport `qa/scripts/vm-wait-ssh.sh` already speaks, no new tooling on the orchestrator side.
- New PowerShell scripts (idempotent, side-effect-safe — safe to re-run):
  - `remote-clean.ps1` — stop `PI Dashboard.exe`, `pi-dashboard`, stray `node.exe`; wait for handle release; free TCP ports 8000/9999; delete `%USERPROFILE%\.pi`, `%USERPROFILE%\.pi-dashboard`, `%APPDATA%\pi-agent-dashboard`, `%LOCALAPPDATA%\pi-agent-dashboard`; wipe `%LOCALAPPDATA%\Temp\*pi-dashboard*` portable-extract residue; clear PID files.
  - `remote-deploy-zip.ps1` — receive ZIP via scp, `Expand-Archive` into a fresh `C:\Temp\pi-dashboard-test\`, launch `PI Dashboard.exe`.
  - `remote-deploy-portable.ps1` — receive `PI-Dashboard-portable.exe` via scp, launch directly (7-Zip SFX self-extracts under `%LOCALAPPDATA%\Temp\`).
  - `remote-deploy-npm.ps1` — `npm i -g @blackbelt-technology/pi-dashboard@<ver>`, then `pi-dashboard start`.
  - `remote-run-tests.ps1` — invokes existing `qa/tests/run-all.ps1` against the prepared install, streams logs back to the orchestrator.
- New driver shell script `qa/remote/run.sh` orchestrating: `clean → deploy(mode) → run-tests → collect-logs → clean`.
- New `qa/remote/config.example.json` documenting required fields: `{ host, user, sshKey, mode: "zip" | "portable" | "npm", artifactPath?, npmVersion? }`. Real `config.json` is gitignored.
- New `Makefile` targets in `qa/Makefile`: `test-windows-remote-zip`, `test-windows-remote-portable`, `test-windows-remote-npm`, `clean-windows-remote`.
- Docs: extend `qa/README.md` with a "Remote Windows host" section covering one-time OpenSSH + firewall enablement, SSH default-shell registry tweak, config layout, and troubleshooting.

**Non-goals** (explicit, future work): GUI/visual Electron tests requiring an interactive desktop session (would need scheduled-task indirection from session 0); WinRM transport; macOS/Linux remote-host variants; CI integration of the remote harness.

## Capabilities

### New Capabilities

- `windows-remote-qa`: clean-state install + runtime verification against a remote Windows host over SSH, parameterized by artifact mode (ZIP | portable.exe | npm-global), reusing the existing `qa/tests/*.ps1` suite. Covers process termination, state cleanup, artifact deployment, test execution, and log collection.

### Modified Capabilities

*(none — purely additive harness; production code untouched)*

## Impact

- **Code**: new files under `qa/remote/`; touch only `qa/Makefile` and `qa/README.md`.
- **Production runtime**: zero changes — opt-in test infrastructure isolated from shipping code paths.
- **External deps**: requires OpenSSH server enabled on the target Windows host (one-time, documented). No new package deps in the repo. Orchestrator side uses only POSIX `ssh`/`scp` already required by `qa/scripts/`.
- **Secrets / config**: `qa/remote/config.json` gitignored; `.example` documents structure. SSH private key never copied to target.
- **CI**: no change initially. Self-hosted Windows runner could call the same harness later — out of scope for this change.
- **Migration / rollback**: trivial — delete `qa/remote/`. No production state, schemas, or APIs touched. Rollback is `git rm -r qa/remote/` plus reverting the `Makefile` / `README` edits.
