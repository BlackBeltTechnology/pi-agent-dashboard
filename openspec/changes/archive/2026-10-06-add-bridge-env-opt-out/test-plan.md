# Test Plan — add-bridge-env-opt-out

Stage: design   Generated: 2026-10-06

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Bridge activation resolves env over config over default | decision-table | L1 | automated | `cfg.enabled=true`; env `PI_DASHBOARD_BRIDGE` ∈ {`off`, `" OFF "`, `0`, `false`, `No`} | `resolveBridgeEnabled(cfg, env)` | returns `false` for every value |
| E2 | Bridge activation resolves env over config over default | decision-table | L1 | automated | `cfg.enabled=false`; env ∈ {`on`, `1`, `TRUE`, `" yes "`} | `resolveBridgeEnabled(cfg, env)` | returns `true` for every value |
| E3 | Bridge activation resolves env over config over default | EP (unset/empty partition) | L1 | automated | env ∈ {unset, `""`, `"  "`} × `cfg.enabled` ∈ {true, false} | `resolveBridgeEnabled(cfg, env)` | returns exactly `cfg.enabled` in all 6 cells |
| E4 | Bridge activation resolves env over config over default | BVA (near-miss tokens) | L1 | automated | env ∈ {`offf`, `disabled`, `n`, `2`, `o n`} × `cfg.enabled` ∈ {true, false} | `resolveBridgeEnabled(cfg, env)` | returns `cfg.enabled` (no near-miss is recognised) |
| E5 | `bridge.enabled` config field | EP | L1 | automated | temp HOME `config.json` with `bridge` = absent / `{}` / `{enabled:false}` / `{enabled:"no"}` / `{enabled:0}` / `null` / bare `false` | `loadConfig()` | `bridge.enabled` = true / true / false / true / true / true / true |
| E6 | `bridge.enabled` config field | EP (unreadable file) | L1 | automated | temp HOME with no `config.json`; empty file; `{not json` | `loadConfig()` | `bridge.enabled === true` in all 3 cases |
| E7 | `bridge.enabled` config field | state (fresh seed) | L1 | automated | temp HOME, no config dir | `ensureConfig()` then read raw file | parsed JSON has no `bridge` key |
| E8 | Bridge activation resolves env over config over default; Disabled bridge is fully inert | decision-table + spy | L1 | automated | env `{PI_DASHBOARD_BRIDGE:"off"}`; `readConfig` spy returning `{enabled:true}`; console.log/warn/error spies | `shouldActivateBridge(env, readConfig)` | returns `false`; `readConfig` called 0 times; 0 console calls |
| E9 | Bridge activation resolves env over config over default | decision-table + spy | L1 | automated | env `{}`; `readConfig` spy returning `{enabled:false}` | `shouldActivateBridge(env, readConfig)` | returns `false`; `readConfig` called exactly 1 time |
| E10 | Server-spawned sessions force bridge activation | EP | L1 | automated | base env (a) `{PI_DASHBOARD_BRIDGE:"off"}` (b) without the key; with and without `spawnToken` | `buildSpawnEnv(base, opts)` | returned env `PI_DASHBOARD_BRIDGE === "on"` in all 4 cases; `base.PI_DASHBOARD_BRIDGE` still `"off"` in (a) |
| E11 | Server-spawned sessions force bridge activation | decision-table | L1 | automated | `sessionExists` ∈ {true, false} × options ∈ {none, `{spawnToken:"tok"}` + endpoint `{url, socket}` + heap `"--max-old-space-size=4096"`} | `buildTmuxCommand(cwd, sessionExists, options, ["pi"], heap, endpoint)` | argv contains adjacent pair `-e`, `PI_DASHBOARD_BRIDGE=on` exactly once, at an index before `-c`, in all 4 cells |

### Performance

None. Activation adds at most one `loadConfig()` read, which the bridge already performs during init (`bridge.ts:290`); the env-recognised path (every dashboard spawn) skips it.

### Frontend-quirk

None. No client surface changes.

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Activation resolution fails open | fault-injection (abort) | L1 | automated | `readConfig` throws `new Error("EACCES")`; env `{}`; console spies | `shouldActivateBridge(env, readConfig)` | returns `true`; does not throw; 0 console calls |
| X2 | Disabled bridge is fully inert | process smoke (negative + control arm) | L2 | automated | dashboard server running; user-launched `pi --mode rpc` (no model, no faux fixture — registration happens at `session_start`, no prompt driven) with `PI_DASHBOARD_URL` → server gateway; arm A env `PI_DASHBOARD_BRIDGE=off`, arm B env unset | start pi, wait 15 s, list `/api/sessions` (snapshot diff) | arm A: 0 new sessions; arm B: exactly 1 new session within 15 s (guards a vacuous pass) |
| X3 | Bridge activation resolves env over config over default (config path) | process smoke | L2 | automated | `config.json` `bridge.enabled:false` (restored via trap); user-launched `pi --mode rpc` (no model); arm A env unset, arm B `PI_DASHBOARD_BRIDGE=on` | start pi, wait 15 s, list `/api/sessions` | arm A: 0 new sessions; arm B: 1 new session |
| X4 | Server-spawned sessions force bridge activation (composition, headless) | process smoke | L2 | automated | `config.json` `bridge.enabled:false` (restored via trap) | `POST` dashboard spawn of a headless session in a temp cwd | session registers (appears in `/api/sessions` with that cwd) within the readiness timeout |
| X5 | Server-spawned sessions force bridge activation (composition, tmux) | process smoke | L2 | automated | `config.json` `bridge.enabled:false`; tmux spawn strategy; skip exit 0 when tmux absent | dashboard spawn of a tmux session in a temp cwd | session registers within the readiness timeout; `tmux show-environment -t pi-dashboard` irrelevant — pane registration is the observable |
| M1 | Disabled bridge is fully inert (interactive TUI) | exploratory | — | manual-only | interactive TUI `PI_DASHBOARD_BRIDGE=off pi` with a third-party `ask_user` extension installed | open session, inspect `/tools`-style listing and startup output | [judgment: no dashboard tools/commands listed, no dashboard startup chatter, third-party `ask_user` works] |
| M2 | Server-spawned sessions force bridge activation (Windows Terminal) | exploratory | — | manual-only | Windows host, `config.json` `bridge.enabled:false`, `wt.exe` already running | dashboard spawn via Windows Terminal strategy | [judgment: session registers; wt env propagation is a documented unguaranteed path — needs a real Windows desktop] |

---

## Coverage summary

- Requirements covered: 5/5
- Scenarios by class: edge 11 · perf 0 · frontend 0 · error 7
- Scenarios by level: L1 12 · L2 4 · L3 0
- Scenarios by disposition: automated 16 · manual-only 2

## New infra needed

- none (new qa script `qa/tests/41-bridge-opt-out.sh` reuses only the `/api/sessions` snapshot-diff pattern from `10-faux-model.sh` — NO faux fixture, since `faux-model-integration-tests` allows exactly one faux-backed VM smoke; tmux arm reuses `19-tmux-spawn-injection.sh` skip/guard pattern)
