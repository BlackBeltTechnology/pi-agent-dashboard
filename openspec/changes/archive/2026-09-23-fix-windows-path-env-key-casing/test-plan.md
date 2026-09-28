# Test Plan — fix-windows-path-env-key-casing

Stage: design   Generated: 2026-09-23

Requirements in scope:
- R1 `platform-primitives` › Spawn-env PATH key is case-normalized on Windows
- R2 `server-launch` › Bridge auto-spawn passes only narrow env overrides

---

## Scenarios

### Edge-case

The primitive `normalizeEnvPathKey(env, platform)` is always called with an injected `platform`.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R1 identity cases | EP | L1 | automated | `{ Path: "C:\\a", FOO: "1" }` | normalize, `win32` | returns a new object; keys `PATH` = `C:\a` and `FOO` = `1`; no `Path` |
| E2 | R1 duplicate variants | decision-table | L1 | automated | `{ PATH: "C:\\managed", Path: "C:\\managed;C:\\Program Files\\Git\\cmd" }` | normalize, `win32` | `PATH` = `C:\managed;C:\Program Files\Git\cmd`; `Object.keys` holds exactly one key whose upper-case is `PATH` |
| E3 | R1 case-insensitive de-dup | EP | L1 | automated | `{ Path: "C:\\Windows\\System32;c:\\windows\\system32" }` | normalize, `win32` | `PATH` = `C:\Windows\System32` (one entry) |
| E4 | R1 undefined variant | BVA | L1 | automated | `{ Path: undefined, PATH: "C:\\a" }` | normalize, `win32` | `PATH` = `C:\a`; `"Path" in out` is false; no throw |
| E5 | R1 undefined only | BVA | L1 | automated | `{ Path: undefined, FOO: "1" }` | normalize, `win32` | no key upper-casing to `PATH`; `FOO` = `1` |
| E6 | R1 empty string only | BVA | L1 | automated | `{ Path: "" }` | normalize, `win32` | `out` deep-equals `{ PATH: "" }` |
| E7 | R1 no variant | BVA | L1 | automated | `{ FOO: "1" }` | normalize, `win32` | `out` is the same object as the input (`toBe`) |
| E8 | R1 already normalized, idempotent | EP | L1 | automated | `{ PATH: "C:\\a" }`, then E2's output | normalize, `win32` | `toBe(input)` in both cases |
| E9 | R1 POSIX untouched | EP | L1 | automated | `{ PATH: "/usr/bin", Path: "/opt/x" }` | normalize, `linux` and `darwin` | `toBe(input)`; both keys and values unchanged |
| E10 | R1 variant ordering | decision-table | L1 | automated | `{ path: "C:\\c", Path: "C:\\b", PATH: "C:\\a" }` | normalize, `win32` | `PATH` = `C:\a;C:\b;C:\c`; only the `PATH` key remains |
| E11 | R1 empty entries dropped | BVA | L1 | automated | `{ Path: ";;C:\\a;" }` | normalize, `win32` | `PATH` = `C:\a` |
| E12 | R1 no mutation | EP | L1 | automated | frozen `Object.freeze({ Path: "C:\\a", PATH: "C:\\b" })` | normalize, `win32` | no throw; input keeps `Path`/`PATH` values; output differs from input |
| E13 | R1 spawn-env builder, the #720 regression | state (before → after) | L1 | automated | `{ Path: "C:\\Program Files\\Git\\cmd;C:\\Windows\\System32", SYSTEMROOT: "C:\\Windows" }` | `new ToolResolver({processExecPath}).buildSpawnEnv(env, { platform: "win32", exists })` | exactly one key upper-casing to `PATH`, named `PATH`; split on `;` it contains `C:\Program Files\Git\cmd` and `C:\Windows\System32`; the managed-bin index is below the Git index; no `:`-joined prepend segment |
| E14 | R1 spawn-env builder on POSIX | EP | L1 | automated | `{ PATH: "/usr/bin", Path: "/opt/x" }` | `buildSpawnEnv(env, { platform: "darwin" })` | `Path` = `/opt/x` untouched; `PATH` starts with the prepends and ends with `/usr/bin` (`:`-joined) |
| E15 | R1 overlay: caller wins in any casing | decision-table | L1 | automated | process env (host), ctx env `{ Path: "C:\\caller" }` | `buildSpawnEnvForArgv("node", ctx, { platform: "win32" })` | exactly one key upper-casing to `PATH`, value `C:\caller` |
| E16 | R1 overlay: empty caller PATH clears | BVA | L1 | automated | ctx env `{ Path: "" }` | `buildSpawnEnvForArgv("node", ctx, { platform: "win32" })` | `PATH` = `""`; no other PATH-like key |
| E17 | R1 overlay no-op unchanged | EP | L1 | automated | no ctx env, non-Electron exec | `buildSpawnEnvForArgv("node", undefined, {})` | returns `undefined`, as before |
| E18 | R1 shared launcher overlay | EP | L1 | automated | `opts.env = { FOO: "1" }` (no PATH), spawn seam captures env | `launchDashboardServer(opts)` on POSIX host | captured env `PATH` equals `new ToolResolver({processExecPath}).buildSpawnEnv(process.env).PATH`; `FOO` = `1` |
| E19 | R2 bridge overrides are narrow | EP | L1 | automated | `buildBridgeEnvOverrides({ PATH: "/usr/bin", HOME: "/h", NODE_OPTIONS: "--enable-source-maps", PI_DASHBOARD_ELECTRON: "1" }, 2048)` | call | keys ⊆ {`DASHBOARD_STARTER`, `NODE_OPTIONS`, heap marker, `PI_DASHBOARD_ELECTRON`, `PI_DASHBOARD_RESOURCES_PATH`}; no `PATH`/`HOME`; `DASHBOARD_STARTER` = `Bridge`; `NODE_OPTIONS` = `--enable-source-maps --max-old-space-size=2048`; both `PI_DASHBOARD_*` present with value `undefined` |
| E20 | R2 operator pin respected | decision-table | L1 | automated | `NODE_OPTIONS: "--max-old-space-size=4096"` with no marker | `buildBridgeEnvOverrides(env, 2048)` | `NODE_OPTIONS` = `--max-old-space-size=4096`; no `2048` token; marker key present with value `undefined` |
| E21 | R2 launchServer wiring | EP | L1 | automated | `process.env` stubbed with `PI_DASHBOARD_ELECTRON=1`; `launchDashboardServer` mocked | `launchServer(config)` | the mock receives an `env` with no `PATH`/`HOME` key, `DASHBOARD_STARTER` = `Bridge`, `NODE_OPTIONS` containing the configured ceiling, and `PI_DASHBOARD_ELECTRON` = `undefined` |
| E22 | R2 markers stripped end-to-end | state | L1 | automated | `process.env` with `PI_DASHBOARD_ELECTRON=1`, `PI_DASHBOARD_RESOURCES_PATH=/r`; bridge overrides as `opts.env`; spawn seam captures env | `launchDashboardServer` | captured env has neither key; `PATH` equals `buildSpawnEnv(process.env).PATH` |
| E23 | R1 pi-core-updater pass-through (POSIX) | EP | L1 | automated | host env (POSIX), managed runtime present (fixture) | default `_envBuilder` via the updater's spawn seam | the spawned env `PATH` starts with the managed node bin dir and contains the host `PATH` value; exactly one key upper-casing to `PATH` |
| E24 | R1 terminal env pass-through (POSIX) | EP | L1 | automated | host env (POSIX), `pty.spawn` mocked | `terminalManager.spawn(cwd)` | the env passed to `pty.spawn` has `PATH` equal to host `process.env.PATH` (host git source) and `TERM` set |
| E25 | R1 package-manager overlay (POSIX) | decision-table | L1 | automated | `options.env = { PATH: "/caller", FOO: "1" }`, adapter spawn mocked | package-manager spawn | spawned env `PATH` = `/caller`, `FOO` = `1`, host `HOME` kept |
| E26 | R1 doctor test-launch env | decision-table | L1 | automated | (a) `buildServerLaunchTestEnv("/b/node", { PATH: "/usr/bin" }, "darwin")`; (b) `buildServerLaunchTestEnv("C:\\b\\node.exe", { Path: "C:\\Git\\cmd" }, "win32")` | call the extracted pure builder | (a) `PATH` = `/b:/usr/bin`; (b) exactly one key upper-casing to `PATH`, `PATH` = `C:\b;C:\Git\cmd` |
| E27 | R1 end-to-end on Windows (#720 repro) | state (before → after) | L2 | automated | Windows VM: stub `tailscale.cmd` in a new temp dir, prepended to `$env:Path` in the pwsh session | `pi-dashboard start`, then `GET /api/tools/tailscale` | HTTP 200, `ok: true`, `path` under the temp dir (pre-fix: `ok: false`, `where` → not found) |

### Performance

None: the spec states no latency or throughput requirement. The design notes O(keys) on the identity path, which does not need a threshold test.

### Frontend-quirk

None: no UI surface changes.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R1 Electron on real Windows | manual acceptance | — | manual-only | Windows 11 + Git for Windows on system `Path`, Electron build | open Settings → Diagnostics; spawn a session in a git repo and run `git status` | [judgment on real hardware/packaging: Doctor `git source` = host, not bundled fallback; `/api/tools/git` `ok: true`; `git status` succeeds in the session; the issue reporter confirms] |

---

## Coverage summary

- Requirements covered: 2/2 (R1: E1–E18, E23–E27, X1 · R2: E19–E22)
- Scenarios by class: edge 27 · perf 0 · frontend 0 · error 1
- Scenarios by level: L1 26 · L2 1 · manual 1
- Scenarios by disposition: automated 27 · manual-only 1

## New infra needed

- none. E27 is a new `qa/tests/*.ps1` script in the existing Windows VM smoke tier, modelled on `02-server-start.ps1`.
