## Why

Verifying a clean install and runtime on real Windows hardware is a manual, error-prone loop today. The steps are: stop processes, hunt down state dirs, copy a build over, click through. `qa/` automates only ephemeral Packer VMs. Bare-metal or long-lived Windows hosts get no automation. The local VMware Windows image is also unusable (vTPM-locked).

Windows now ships three surfaces, and each one leaves different state behind:
- `PI-Dashboard-win32-<arch>.zip`
- the per-user NSIS `PI-Dashboard-Setup-<v>-<arch>.exe`
- the npm-global `@blackbelt-technology/pi-agent-dashboard`

Two downstream changes already depend on this harness:
- `restore-windows-nsis-installer` left the placeholder target `make test-windows-remote-nsis SETUP=…` pointing here.
- Its NSIS **launch** validation (task 10.7) is blocked on this harness.

The 2026-10-25 spikes (design.md → "Spike results") ran stock `sshd` against v0.10.0 artifacts on `windows-latest`. They showed that the original plan would not have worked:
- the portable target is gone;
- the npm name 404s;
- the exe and AppData names were wrong;
- processes started over ssh die when the call returns;
- a `DefaultShell=PowerShell` setting (which the repo's own Packer image applies) breaks exit codes unless every call compensates;
- 5 `qa/tests/*.ps1` files do not parse under Windows PowerShell 5.1;
- PS 5.1 `localhost` health probes always time out.

## What Changes

- **New `qa/remote/` harness** that drives one Windows host over stock OpenSSH (public-key auth; works with either OpenSSH `DefaultShell` and never edits it):
  - `run.sh` is the POSIX driver, compatible with stock macOS (bash 3.2, `node -e` for config, no `jq`). It loads and validates config, then runs:
    1. **preflight** — scp's `remote-preflight.ps1` into the remote home dir and picks the exit-code-preserving invocation form. The plain `-File` form works under stock `cmd`; the `; exit $LASTEXITCODE` form works under `DefaultShell=powershell.exe`, which the repo's own Packer image sets. Also checks disk space;
    2. **stage** — `remote-preflight.ps1 -Stage` takes a per-host run lock and recreates `C:\pi-dashboard-qa\{harness,tests,art,logs}`, then the driver scp's the files;
    3. **pre-clean**;
    4. **cycle** — one ssh session;
    5. **collect logs**;
    6. **post-clean**.

    Steps 5 and 6 always run, from a `trap`.
  - `remote-cycle.ps1 -Mode zip|nsis|npm` runs deploy → health gate → suite → log capture **inside a single ssh session**. Reason: sshd puts the session in a Job Object with `KILL_ON_JOB_CLOSE`, so a server started in one ssh call is dead in the next. Its exit code is the verdict.
  - `remote-clean.ps1` brings the host back to a state where pi-dashboard never ran. It works from the **measured** footprint (spike F4). It stops processes, frees ports, runs the NSIS uninstaller silently, runs `npm rm -g`, then deletes the state dirs, shortcuts and HKCU keys. It is idempotent: exit 0 when clean, exit 3 with a residue list. The starting point is the validated `spike/remote-clean.draft.ps1`.
  - `remote-preflight.ps1`, `config.example.json`, `AGENTS.md`.
- **Modes:**
  - `zip` — extract, launch `pi-dashboard.exe`, gate on `launchSource=electron`.
  - `nsis` — run the existing `windows-nsis-*.ps1` sequence.
  - `npm` — `npm i -g @blackbelt-technology/pi-agent-dashboard@<pin>`, gate on `launchSource=standalone`.
- **`--smoke-only`** runs deploy plus the health gate without the suite. This gives a truthful per-artifact verdict while the reused suite is red (see below).
- **`--motw`** (opt-in) stamps a Mark-of-the-Web `Zone.Identifier` (`ZoneId=3`) on the staged artifact. scp'd files otherwise carry none, so download-time SmartScreen behaviour — the field failure that sank portable.exe — would never be exercised.
- **Collected logs are redacted.** Electron stdout prints one-time `/auth/local-proof?code=…` URLs.
- **`qa/Makefile`:** add `test-windows-remote-{zip,npm}` and `clean-windows-remote`, and **wire** the existing `test-windows-remote-nsis SETUP=…` placeholder to the driver.
- **Harness-blocking `qa/tests` fixes:**
  - all 27 `qa/tests/*.ps1` → UTF-8 **with BOM** (removes the PS 5.1 parse failures);
  - `01-install.ps1` → the real package name, pinnable through `QA_NPM_SPEC`;
  - every `Invoke-WebRequest`/`Invoke-RestMethod` health/HTTP **request URI** → `127.0.0.1`. `Origin` headers are left as they are. This removes the ~2 s IPv6 penalty that made `windows-nsis-launch.ps1` false-FAIL against a healthy server.
- **Guard test** `packages/shared/src/__tests__/qa-windows-ps1-compat.test.ts` asserts:
  - every `qa/tests/*.ps1` and `qa/remote/*.ps1` file starts with a UTF-8 BOM;
  - no PowerShell web cmdlet targets `http://localhost`.
- **Docs:** add a "Remote Windows host" section to `qa/README.md` covering one-time sshd and key setup, the config, and troubleshooting. Update the `qa/AGENTS.md` rows.

**Out of scope, tracked in follow-up change `repair-windows-qa-suite`.** The reused suite's semantic rot, measured at 3 pass / 12 fail over the harness:
- `02` calls `Start-Process` on the npm `.ps1` shim;
- `03`/`04`/`05`/`10`/`22`/`32`/`38` assume a server that nothing starts;
- `07` asserts the removed `resources\offline-packages\manifest.json` **and** the removed `/api/health.starter` field, and hard-codes the x64 zip name (no arm64);
- `12` prints SKIP but exits 0;
- `12-keeper-log-rotation`, `17-bridge-contention` and `45-windows-reclaim-refused` are never run (not in `run-all.ps1`);
- `qa/scripts/run-test.sh` uploads to the POSIX path `/tmp/qa-tests` on Windows VMs;
- PS 5.1 `Expand-Archive` takes ~12 min.

**Follow-up spike (task 7.2a):** inline NSIS *launch* smoke on the CI build runner. `restore-windows-nsis-installer` dropped it as impossible, but this change's evidence (Electron serves `/api/health` in session 0; the old probe false-FAILs on `localhost`) suggests otherwise.

**Non-goals:** interactive-desktop GUI tests (the spike showed Electron serves `/api/health` fine in session 0, so none are needed for server-level smoke); WinRM; driving several hosts in parallel; macOS/Linux remote hosts; CI integration; signing or AV automation.

## Capabilities

### New Capabilities

- `windows-remote-qa`: clean-state install and runtime verification of a remote Windows host over SSH for the `zip`, `nsis` and `npm` artifact modes:
  - preflight;
  - single-session cycle;
  - log round-trip;
  - idempotent footprint-complete cleanup;
  - Makefile entry points;
  - PS 5.1 load-compatibility of the Windows QA scripts it executes.

### Modified Capabilities

*(none — test infrastructure only)*

## Impact

- **Code:**
  - new `qa/remote/**`;
  - edits to `qa/Makefile`, `qa/README.md`, `qa/AGENTS.md`, `.gitignore`;
  - encoding + `127.0.0.1` + package-name edits in `qa/tests/*.ps1`;
  - two new vitest files in `packages/shared/src/__tests__/` (`qa-windows-ps1-compat`, `qa-remote-run-config`).

  No production source, build or CI workflow changes.
- **Target host:** destructive by design. `remote-clean.ps1` deletes `%USERPROFILE%\.pi` (including pi credentials) and kills every `node.exe`. The host **must be QA-dedicated**; the README states this in bold.
- **Security:**
  - the ssh private key stays on the orchestrator;
  - host keys are TOFU (`StrictHostKeyChecking=accept-new`), not `no`;
  - config values that reach a remote command line (`mode`, `npmVersion`, artifact basename) are validated against allowlists or regexes before any ssh call.
- **CI:** no workflow file changes. But CI runs some of the edited scripts under pwsh 7: `windows-nsis-*` in `_electron-build.yml`, and `28-gateway-windows.ps1` in the path-filtered `ci-gateway-platform.yml`, which this change triggers. BOM and `127.0.0.1` are neutral for pwsh 7; both workflows are verified green (task 6.10).
- **Compatibility:**
  - `qa/scripts/run-test.sh` (Packer VM flow) also benefits from the BOM and `127.0.0.1` fixes;
  - the harness works against both stock hosts and repo Packer images (either `DefaultShell`);
  - BOM-prefixed `.ps1` files are read correctly by PowerShell 5.1 and 7, and by `pwsh` on Linux/macOS.
- **Rollback:** `git rm -r qa/remote/`, plus reverting the Makefile/README/AGENTS/.gitignore edits and the guard test. The `qa/tests` encoding and URI edits are behaviour-neutral on POSIX and safe to keep.

## Discipline Skills

- `security-hardening` — config values interpolated into remote command lines (injection), SSH key handling, host-key policy, redaction of one-time auth codes in collected logs.
- `doubt-driven-review` — `remote-clean.ps1` is irreversible on the target (it deletes user state and kills `node.exe`). Review its path list and kill scope before it stands.
- `observability-instrumentation` — a new job surface: every cycle must leave a transcript, `summary.json` and server/Electron logs on the orchestrator, even on failure.
- `review-code` — before commit.
