## 1. Guard test first (PS 5.1 load-compat) — TDD

- [ ] 1.1 Write `packages/shared/src/__tests__/qa-windows-ps1-compat.test.ts`. It asserts:
  - (a) every `qa/tests/*.ps1` and `qa/remote/*.ps1` file starts with `EF BB BF`;
  - (b) no line matches `Invoke-(WebRequest|RestMethod)\b.*http://localhost` (`Origin:` header lines exempt);
  - (c) `qa/tests/01-install.ps1` does not contain `@blackbelt-technology/pi-dashboard` without `-agent`, and does reference `QA_NPM_SPEC`.

  Each failure names the file and line. Run it: it must FAIL today (spike F2/F7/F8).
- [ ] 1.2 Re-save all 27 `qa/tests/*.ps1` as UTF-8 with BOM. Content bytes otherwise unchanged; `git diff --stat` shows a 3-byte delta per file.
- [ ] 1.3 Replace `localhost` with `127.0.0.1` in every PowerShell web-cmdlet request URI in `qa/tests/*.ps1`. Leave `Origin` header values and Node `net.connect` snippets alone. Check each of the 14 files listed by `rg -l localhost qa/tests/*.ps1`.
- [ ] 1.4 `qa/tests/01-install.ps1`: install `$env:QA_NPM_SPEC`, defaulting to `@blackbelt-technology/pi-agent-dashboard`. Print the spec it installed.
- [ ] 1.5 The guard test passes. `npm test` stays green.

## 2. Remote scripts (Windows PowerShell 5.1, UTF-8 BOM)

- [ ] 2.1 `qa/remote/remote-clean.ps1` — promote `spike/remote-clean.draft.ps1` (design D5):
  - ports 8000/8112/9999;
  - NSIS uninstall via the parsed `QuietUninstallString` exe `/S`, then poll the HKCU entry ≤90 s;
  - `npm rm -g` when present;
  - the full D5 path list, including `HKCU:\Software\BlackBelt Technology`, the electron-updater cache and the `%TEMP%` prefixes;
  - never touches `C:\pi-dashboard-qa\logs`;
  - exit 0 when clean, exit 3 with a residue list.
- [ ] 2.2 `qa/remote/remote-preflight.ps1 [-Stage]`:
  - print the PS version, session id, `Get-ExecutionPolicy -List`, free GB on `C:` and `node --version` (when present) as `key=value` lines;
  - with `-Stage`: take or refuse the `C:\pi-dashboard-qa\.lock` (2 h staleness), then recreate `harness`, `tests`, `art`, `logs`;
  - `exit 7` on success (the sentinel, design D2); a distinct non-7 code on lock refusal or low disk.
- [ ] 2.3 `qa/remote/remote-cycle.ps1 -Mode zip|nsis|npm [-Artifact <path>] [-NpmVersion <v>] [-SmokeOnly]` (design D4):
  - `Start-Transcript` to `logs\`;
  - optional `-Motw`: write `Zone.Identifier` `ZoneId=3` on the artifact before deploy (design D7);
  - deploy per mode (zip: `Add-Type -AssemblyName System.IO.Compression.FileSystem` + `[IO.Compression.ZipFile]::ExtractToDirectory` → `C:\pi-dashboard-qa\app\` + discovered `pi-dashboard.exe`; npm: `npm i -g …@<v>` + `pi-dashboard start`);
  - health gate on `http://127.0.0.1:8000/api/health` for ≤180 s with a `launchSource` check;
  - stop the app;
  - suite per mode (zip/npm: `run-all.ps1`, with `C:\qa-artifacts` staging / `QA_NPM_SPEC`; nsis: the five `windows-nsis-*.ps1` in order, stopping at the first failure);
  - copy server/Electron logs, **redacting** `local-proof?code=` and `[?&](code|token|ticket)=` values (design D6, spike F15), and write `summary.json` (including `motw`, `healthSec`);
  - exit codes 0/20/21/22/suite rc.
- [ ] 2.4 `run.sh --start-only` path: `remote-cycle.ps1 -StartOnly` launches the deployed app via WMI `Win32_Process.Create` so it outlives the session (spike F5), waits for the health gate, prints the PID and exits. Not used in the verdict path.

