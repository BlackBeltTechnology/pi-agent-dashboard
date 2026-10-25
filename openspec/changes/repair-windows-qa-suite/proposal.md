## Why

The Windows QA suite (`qa/tests/run-all.ps1`) is red on real Windows, and nothing exercised it until `automate-windows-remote-qa`.

The 2026-10-25 spike ran the suite over stock sshd on `windows-latest` (runs `40184762256` and `40186714826`) against the v0.10.0 release artifacts. The scripts were BOM-fixed and `01` was given the correct npm name. Result: **3 pass / 12 fail / 1 precondition-skip** in 23 min. The evidence is in `automate-windows-remote-qa/design.md` → "Spike results" F12.

`automate-windows-remote-qa` fixes only what blocks the harness itself: PS 5.1 encoding, `localhost` probes, and the npm package name. The semantic rot below is this change's scope. Its acceptance gate is `make -C qa test-windows-remote-zip` going green.

## What Changes

- **`02-server-start.ps1`:** `Start-Process -FilePath "pi-dashboard"` resolves the npm `.ps1` shim → "not a valid Win32 application". Start through `pi-dashboard.cmd` or `node <bin>` instead.
- **Server-precondition chain:** `03`, `04`, `05`, `10`, `22`, `32` and `38` expect a server that is already running ("Server not running"), but `02` stops its server in `finally` and nothing restarts one. Give each script, or `run-all.ps1`, an explicit start/stop fixture.
- **`07-electron-bootstrap-v2.ps1`:**
  - asserts `resources\offline-packages\manifest.json`, which v0.10.0 no longer ships (removed by an earlier change — trace which one);
  - asserts `$Health.starter -eq "Electron"`, but `/api/health` no longer has `starter` (`dashboard-starter-identity`: "Legacy starter field is absent"; spike saw `starter=null`) → assert `launchSource -eq "electron"`;
  - makes managed-dir layout claims (`~/.pi-dashboard/.version`, `node_modules/...`) that may be stale since `eliminate-electron-runtime-install` → re-derive them from the current bundle layout;
  - hard-codes `PI-Dashboard-win32-x64.zip` → accept `win32-<arch>` so arm64 hosts work;
  - replace PS 5.1 `Expand-Archive` (≈12 min for 388 MB) with `ZipFile.ExtractToDirectory`.
- **Never-run Windows tests:** `12-keeper-log-rotation.ps1`, `17-bridge-contention.ps1` and `45-windows-reclaim-refused.ps1` are referenced by neither `run-all.ps1`, the Makefile, nor any workflow. Triage each: add it to `run-all.ps1`, or delete it if it is obsolete.
- **`qa/scripts/run-test.sh` (Packer VM flow):** uploads the suite to the POSIX path `/tmp/qa-tests` and runs `-File /tmp/qa-tests/run-all.ps1` on Windows VMs (unverified there), and uses `StrictHostKeyChecking=no`. Align it with the `qa/remote` staging (`C:\pi-dashboard-qa`) and its `accept-new` host-key policy, or retire its Windows branch in favour of `qa/remote`.
- **`12-openspec-shim.ps1`:** prints `SKIP:` but exits 0, so `run-all.ps1` counts it as PASS. Use exit 77 (precondition skip).
- **`44-photocraft.ps1`:** fails with `usage: pi-photocraft <command> [args]` — wrong CLI invocation for the current plugin.
- **`35-plugin-install-load.ps1`:** failed in the spike. Root cause not yet triaged (npm deprecation noise masked it).

## Capabilities

### Modified Capabilities

- To be determined during planning: the cross-platform QA coverage capability (likely `electron-qa-coverage` and/or `test-execution`) gains "Windows suite green over the remote harness".

## Impact

- **Code:** `qa/tests/*.ps1` and `qa/tests/run-all.ps1` only. No production code.
- **Depends on:** `automate-windows-remote-qa`, which provides the harness, PS 5.1 load-compat and `127.0.0.1` probes.
- **Rollback:** revert the `qa/tests` edits.

## Discipline Skills

- `systematic-debugging` — every failing script needs a root cause before it is edited (several failures cascade from one missing server fixture).
- `review-code` — before commit.
