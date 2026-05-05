## 1. Scaffolding

- [ ] 1.1 Create `qa/remote/` directory
- [ ] 1.2 Add `qa/remote/config.json` and `qa/remote/logs/` to `.gitignore`
- [ ] 1.3 Write `qa/remote/config.example.json` with all schema fields and inline comments documenting each

## 2. PowerShell remote scripts

- [ ] 2.1 Write `qa/remote/remote-clean.ps1` — process kill (PI Dashboard, pi-dashboard, node, electron), 2 s wait, port-8000/9999 stragglers, AppData/state dir removal, `%LOCALAPPDATA%\Temp\*pi-dashboard*` glob, PID/log cleanup; idempotent; `-ErrorAction SilentlyContinue` on every removal
- [ ] 2.2 Write `qa/remote/remote-deploy-zip.ps1` — accept ZIP path arg, `Expand-Archive` to `C:\Temp\pi-dashboard-test\`, launch `PI Dashboard.exe`, poll `http://localhost:8000/api/health` with 60 s timeout
- [ ] 2.3 Write `qa/remote/remote-deploy-portable.ps1` — accept exe path arg, launch directly, poll health endpoint with 60 s timeout, surface AV-quarantine hint on launch-within-5 s failure
- [ ] 2.4 Write `qa/remote/remote-deploy-npm.ps1` — accept version arg (default `latest`), `npm i -g @blackbelt-technology/pi-dashboard@<version>`, `pi-dashboard start`, poll health endpoint with 60 s timeout
- [ ] 2.5 Write `qa/remote/remote-run-tests.ps1` — invoke `C:\Temp\pi-dashboard-qa\tests\run-all.ps1`, capture stdout/stderr to `C:\Temp\pi-dashboard-qa\logs\`, propagate exit code

## 3. Driver script

- [ ] 3.1 Write `qa/remote/run.sh` skeleton — bash strict mode, parse `--mode` override, load `qa/remote/config.json` via `jq`, validate required fields fail-fast
- [ ] 3.2 Implement clean phase — `ssh <host> powershell -F C:/Temp/pi-dashboard-qa/remote-clean.ps1` (after first scp'ing the script)
- [ ] 3.3 Implement deploy phase — scp artifact + matching deploy script, `ssh` invoke, propagate failure
- [ ] 3.4 Implement test phase — scp `qa/tests/` to target, invoke `remote-run-tests.ps1`
- [ ] 3.5 Implement log-collection phase — scp `C:\Temp\pi-dashboard-qa\logs\` back to `qa/remote/logs/<host>-<ISO8601-timestamp>/`; runs in `trap` so failure paths still collect
- [ ] 3.6 Implement post-clean phase — re-invoke `remote-clean.ps1`; runs in `trap`; never overrides the test phase's exit code
- [ ] 3.7 `chmod +x qa/remote/run.sh`

## 4. Makefile targets

- [ ] 4.1 Add `test-windows-remote-zip` target wrapping `qa/remote/run.sh --mode zip`
- [ ] 4.2 Add `test-windows-remote-portable` target wrapping `qa/remote/run.sh --mode portable`
- [ ] 4.3 Add `test-windows-remote-npm` target wrapping `qa/remote/run.sh --mode npm`
- [ ] 4.4 Add `clean-windows-remote` target wrapping `qa/remote/run.sh --clean-only`
- [ ] 4.5 Verify `make -C qa test-windows-remote-portable` passes through driver exit code

## 5. Documentation

- [ ] 5.1 Add "Remote Windows host" top-level section to `qa/README.md`
- [ ] 5.2 Document one-time target setup: `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0`, `Start-Service sshd`, `Set-Service sshd -StartupType Automatic`, firewall rule for TCP 22
- [ ] 5.3 Document `authorized_keys` placement: per-user `C:\Users\<u>\.ssh\authorized_keys` AND `C:\ProgramData\ssh\administrators_authorized_keys` for admin accounts
- [ ] 5.4 Document `DefaultShell` registry tweak to PowerShell with the exact `New-ItemProperty` command
- [ ] 5.5 Document `qa/remote/config.json` schema with one full example per mode (zip, portable, npm)
- [ ] 5.6 Document Defender exclusion path for the portable.exe extract dir
- [ ] 5.7 Document the known-constraint that `Stop-Process -Name node` may kill unrelated `node.exe` processes; QA host should be QA-dedicated
- [ ] 5.8 Document log retrieval path (`qa/remote/logs/<host>-<timestamp>/`) and how to disable post-clean for debugging (manual run.sh invocation note)

## 6. Verification

- [ ] 6.1 Run `make -C qa test-windows-remote-portable` end-to-end against a real Windows host on the LAN; confirm clean → deploy → test → logs → post-clean cycle and zero leftover state
- [ ] 6.2 Re-run immediately a second time; confirm idempotency (no errors from missing files/processes/ports)
- [ ] 6.3 Run `make -C qa test-windows-remote-zip` against the same host; confirm artifact-mode parity
- [ ] 6.4 Run `make -C qa test-windows-remote-npm`; confirm npm-global path produces a healthy server and tests pass
- [ ] 6.5 Force a failing test (e.g. block port 8000 before deploy); confirm exit code propagates, logs are still collected, post-clean still runs
- [ ] 6.6 Diff-scope check: `git diff --name-only` shows only paths under `qa/remote/`, `qa/Makefile`, `qa/README.md`, `.gitignore`, `openspec/changes/automate-windows-remote-qa/`
- [ ] 6.7 `openspec validate automate-windows-remote-qa --strict` passes