## 3. Driver `qa/remote/run.sh`

- [ ] 3.1 Bash 3.2-compatible strict mode (no associative arrays, no `mapfile`); config loaded with `node -e` (no `jq`); CLI overrides (`--mode --artifact --npm-version --smoke-only --clean-only --start-only`); validation per spec, before any ssh/scp (required fields, mode allowlist, artifact exists + basename regex, npmVersion regex). Test first: `packages/shared/src/__tests__/qa-remote-run-config.test.ts` spawns `bash qa/remote/run.sh` with temp configs and stub `ssh`/`scp` on `PATH` (the stubs log their argv), asserting: no ssh call when the config is invalid; `portable` rejected; injection-shaped `npmVersion` rejected; the run works with `jq` absent from `PATH`; the preflight form selection (stub ssh returns 1, then 7 for the suffixed form → every later call carries the suffix; returns 7 → plain form; returns 1/1 → abort before staging).
- [ ] 3.2 Common ssh/scp option array: `-i`, `-p`/`-P`, `BatchMode=yes`, `StrictHostKeyChecking=accept-new`, `UserKnownHostsFile=qa/remote/.known_hosts`, `ConnectTimeout=15`.
- [ ] 3.3 Preflight phase (design D2): print `user@host` and the mode; scp `remote-preflight.ps1` into the remote home dir; try the plain form, then the `; exit $LASTEXITCODE` form; store the winner in the `remote_ps` helper; abort when neither returns 7 (naming `HKLM:\SOFTWARE\OpenSSH\DefaultShell`) or when disk is low.
- [ ] 3.4 Staging phase: `remote_ps remote-preflight.ps1 -Stage` (lock + recreate dirs), then the scp uploads (design D3). The exit trap removes the lock after post-clean.
- [ ] 3.5 Pre-clean → cycle (one ssh call; capture rc) → `trap` collects `logs\` into `qa/remote/logs/<host>-<UTC ISO8601>/`, prints the path, runs post-clean, and applies the exit policy (design D6).
- [ ] 3.6 `chmod +x qa/remote/run.sh`; `qa/remote/config.example.json` (design D7 example plus per-mode notes); `.gitignore` adds `qa/remote/config.json`, `qa/remote/logs/`, `qa/remote/.known_hosts`.

## 4. Makefile

- [ ] 4.1 Add `test-windows-remote-zip [ZIP=…]`, `test-windows-remote-npm [NPM_VERSION=…]` and `clean-windows-remote`. Each one `exec`s `remote/run.sh` with the matching flags.
- [ ] 4.2 Replace the `test-windows-remote-nsis` placeholder body with `remote/run.sh --mode nsis --artifact "$(SETUP)"`. Keep the `SETUP` guard (exit 2 + usage) and update its comment block.
- [ ] 4.3 Add the new targets to `help`. Confirm there is no `test-windows-remote-portable`.

## 5. Docs + DOX rows

- [ ] 5.1 Add a `qa/README.md` "Remote Windows host" section covering everything the spec's README requirement lists, including the bold QA-dedicated warning.
- [ ] 5.2 Scaffold `qa/remote/AGENTS.md` (one row per file). Update the `qa/AGENTS.md` `Makefile` row and add a `remote/` pointer. Update the `qa/tests/AGENTS.md` rows for `01-install.ps1` (`QA_NPM_SPEC`) and the BOM/`127.0.0.1` invariant.

## 6. Verification (no LAN host: use the proven `windows-latest` self-ssh method, `spike-windows-on-gh-actions` skill + `spike/spike-win-remote-qa.round2.yml`; repeat on a real LAN host when one exists)

- [ ] 6.1 Throwaway branch where the runner hosts sshd and runs `qa/remote/run.sh` from Git Bash against `localhost`, with `--smoke-only` in each mode using v0.10.0 artifacts. Expect: zip → `launchSource=electron`; npm → `standalone` + version 0.10.0; nsis → the five scripts in order. `summary.json` collected each time.
- [ ] 6.2 Same branch, default (full-suite) zip run: the driver's exit code equals `summary.json.exitCode` equals `run-all.ps1`'s rc. A non-zero result is expected until `repair-windows-qa-suite` lands. Logs collected; post-clean exit 0.
- [ ] 6.3 Idempotency: two back-to-back full runs. The second shows no `tests\tests` nesting and no residue (post-clean exit 0). `remote-clean.ps1` run 3× on the clean host: each exits 0 with empty stderr.
- [ ] 6.4 Zero-residue: snapshot-diff (`spike/probes/remote/snapshot.ps1`) of the baseline vs after post-clean, for each mode. Only non-dashboard noise may remain (`Mozilla`, `npm-cache`, `node-compile-cache`, `CrashDumps`), and each remaining item must be justified in the PR. Re-validates the D5 items added after the spike.
- [ ] 6.5 Failure paths: (a) point `DefaultShell` at a wrapper that swallows exit codes (a `.cmd` that always exits 0) → preflight aborts before staging, printing both observed codes; (b) occupy port 8000 before the cycle → the health gate or launch fails with 20 or 21, logs are collected, and post-clean still runs and frees the port; (c) kill sshd mid-cycle → the driver warns and exits non-zero.
- [ ] 6.5b Packer-image parity: set `DefaultShell=powershell.exe` on the runner and run `--smoke-only npm` → preflight selects the suffixed form and the run passes, with rc relayed exactly (a forced health-gate timeout surfaces as 21). Also verify that home-relative scp + `-File remote-preflight.ps1` resolves under both shells.
- [ ] 6.5c Lock: start a second driver while the first is mid-cycle → refused, naming the owner; backdate the lock 3 h → the second run proceeds with a warning.
- [ ] 6.5d `--motw` on the unsigned v0.10.0 Setup.exe and zip: record whether the deploy blocks or passes, and put the outcome in the README (design D7, F16).
- [ ] 6.5e Redaction: grep the collected logs for `local-proof?code=[A-Za-z0-9_-]{8,}` → no hits.
- [ ] 6.6 Measure `ZipFile.ExtractToDirectory` time for the 388 MB zip in PS 5.1, and record it in design.md Risks.
- [ ] 6.7 Non-admin user: a standard account with a per-user `authorized_keys` passes preflight and `--smoke-only` npm (resolves design Q3).
- [ ] 6.8 Diff scope matches the spec's "Diff scope" scenario; `openspec validate automate-windows-remote-qa --strict` passes; `node scripts/check-conventions.mjs` passes.
- [ ] 6.10 CI impact (spike F17): the PR runs `ci-gateway-platform.yml` (path-filtered on `28-gateway-windows.ps1`) and the Windows NSIS smoke in `_electron-build.yml` (dispatch `ci-electron.yml` if it is not triggered) → both green with the BOM'd, `127.0.0.1` scripts.
- [ ] 6.11 Delete the spike-era public Actions runs `40184762256` and `40186714826` (they print expired one-time local-proof codes, F15) with `gh run delete` — confirm with the user first.
- [ ] 6.12 Delete the throwaway branch and worktree; `git ls-remote --heads origin 'spike/*'` returns nothing.

## 7. Follow-up tracking

- [ ] 7.1 Make sure the change `repair-windows-qa-suite` exists. It covers spike F12:
  - `02`'s `Start-Process` on the `.ps1` shim;
  - the server-precondition chain in `03`/`04`/`05`/`10`/`22`/`32`/`38`;
  - `07`'s stale `offline-packages` assertion and its `Expand-Archive` time;
  - `12`'s SKIP-as-pass;
  - `44`'s CLI usage error.

  Its acceptance is `make -C qa test-windows-remote-zip` green.
- [ ] 7.2a Spike inline NSIS **launch** smoke on the `windows-latest` build runner. Run `windows-nsis-launch.ps1` (with the `127.0.0.1` probe) in a runner pwsh step after install. `restore-windows-nsis-installer` dropped this, claiming "the GUI never starts the server on a runner". This spike showed the server starts in session 0 and that the old probe false-FAILs (F6/F7). If green, propose adding it to `_electron-build.yml` in a separate change and update the `restore-windows-nsis-installer` 10.7 note.
- [ ] 7.2 Unblock `restore-windows-nsis-installer` task 10.7 (arm64/x64 NSIS launch smoke): post `make test-windows-remote-nsis SETUP=…` evidence there.
