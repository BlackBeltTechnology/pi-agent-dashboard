# DOX — qa/tests

Files in this directory. One row per file. Non-source area. See change: migrate-file-index-to-agents-tree. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `01-install.ps1` | Windows install smoke. `npm install -g @blackbelt-technology/pi-dashboard`; verify `pi-dashboard --version` non-empty. Exit 1 on empty version. |
| `01-install.sh` | Unix install smoke. Sources nvm, `npm install -g @blackbelt-technology/pi-dashboard`, verify version + global node_modules dir present (`npm root -g`). Catches node-pty compile absence. |
| `02-server-start.ps1` | Windows server-start smoke. `Start-Process pi-dashboard start`, poll `http://localhost:8000/api/health` for 200 (15s). finally block calls `pi-dashboard stop` + force-kills proc. |
| `12-keeper-log-rotation.ps1` | Windows keeper-log rotation smoke (test-plan #E16, VM cadence only — NOT a CI gate): drives real `keeper.cjs`… → see `12-keeper-log-rotation.ps1.AGENTS.md` |
| `02-server-start.sh` | Unix server-start smoke. `pi-dashboard start &`, poll `/api/health` for HTTP 200 (15s). → see `02-server-start.sh.AGENTS.md` |
| `03-websocket.ps1` | Windows WebSocket smoke. Probe `/api/health`, then inline Node script `net.connect` pi gateway :9999 + browser WS :8000 with 3s timeouts. Exit 1 if either fails. |
| `03-websocket.sh` | Unix WebSocket smoke. Probe pi gateway `ws://localhost:9999` + browser `ws://localhost:8000/ws` via `ws`… → see `03-websocket.sh.AGENTS.md` |
| `04-terminal.ps1` | Windows PTY smoke. POST `http://localhost:8000/api/terminals` (`{cwd: $env:TEMP}`); fallback inline node-pty check spawns `powershell.exe echo hello-pty` via ConPTY, asserts `hello-pty` received. |
| `04-terminal.sh` | Unix PTY smoke. POST `/api/terminals` `{"cwd":"/tmp"}`, parse `id`. Fallback verifies `require('node-pty')` loads. Requires running server. |
| `05-git-ops.ps1` | Windows git smoke. `git init` temp repo + commit, query `http://localhost:8000/api/git/branches?dir=<base64url>`. Fallback `git branch --list`. Cleans temp dir in finally. |
| `05-git-ops.sh` | Unix git smoke. `git init` temp repo + commit, base64url-encode dir, GET `/api/git/branches?dir=<enc>`, grep `main|master`. Fallback local `git branch --list`. Cleans temp dir. |
| `06-electron-offline-bundle.sh` | Validate offline-packages bundle inside packaged Electron app Resources. Arg `<app-resources-dir>`. → see `06-electron-offline-bundle.sh.AGENTS.md` |
| `07-electron-bootstrap-v2.ps1` | Electron V2 LaunchSource bootstrap e2e on Windows ZIP. Extract `C:\qa-artifacts\PI-Dashboard-win32-x64.zip` →… → see `07-electron-bootstrap-v2.ps1.AGENTS.md` |
| `08-electron-real-launch.sh` | Linux Electron AppImage launch smoke under `xvfb-run`. Polls `/api/health` within 90 s, asserts `starter ==… → see `08-electron-real-launch.sh.AGENTS.md` |
| `09-electron-mac-launch.sh` | macOS in-CI Electron launch smoke. Resolves `.app` from `packages/electron/out/PI-Dashboard-darwin-*/` (forge… → see `09-electron-mac-launch.sh.AGENTS.md` |
| `09-image-fit-extension.ps1` | Windows port of pi-image-fit install + dep-tree sanity. Verifies `@blackbelt-technology/pi-image-fit`… → see `09-image-fit-extension.ps1.AGENTS.md` |
| `09-image-fit-extension.sh` | Bash pi-image-fit install + dep-tree sanity. `npm install @blackbelt-technology/pi-image-fit` in temp dir,… → see `09-image-fit-extension.sh.AGENTS.md` |
| `10-bundled-git.ps1` | Verifies bundled dugite-native git + sh on Windows. Forces `windowsGitSource=bundled` via `/api/config`,… → see `10-bundled-git.ps1.AGENTS.md` |
| `10-faux-model.sh` | VM smoke: faux prompt round-trip on clean box. Node driver connects `/ws`, snapshots pre-existing sessions,… → see `10-faux-model.sh.AGENTS.md` |
| `11-docker-zrok-v2.sh` | L2 (M6, change: support-zrok-v2). Builds the docker `base` stage, runs `docker run <img> zrok2 version` && `zrok version`, asserts both report v2.x (symlink resolves). |
| `12-openspec-shim.ps1` | T-C1: extensionless openspec shim resolves `openspec --version` (→`1.6.0`) via `bash.exe -c` with no node on PATH. See change: provision-openspec-cli-in-sessions. |
| `13-openspec-offline-regen.sh` | T-S2: offline `npx --no-install openspec init --tools pi --force` stamps `generatedBy: "1.6.0"`. See change: provision-openspec-cli-in-sessions. |
| `14-pi-resources-parity.sh` | P1/X10/X11: `GET /api/pi-resources` p95 across 10 refreshes within `PI_RESOURCES_P95_BUDGET_MS` (default… → see `14-pi-resources-parity.sh.AGENTS.md` |
| `15-omit-dev-build.sh` | X1: a fresh checkout builds the client under `--omit=dev` (#357). → see `15-omit-dev-build.sh.AGENTS.md` |
| `15-openspec-init.sh` | X8/X12: POST `/api/openspec/init` with a squatted `openspec` 0.0.0 stub earlier on PATH — stub never invoked… → see `15-openspec-init.sh.AGENTS.md` |
| `16-e2e-memory-bound.sh` | L2 memory-bound smoke over an ALREADY-RUNNING harness (never boots/tears down; port from… → see `16-e2e-memory-bound.sh.AGENTS.md` |
| `17-bridge-contention.ps1` | Windows twin of `17-bridge-contention.sh`. See change: fix-duplicate-bridge-registration. |
| `17-bridge-contention.sh` | L2 (test-plan #X10). Two sockets claim one session id on the pi gateway; asserts the duplicate receives… → see `17-bridge-contention.sh.AGENTS.md` |
| `18-server-port-hygiene.sh` | L2 (test-plan #E1, #E22). Server B takes its OWN gateway port plus A's OCCUPIED dashboard port, so B's… → see `18-server-port-hygiene.sh.AGENTS.md` |
| `19-tmux-spawn-injection.sh` | L2 harness (test-plan #X1-#X3, #X6). Creates workspace directories whose NAMES embed `$(…)`, backticks,… → see `19-tmux-spawn-injection.sh.AGENTS.md` |
| `20-tunnel-readiness-perf.sh` | P1/P3/X12 — readiness tick p95 (<2s) + concurrent-tunnel soak. → see `20-tunnel-readiness-perf.sh.AGENTS.md` |
| `21-gateway-rendezvous.sh` | L2 (test-plan #X5, #X6 → tasks 12.44, 12.45). Owner + one attach instance under a THROWAWAY `$HOME` (the… → see `21-gateway-rendezvous.sh.AGENTS.md` |
| `23-gateway-socket-fallback.sh` | L2 (test-plan #X17 → task 12.46). A `$HOME` deep enough to overflow `sun_path` forces the loopback fallback:… → see `23-gateway-socket-fallback.sh.AGENTS.md` |
| `24-gateway-where.sh` | L2 (test-plan #F7 → task 12.43). Spawns a REAL pi session in a throwaway `$HOME` with… → see `24-gateway-where.sh.AGENTS.md` |
| `25-gateway-remote-join-perf.sh` | OPT-IN perf (test-plan #P2, #P3 → tasks 12.40, 12.41); not in `run-all.sh`. → see `25-gateway-remote-join-perf.sh.AGENTS.md` |
| `26-gateway-promotion-soak.sh` | OPT-IN soak (test-plan #P5 → task 12.42); not in `run-all.sh`. → see `26-gateway-promotion-soak.sh.AGENTS.md` |
| `27-docker-deploy-lifecycle.sh` | OPT-IN L2 (`PI_QA_DOCKER=1`), not in `run-all.sh`. Runs the DOCUMENTED `docker compose up -d` — no test… → see `27-docker-deploy-lifecycle.sh.AGENTS.md` |
| `run-all.ps1` | Windows QA suite runner. Runs ordered test list (`01-install` … `22-worktree-separator`), tallies PASS/FAIL/SKIP, runs `pi-dashboard stop` cleanup, exits 1 on any FAIL or SKIP. |
| `run-all.sh` | Bash QA suite runner. Sources nvm, runs the ordered `TESTS` list (currently `01-install` …… → see `run-all.sh.AGENTS.md` |
| `windows-nsis-branding.ps1` | NSIS installer branding check. Asserts HKCU Add/Remove `Publisher == "BlackBelt Technology"`, optionally… → see `windows-nsis-branding.ps1.AGENTS.md` |
| `windows-nsis-install-custom-dir.ps1` | NSIS silent install to user-chosen dir (design D3 regression guard). → see `windows-nsis-install-custom-dir.ps1.AGENTS.md` |
| `windows-nsis-install.ps1` | NSIS per-user default-path silent install (restore-windows-nsis-installer guard). → see `windows-nsis-install.ps1.AGENTS.md` |
| `windows-nsis-launch.ps1` | Launches installed `pi-dashboard.exe`, polls `/api/health` for 200 within `TimeoutSec` (default 60). → see `windows-nsis-launch.ps1.AGENTS.md` |
| `windows-nsis-no-permachine.ps1` | Asserts NSIS installer is per-user only (design D2). No HKLM Add/Remove entry (32- or 64-bit view), install dir not under Program Files. Assumes `windows-nsis-install.ps1` already ran. |
| `windows-nsis-uninstall.ps1` | NSIS uninstall preserves user data (design D4). Seeds `~/.pi/qa-preserve-marker.txt`, runs uninstaller `/S`… → see `windows-nsis-uninstall.ps1.AGENTS.md` |
| `22-worktree-separator.ps1` | Windows `\`-separator worktree smoke (test-plan X14). `git init` temp repo + `git worktree add… → see `22-worktree-separator.ps1.AGENTS.md` |
| `28-gateway-windows.ps1` | Windows gateway transport + identity (tasks 5.1/5.5/5.7/12.53). → see `28-gateway-windows.ps1.AGENTS.md` |
| `29-gateway-posix-no-tcp.sh` | A POSIX DEFAULT start binds no bridge TCP port at all (task 13.8, #X16). → see `29-gateway-posix-no-tcp.sh.AGENTS.md` |
| `31-roles-read-api.sh` | L2 (#X8 → task 9.1). Starts a dashboard in a throwaway `$HOME` with NO pi session spawned, GETs `/api/roles`,… → see `31-roles-read-api.sh.AGENTS.md` |
| `30-gateway-instance-mismatch.sh` | A record naming one instance while another answers (task 5.4b, D14). → see `30-gateway-instance-mismatch.sh.AGENTS.md` |
