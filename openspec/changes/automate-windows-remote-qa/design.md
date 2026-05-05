## Context

The repo already ships a Windows QA suite (`qa/tests/01-install.ps1`, `02-server-start.ps1`, `03-websocket.ps1`, `04-terminal.ps1`, `05-git-ops.ps1`, `07-electron-bootstrap-v2.ps1`, `run-all.ps1`). It is consumed today by `qa/scripts/run-test.sh`, which assumes a freshly-Packered VM reachable on a known SSH port and tears the VM down after the run.

Three things changed since that harness was written:

1. **NSIS installer was removed** (change: `simplify-electron-bootstrap-derived-state`) — Windows now ships as **ZIP + portable.exe**, plus the long-standing `npm i -g @blackbelt-technology/pi-dashboard` route.
2. Real Windows hardware on the team LAN is the most realistic regression surface (driver / AV / locale / non-pristine PATH) that a Packer Windows VM cannot reproduce.
3. State leaks across runs are common and silent — `~/.pi`, `~/.pi-dashboard`, `%APPDATA%\pi-agent-dashboard`, `%LOCALAPPDATA%\pi-agent-dashboard`, port-holders on 8000/9999, plus the portable.exe self-extract dirs under `%LOCALAPPDATA%\Temp\` — making "is this regression real or stale state?" the dominant manual-QA failure mode.

Stakeholders: release engineer cutting Windows builds; maintainers verifying issue reports against a known-clean target; future self-hosted-runner work that needs the same primitives.

## Goals / Non-Goals

**Goals:**
- One command on a Mac/Linux orchestrator runs a clean-install + smoke-test cycle against a real Windows host on the LAN, for any of the three artifact modes.
- Clean state guaranteed before and after each run — no leftover processes, ports, files, or PID locks.
- Reuse `qa/tests/*.ps1` verbatim. Add no new test assertions in this change.
- Idempotent scripts — a half-finished run leaves the box in a state where re-running succeeds.
- Zero impact on production code, build, or CI.

**Non-Goals:**
- GUI / visual Electron interaction (requires session-0 → interactive-session bridging via scheduled tasks; deferred).
- WinRM transport (SSH already covers the case; adds no value while we have one working transport).
- Driving multiple Windows hosts in parallel (single-host orchestration is enough for now).
- Linux / macOS remote variants (their state-cleanup story is different enough to deserve its own change).
- CI / self-hosted-runner integration (separate change once the harness stabilises).
- Signing, AV-exemption automation, or kiosk-mode hardening of the target host (operator-managed).

## Decisions

### D1. Transport: OpenSSH (built-in) over WinRM

**Decision:** SSH only. The orchestrator uses POSIX `ssh` + `scp` exactly like `qa/scripts/vm-wait-ssh.sh` does today.

**Rationale:**
- OpenSSH server has shipped with Windows 10/11 since 1809 — `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` is the only enablement step.
- Reuses existing `qa/scripts/` plumbing and dev-machine SSH config; no PowerShell remoting / cert pinning / TrustedHosts churn.
- Identical UX to the existing Packer-VM Linux/Windows runs — operators learn one mental model.

**Alternatives considered:**
- *WinRM / PSRemoting* — more native but requires HTTPS cert or HTTP+TrustedHosts setup; orchestrator side needs `pwsh` Linux build for `Invoke-Command`; doubles the surface area for marginal gain.
- *SMB share + scheduled task* — zero remote-exec setup but awkward log streaming and brittle scheduling.

### D2. Default SSH shell on the target = PowerShell, not cmd.exe

**Decision:** Documented one-time tweak in `qa/README.md`:
```
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell `
  -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
```

**Rationale:** Without this, every remote command runs in `cmd.exe` and `.ps1` invocation needs awkward `powershell -F …` wrapping for every line. Setting `DefaultShell` makes `ssh host script.ps1` work the way operators expect.

**Trade-off:** Documented requirement, not auto-applied — the orchestrator never modifies registry on first connect.

### D3. Three artifact modes, one driver

**Decision:** `qa/remote/run.sh --mode zip|portable|npm` selects the deploy script. Clean and test phases are mode-agnostic.

| Mode | Source artifact | Deploy step | Launch |
|---|---|---|---|
| `zip` | `out/make/zip/win32/x64/PI-Dashboard-win32-x64-<v>.zip` | scp → `Expand-Archive` to `C:\Temp\pi-dashboard-test\` | `& "C:\Temp\pi-dashboard-test\PI Dashboard.exe"` |
| `portable` | `out/make/portable/x64/PI-Dashboard-portable.exe` | scp only | direct exec; 7-Zip SFX self-extracts under `%LOCALAPPDATA%\Temp\` |
| `npm` | npm registry version pin | `npm i -g @blackbelt-technology/pi-dashboard@<ver>` | `pi-dashboard start` |

**Rationale:** All three are real shipping surfaces. Sharing clean + test phases keeps the harness small.

### D4. Cleanup ordering and waits

**Decision:** Strict ordering with explicit waits between phases:
1. `Stop-Process -Name "PI Dashboard","pi-dashboard","node","electron" -Force -ErrorAction SilentlyContinue`
2. `Start-Sleep 2` — let handles release.
3. `Get-NetTCPConnection -LocalPort 8000,9999 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }`
4. `Remove-Item -Recurse -Force` on the AppData / state dirs (one path at a time, each wrapped in `-ErrorAction SilentlyContinue`).
5. Glob-clean `%LOCALAPPDATA%\Temp\*pi-dashboard*` and `%LOCALAPPDATA%\Temp\*PI-Dashboard*`.
6. `Remove-Item` on `~/.pi-dashboard/server.pid` and `~/.pi-dashboard/server.log` (don't fail on absence).

**Rationale:** Process kill before file delete; port reclaim *after* process kill catches stragglers (tmux sub-processes, npm-launched node) that didn't match the name list. Glob-clean for the portable mode's per-run extract dirs prevents AV from accumulating quarantine entries.

### D5. Artifact transfer = scp into `C:\Temp\pi-dashboard-qa\`

**Decision:** Single staging dir under `C:\Temp\pi-dashboard-qa\`, recreated fresh per run. ZIP modes extract into a sibling `C:\Temp\pi-dashboard-test\`.

**Rationale:** Predictable paths simplify cleanup. `C:\Temp\` exists by default, no admin to write to it. Keeping staging and runtime dirs separate means `clean` can `Remove-Item` the runtime dir without losing the artifact mid-run if the operator wants to retry-test on the same upload.

### D6. Test-runner reuse, not rewrite

**Decision:** `remote-run-tests.ps1` is a thin wrapper around the existing `qa/tests/run-all.ps1`. The driver scp's `qa/tests/` to `C:\Temp\pi-dashboard-qa\tests\` and invokes it.

**Rationale:** Single source of truth for test assertions. The remote harness adds plumbing, not test logic.

### D7. Logs round-trip via scp

**Decision:** After test execution (pass or fail), `qa/remote/run.sh` scp's `C:\Temp\pi-dashboard-qa\logs\` back to `qa/remote/logs/<host>-<timestamp>/` on the orchestrator before the final clean-up. Exit code propagates.

**Rationale:** Operator-side post-mortem on failure must not depend on the target box still being reachable. Final-clean is best-effort and runs even on failure (so the next run starts clean).

### D8. Config: gitignored `qa/remote/config.json`, committed `.example` template

**Decision:**
```json
{
  "host": "win-box.lan",
  "user": "qa",
  "sshKey": "~/.ssh/id_ed25519",
  "mode": "portable",
  "artifactPath": "out/make/portable/x64/PI-Dashboard-portable.exe",
  "npmVersion": "latest"
}
```
Add `qa/remote/config.json` and `qa/remote/logs/` to `.gitignore`.

**Rationale:** No host-specific data committed; `.example` is the schema doc.

## Risks / Trade-offs

- **Risk: Antivirus quarantines the portable.exe extract on first run** → Mitigation: documented Defender-exclusion path in `qa/README.md`; harness fails fast with a clear "AV may have quarantined extract" hint when launch fails inside 5 s.
- **Risk: Stale `node.exe` from another tool (VS Code server, devcontainers) gets killed by `Stop-Process -Name node`** → Mitigation: documented as a known constraint; the target host is expected to be QA-dedicated. Future refinement: filter by parent-process or path. Not in scope here.
- **Risk: SSH session drops mid-test, leaving the server running** → Mitigation: `remote-clean.ps1` is idempotent and runs at start of every cycle, so the next invocation reclaims state. The driver also wraps the test phase in a server-side `try { … } finally { Stop-Process … }` so a clean drop still tears down the server.
- **Risk: Path encoding (backslash vs. forward-slash) bugs in scp/ssh** → Mitigation: all PowerShell scripts use `Join-Path` and `$env:USERPROFILE`-relative paths; never pass concatenated string paths through ssh.
- **Risk: Session-0 vs. interactive-session mismatch — server starts headless but no GUI Electron** → Accepted: covered by non-goals. Headless server smoke is sufficient signal; GUI deferred.
- **Trade-off: Adding three deploy modes vs. one** → Worth the extra ~80 LOC because all three are shipping surfaces, and skipping any of them just moves manual repro back to the operator.

## Migration Plan

- **Deploy:** purely additive. New files under `qa/remote/`, edits to `qa/Makefile` + `qa/README.md` + `.gitignore`. No version bump, no release coordination.
- **Adoption:** README documents the one-time SSH/firewall + DefaultShell setup. Operator copies `config.example.json` → `config.json`, fills host details, runs `make test-windows-remote-portable`.
- **Rollback:** `git rm -r qa/remote/` plus revert of `Makefile`/`README`/`.gitignore` edits. No production data, no schemas, no users affected.

## Open Questions

- **Q1:** Should the npm-mode scripts pin a specific Node version on the target, or trust whatever's on PATH? Decision: trust PATH, surface `node --version` in logs. The dashboard already has version-skew warnings; if Node is wrong, those will fire and the test will surface the failure.
- **Q2:** Should we add a `--keep-state` flag to skip the post-run clean for debugging? Useful but not strictly required for v1; defer unless an operator actually asks. Tracked here for visibility.
