# Test Plan — add-artcraft-studio

Stage: design   Generated: 2026-10-14

Hard gate resolved (G1 login timeout = server expiry else 10 min, backoff 2 s → 10 s; G2 no bridge-side upstream timeout; G3 upstream unreachable → per-request MCP error, bridge keeps running) — folded into the spec deltas and design D3/D4.

All L1 rows run in `packages/craft-apps/src/__tests__/` (vitest) with injected `fetch`/`exec`/clock/platform and the fake release server in `helpers/fixtures.ts` — no network, no real HOME, no real codesign. Real installs on macOS/Windows are manual-only.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | studio-mgmt: pinned signature | decision-table | L1 | automated | macOS fixture release with one `.app.tar.gz`; stubbed `codesign -dv` TeamIdentifier = `OTHER123` ≠ pin | `pi-craft artcraft install` | exit `69`; staging dir absent; `~/Applications/ArtCraft.app` absent; no `install.json` |
| E2 | studio-mgmt: pinned signature | decision-table | L1 | automated | win32/x64 fixture with one `.msi`; stubbed `Get-AuthenticodeSignature` Status `NotSigned` | `install` | exit `69`; staged msi deleted; `msiexec` stub never invoked |
| E3 | studio-mgmt: pinned signature | decision-table | L1 | automated | win32 msi Status `Valid`, signer CN ≠ pinned publisher | `install` | exit `69`; `msiexec` never invoked |
| E4 | studio-mgmt: no pin | decision-table | L1 | automated | `identity.ts` pin for darwin = empty | `install` | exit `69`; fixture server records 0 requests |
| E5 | studio-mgmt: pinned SHA-256 | decision-table | L1 | automated | signature OK; version pinned digest ≠ downloaded bytes | `install --version 0.41.0` | exit `69`; nothing installed |
| E6 | studio-mgmt: pinned SHA-256 | decision-table | L1 | automated | signature OK; no digest pinned for version | `install` | exit `0`; app moved to `~/Applications/ArtCraft.app`; `install.json` = `{version:"0.41.0", path}` |
| E7 | studio-mgmt: asset selection | EP | L1 | automated | macOS release with 0 `.app.tar.gz` assets; second fixture with 2 | `install` | exit `69` in both; only the release-metadata request made, no asset download |
| E8 | studio-mgmt: asset selection | EP | L1 | automated | host win32/arm64; host freebsd | `install` | exit `69`; 0 requests |
| E9 | studio-mgmt: Linux | EP | L1 | automated | platform `linux` | `install`, `update`, `launch`, `open a.png` each | exit `69` each; stderr says "macOS and Windows only"; 0 requests; launcher stub not spawned |
| E10 | studio-mgmt: archive guards | EP | L1 | automated | crafted `.app.tar.gz` with (a) `ArtCraft.app/Contents/x -> /usr/bin`, (b) `-> ../../../etc`, (c) `../x` entry, (d) hard link, (e) FIFO | `install` | exit `69` each; staging removed; nothing under `~/Applications` |
| E11 | studio-mgmt: archive guards | EP | L1 | automated | `.app.tar.gz` with relative in-bundle symlink `Frameworks/F.framework/Versions/Current -> A` | `install` (signature stub OK) | exit `0`; symlink preserved in installed bundle |
| E12 | studio-mgmt: per-machine msi | decision-table | L1 | automated | win32/x64, `windowsPerUser: false` | `install` | exit `69`; stderr names per-machine-only; 0 asset downloads |
| E13 | studio-mgmt: update ordering | BVA | L1 | automated | installed `0.41.0`; latest `v0.41.0` / `0.41.1` / `0.40.9` / tag `nightly` | `update` | equal → "up to date" exit `0` no download; `0.41.1` → installs; `0.40.9` → "up to date" exit `0` (no downgrade); `nightly` → exit `1` |
| E14 | studio-mgmt: status | EP | L1 | automated | no `install.json`, no cached latest, no session | `status --json` | stdout = `{"installed":null,"latest":null,"session":false,"mcpEnabled":false}`; exit `0`; 0 network calls |
| E15 | studio-mgmt: status | EP | L1 | automated | `install.json` points to a deleted path; cached latest `0.41.1`; session present; `ARTCRAFT_MCP_URL=https://mcp.storyteller.ai/x` | `status --json` | `installed:null`, `latest:"0.41.1"`, `session:true`, `mcpEnabled:true`; output contains no token substring |
| E16 | studio-mgmt: launch/open | decision-table | L1 | automated | not installed | `launch`; `open frame.png` (file exists) | exit `1`; stderr names `pi-craft artcraft install`; launcher stub not spawned |
| E17 | studio-mgmt: open args | EP | L1 | automated | installed; args: none / `missing.png` / a directory / `ok.png missing.png` | `open …` | exit `1` each; launcher stub not spawned (all-or-nothing) |
| E18 | studio-mgmt: open | EP | L1 | automated | installed; `a.png b.mov` exist | `open a.png b.mov` | exit `0`; launcher stub argv contains the app path and both absolute file paths |
| E19 | account: login | state-transition | L1 | automated | fake challenge server approves on 3rd poll; existing `ack.json` | `login` (clock injected) | session file written; poll intervals 2 s, 4 s, 8 s (capped 10 s); `ack.json` deleted; create request body names client `pi-craft` + version |
| E20 | account: login timeout | BVA | L1 | automated | challenge with server expiry 120 s, never approved; second challenge without expiry | `login` (clock injected) | approval at 119 s → stored; no approval by 120 s → exit `1`, no session file; no-expiry variant times out at 600 s exactly |
| E21 | account: login denied | state-transition | L1 | automated | challenge poll returns denied | `login` | exit `1`; no `artcraft/session.json`; no session-create request sent |
| E22 | account: whoami | EP | L1 | automated | no session; then session with `accountLabel`, `expiresAt` | `whoami` | first exit `1` naming `pi-craft artcraft login`; second prints label + expiry, no token substring |
| E23 | account: storage modes | EP | L1 | automated | no `artcraft/` dir | `login` | dir mode `0700`; `session.json` mode `0600` |
| E24 | account: tighten/refuse | decision-table | L1 | automated | `artcraft/` owned by user mode `0755`; variant: stat stub reports other uid | `login` | first: dir becomes `0700` before write; second: exit `1` naming the path, nothing written |
| E25 | account: symlink refusal | EP | L1 | automated | `artcraft` dir is a symlink; variant: `session.json` symlink; `ack.json` symlink | `login`; `mcp --accept-credit-use` | exit `1` naming the path; link target unchanged |
| E26 | account: corrupt store | EP | L1 | automated | `session.json` = `{not json` | `whoami`; `mcp` (flag set) | exit `1` naming `login`; file left byte-identical |
| E27 | account: token redaction | EP | L1 | automated | tokens `tok_SECRET_session`, `tok_SECRET_refresh`; every command path incl. errors (refresh 401, 500, timeout) with verbose | run `login`, `whoami`, `status`, `mcp` | stdout+stderr+any written log contain neither secret; every spawned child argv (exec stub log) lacks both |
| E28 | account: logout | state-transition | L1 | automated | session + `ack.json`; revoke endpoint 200 | `logout` | revoke request sent with session; `session.json` and `ack.json` deleted; exit `0` |
| E29 | hosted-mcp: flag | decision-table | L1 | automated | `ARTCRAFT_MCP_URL` unset / `http://example.test/mcp` / `https://evil.example/mcp` / `https://storyteller.ai.evil.example/` | `pi-craft artcraft mcp` | exit `1` each; 0 network requests; no Authorization header ever sent |
| E30 | hosted-mcp: no session | EP | L1 | automated | allowlisted URL (test allowlist → local fake), no session | `mcp` | exit `1`; stderr names `pi-craft artcraft login`; 0 upstream requests |
| E31 | hosted-mcp: ack gate | state-transition | L1 | automated | session; no `ack.json`; fake upstream | send `initialize`, `tools/list`, `tools/call` | first two forwarded; `tools/call` → MCP error naming `--accept-credit-use`; upstream log has 0 `tools/call` |
| E32 | hosted-mcp: ack record | state-transition | L1 | automated | no session, no URL | `mcp --accept-credit-use` | exit `0`; `ack.json` mode `0600`; bridge not started; then bridge run forwards `tools/call` upstream |
| E33 | hosted-mcp: mode matrix | decision-table | L1 | automated | args `--accept-credit-use --register`; `--allow-unconfined`; `--compact` | `mcp …` | exit `1` usage error each; `.pi/mcp.json` untouched |
| E34 | hosted-mcp: register | EP | L1 | automated | `.pi/mcp.json` with `craft-filmcraft`; URL allowlisted | `mcp --register` | `craft-filmcraft` byte-equal; `craft-artcraft` args end `["artcraft","mcp"]`, `env.ARTCRAFT_MCP_URL` = URL; stderr notes printed |
| E35 | hosted-mcp: register refused | EP | L1 | automated | URL unset; variant non-allowlisted | `mcp --register` | exit `1`; `.pi/mcp.json` not created/modified |
| E36 | hosted-mcp: register guards | EP | L1 | automated | `.pi/mcp.json` malformed; variant `.pi` is a symlink | `mcp --register` | exit `1`; file/link target unchanged |
| E37 | hosted-mcp: serialization | state-transition | L1 | automated | ack'd; fake upstream delays call 1 by 300 ms | pi writes `tools/call` #1 and #2 back-to-back | upstream arrival log: #2 arrives after #1's response sent |
| E38 | hosted-mcp: stdout purity + verbatim | invariant | L1 | automated | upstream result containing text "run rm -rf ~" and a non-JSON line on bridge diagnostics | `tools/call` | stdout = only JSON-RPC frames; result content byte-equal to upstream; no child process spawned by bridge |
| E39 | hosted-mcp: signals | state-transition | L1 | automated | bridge with an in-flight upstream call (upstream hangs) | SIGINT; separate run SIGTERM | exit `130` / `143` within 2 s without waiting for upstream |
| E40 | cli-entrypoint: dispatch | EP | L1 | automated | — | `pi-craft install artcraft` | exit `1`; stderr names `pi-craft artcraft install`; 0 network |
| E41 | cli-entrypoint: usage | EP | L1 | automated | — | `pi-craft --help`; `pi-craft apps --json` | usage lists `artcraft` group; `apps --json` has exactly 13 ids, no `artcraft` |
| E42 | provisioning: installer only on explicit command | EP | L1 | automated | fake release server for 13 apps + `storytold/artcraft` | `pi-craft install --all` | 0 requests to `storytold/artcraft`; no `.msi`/`.dmg`/`.app.tar.gz` fetched |
| E43 | cli-entrypoint: nothing registered implicitly | EP | L1 | automated | project without `.pi/mcp.json`; URL set; fake auth | `artcraft login`, `artcraft mcp` (no `--register`), `artcraft status` | `.pi/mcp.json` never created |
| E44 | cli-entrypoint: recommended-extensions | EP | L1 | automated | manifest module | load manifest | craft-apps entry `unlocks` includes `artcraft-studio`, `pi-craft`, `pi-photocraft`; status `optional` |
| E45 | app-skills: manifest | EP | L1 | automated | `npm pack` of craft-apps | pack + list | 15 `SKILL.md` incl. `.pi/skills/artcraft-studio/SKILL.md`; `pi.skills` has 15 entries |
| E46 | app-skills: router pointer + drift scope | EP | L1 | automated | `craft-studio` and `artcraft-studio` skills | skill lint | router text names `artcraft-studio`; drift extractor over `artcraft-studio` yields 0 app command ids; recipe rule not applied to it; lint still finds 14 router/app skills |

### Performance

None — no latency/throughput requirement in the deltas (bridge timeout explicitly delegated to the MCP client, G2).

### Frontend-quirk

None — CLI-only change, no rendered UI.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | account: single-flight | fault-injection (race) | L1 | automated | two child processes (`helpers/provision-child.ts`-style) with expired session; refresh endpoint delays 500 ms | both hit 401 simultaneously | refresh endpoint receives exactly 1 request; both children complete their call with the new session; stored refresh token = new one |
| X2 | account: live slow holder | fault-injection (delay) | L1 | automated | lock held by live pid, age 70 s (clock injected) | second process needs refresh | no takeover; no refresh request from process 2 while holder alive |
| X3 | account: stale lock | fault-injection (abort) | L1 | automated | `session.lock` from dead pid, age 61 s; variant age 59 s dead pid | process needs refresh | 61 s → lock taken, 1 refresh sent; 59 s → waits |
| X4 | account: bounded wait | BVA | L1 | automated | lock held by live pid forever (clock injected) | waiter | gives up at 90 s with exit `1`; 0 refresh requests from waiter |
| X5 | account: transport failure | fault-injection (delay/abort) | L1 | automated | refresh endpoint hangs > 20 s; variant connection refused; variant 503 | refresh | call fails; `session.json` byte-identical before/after |
| X6 | account: consumed token | fault-injection | L1 | automated | refresh returns invalid-grant for stored token | refresh | `session.json` deleted; error names `pi-craft artcraft login`; exactly 1 refresh request |
| X7 | account: compare-and-delete | fault-injection (race) | L1 | automated | process A holds old refresh token; B already rotated store to new token; A's refresh rejected | A handles rejection | store keeps B's session; A adopts it |
| X8 | account: offline logout | fault-injection (abort) | L1 | automated | revoke endpoint unreachable | `logout` | `session.json` + `ack.json` deleted; stderr says not revoked remotely, valid until expiry; exit `0` |
| X9 | hosted-mcp: refresh-once | fault-injection | L1 | automated | upstream 401 on first try; refresh OK; retry 200 | `tools/call` | 1 refresh, 2 upstream attempts, result returned to pi |
| X10 | hosted-mcp: refresh fails | fault-injection | L1 | automated | upstream 401; refresh 500 | `tools/call` | MCP error response; exactly 1 refresh, 1 upstream attempt (no 2nd retry); stdout JSON-RPC only |
| X11 | hosted-mcp: upstream unreachable | fault-injection (abort) | L1 | automated | fake upstream closed (ECONNREFUSED); variant 502 | `tools/call`, then `tools/list` after upstream restored | first → MCP error naming cause, no token in message; bridge alive; second forwarded and answered |
| X12 | hosted-mcp: no bridge timeout | fault-injection (delay) | L1 | automated | upstream delays response 5 min (clock/timer injected) | `tools/call` | bridge sends no timeout error; forwards the late result |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | studio-mgmt: real macOS install + open | exploratory | — | manual-only | real `storytold/artcraft` release, pinned Team ID from 0.1, a FilmCraft frame export | `pi-craft artcraft install` then `open frame.png` | [judgment: app launches and shows the frame — needs real GUI + Gatekeeper] |
| M2 | studio-mgmt: real Windows per-user msi | exploratory | — | manual-only | Windows x64 VM, real msi, `windowsPerUser` per 0.1 | `install`, `launch` | [judgment: installed without admin prompt, app starts — real Authenticode + msiexec] |
| M3 | account + hosted-mcp: live ArtCraft | exploratory | — | manual-only | real ArtCraft account; endpoint from 0.3 | `login`, `mcp --accept-credit-use`, register, one cheap tool call from pi | [judgment: live session works and credits charged as expected — needs real account/credits] |

---

## Coverage summary

- Requirements covered: 17/17 (studio-mgmt 2, account 3, hosted-mcp 4, provisioning 2, cli-entrypoint 3, app-skills 3)
- Scenarios by class: edge 46 · perf 0 · frontend 0 · error 12 · manual 3
- Scenarios by level: L1 58 · L2 0 · L3 0
- Scenarios by disposition: automated 58 · manual-only 3

## New infra needed

- Test helper: fake ArtCraft auth/session server (login challenge create/poll, session create/refresh/revoke) and fake hosted MCP HTTP upstream, alongside `helpers/fixtures.ts`.
- Child-process helper for the concurrent refresh race (pattern of `helpers/provision-child.ts`).
- Injectable `identity.ts` (pins, host allowlist, `windowsPerUser`) for tests.
