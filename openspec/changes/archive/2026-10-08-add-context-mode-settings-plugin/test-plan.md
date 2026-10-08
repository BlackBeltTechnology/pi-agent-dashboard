# Test Plan — add-context-mode-settings-plugin

Stage: design   Generated: 2026-10-07

No clarification markers: every requirement supplies concrete values (defaults, bounds, names, file path, mechanisms). There is no performance requirement, so no perf scenarios are derived.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | cms: Validate before writing | BVA | L1 | automated | `search.blockAfter` ∈ {0, 1, 8, -1, 1.5, "8"} | `validateSettings` | 1, 8 → valid; 0, -1, 1.5 (integer kind), "8" (string) → one error each naming `search.blockAfter` |
| E2 | cms: Validate before writing | BVA | L1 | automated | `search.windowMs` ∈ {0, 1, 60000, -5, NaN, Infinity} | `validateSettings` | 1, 60000 valid; 0, -5, NaN, Infinity → errors |
| E3 | cms: Validate before writing | EP | L1 | automated | `locale.timeZone` ∈ {"Europe/Budapest", "UTC", "Mars/Olympus", ""}; `locale.locale` ∈ {"hu-HU", "en", "xx_YY!!"} | `validateSettings` | valid zones/locales accepted; "Mars/Olympus", "", "xx_YY!!" → errors |
| E4 | cms: Validate before writing | EP | L1 | automated | `storage.dir` ∈ {"/abs/x", "~/cm", "rel/x", "C:\\x" on POSIX} | `validateSettings` | "/abs/x", "~/cm" valid; "rel/x" invalid; "C:\\x" invalid on POSIX |
| E5 | cms: Exposed parameter set | EP | L1 | automated | `{ "bridge.depth": 1 }`, `{ "platform": "pi" }`, `{ "storage.projectDir": "/x" }` | `validateSettings` | each rejected as unknown key; descriptor table has no `CONTEXT_MODE_BRIDGE_*`, `CONTEXT_MODE_PROJECT_DIR`, `CONTEXT_MODE_PLATFORM`, `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS`, `CONTEXT_MODE_AGY_EXEC_TIMEOUT_MS`, `CONTEXT_MODE_COPILOT_PLUGIN` env |
| E6 | cms: Fixed settings file with logical keys | decision-table | L1 | automated | `{ "fetch.strict": true }`, `{ "fetch.strict": false }`, `{}` | `projectEnv(…, {scopes:["runtime"]})` | `{CTX_FETCH_STRICT:"1"}`, `{}`, `{}` |
| E7 | cms: Exposed parameter set (`~` expansion) | EP | L1 | automated | `{ "storage.dir": "~/cm-data" }` with HOME=/h | `projectEnv(…, {scopes:["storage"]})` | `CONTEXT_MODE_DIR="/h/cm-data"` (absolute) |
| E8 | cms: bridge never projects storage | decision-table | L1 | automated | `{ "storage.dir": "/d", "search.windowMs": 30000 }` | bridge factory runs with empty env | `process.env.CONTEXT_MODE_SEARCH_WINDOW_MS==="30000"`, `CONTEXT_MODE_DIR` undefined, `PI_CONTEXT_MODE_SETTINGS_PROJECTED==="CONTEXT_MODE_SEARCH_WINDOW_MS"` |
| E9 | cms: explicit env wins | decision-table | L1 | automated | env `CTX_FETCH_STRICT=1`, file `fetch.strict:false`; env `CONTEXT_MODE_TZ=UTC`, file `Europe/Budapest` | bridge factory | env keeps `CTX_FETCH_STRICT=1` and `CONTEXT_MODE_TZ=UTC`; neither listed in the marker |
| E10 | psec: Contributions apply without overriding | decision-table | L1 | automated | contributor returns `{NODE_OPTIONS:"--inspect", CONTEXT_MODE_BRIDGE_DEPTH:"1", LD_PRELOAD:"x", DYLD_INSERT_LIBRARIES:"x", PATH:"/x", PI_DASHBOARD_URL:"x", "bad-name":"1", OK_VAR:"a\u0000b", CTX_FETCH_STRICT:"1"}` | `buildSpawnEnv` | only `CTX_FETCH_STRICT=1` applied; base `NODE_OPTIONS`/`PATH`/`PI_DASHBOARD_URL` unchanged |
| E11 | psec: Contributions apply without overriding | decision-table | L1 | automated | base env `CONTEXT_MODE_TZ=UTC`; contributor returns `CONTEXT_MODE_TZ=Europe/Budapest` | `buildSpawnEnv` | result `CONTEXT_MODE_TZ=UTC` |
| E12 | psec: pipeline order + supersede | state | L1 | automated | base env `CTX_FETCH_STRICT=1`, `PI_CONTEXT_MODE_SETTINGS_PROJECTED="CTX_FETCH_STRICT,PATH"`, `PATH=/usr/bin`; contributor (supersede names = runtime set) returns `{}` | `buildSpawnEnv` | `CTX_FETCH_STRICT` absent, `PATH=/usr/bin` kept, marker absent |
| E13 | psec: Trusted plugins can register | decision-table | L1 | automated | plugins priority {50, 100, 101, undefined} × enabled {true, false}, each contributor returns `{X_FLAG:"1"}` | spawn | `X_FLAG` present only for (50, enabled) and (100, enabled) |
| E14 | psec: mechanism context | EP | L1 | automated | context-mode contributor with file `{search.windowMs:30000, storage.dir:"/d"}` | `buildSpawnEnv` per mechanism headless/tmux/wt/wsl-tmux | headless/tmux/wt: both vars; wsl-tmux: neither |
| E15 | hs: spawn env strips bridge-internal vars | EP | L1 | automated | base env `CONTEXT_MODE_BRIDGE_DEPTH=1`, `CONTEXT_MODE_BRIDGE_IDLE_MS=0`, `CONTEXT_MODE_TZ=UTC` | `buildSpawnEnv` | first two absent, `CONTEXT_MODE_TZ=UTC` present |
| E16 | hs: tmux true unset | EP | L1 | automated | `buildTmuxCommand` for new-window and new-session, tmux + wsl-tmux | argv inspection | pane command starts with `env -u CONTEXT_MODE_BRIDGE_DEPTH -u CONTEXT_MODE_BRIDGE_IDLE_MS`; no `-e CONTEXT_MODE_BRIDGE_DEPTH=` arg; contributed `CTX_FETCH_STRICT=1` appears as `-e CTX_FETCH_STRICT=1` |
| E17 | sl: bridge auto-spawn strips vars | EP | L1 | automated | bridge env `CONTEXT_MODE_BRIDGE_DEPTH=1`, `CONTEXT_MODE_BRIDGE_IDLE_MS=0` | `buildBridgeEnvOverrides` | both keys present with value `undefined`; override set otherwise unchanged |
| E18 | hms: model selector | EP | L1 | automated | stored `llmModelOverride` ∈ {absent, "anthropic/claude-sonnet-4" (in list), "openrouter/deepseek/deepseek-v4-flash" (not in list)} | render `HermesMemorySettings`, save without edits | selector `current` = stored value (or empty + DEFAULT badge); PUT body round-trips the value unchanged |
| E19 | hms: model selector clear | state | L1 | automated | stored "anthropic/claude-sonnet-4" | click "Inherit session model", then save | DEFAULT badge shown; PUT body lacks `llmModelOverride` |
| E20 | cms: Settings form | state | L1 | automated | field `search.windowMs` set to 30000 on disk | render, click reset, save | field shows 60000 + DEFAULT badge; PUT body lacks `search.windowMs` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | cms: Settings form | state-transition | L3 | automated | harness with context-mode settings plugin enabled, no settings file | open Settings → General → context-mode section, set search window 30000, save, reload page | section renders; after reload field shows 30000 without DEFAULT badge; GET `/api/plugins/context-mode-settings/config` returns `search.windowMs: 30000` |
| F2 | cms: Settings form (invalid) | state-transition | L3 | automated | harness | type `0` into search hard block, attempt save | inline error visible on the field; GET config still returns default for `search.blockAfter` |
| F3 | hms: model selector | state-transition | L3 | automated | harness with hermes plugin + ≥1 model in `/api/models` | open hermes Model override selector, pick first model, save, reload | field shows `provider/id` of chosen model; hermes config GET returns it |
| F4 | cms: Settings form | visual/subjective | — | manual-only | context-mode settings section in all 4 themes | human looks | [judgment: grouping, notices and badges read clearly; matches hermes section look — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | cms: Validate before writing | fault-injection (abort) | L1 | automated | PUT `{ "search.blockAfter": 0, "fetch.strict": true }` | route call | 400, `errors` has exactly 1 entry for `search.blockAfter`; file bytes identical to before |
| X2 | cms: atomic write | fault-injection (abort) | L1 | automated | rename step throws (mocked fs) | valid PUT | 500; original file unchanged; no temp file left |
| X3 | cms: Corrupt file is ignored | fault-injection | L1 | automated | file contains `{not json` | bridge factory; contributor at spawn; GET route | bridge sets no var and does not throw; contributor returns `{}` + warning logged; GET reports all defaults |
| X4 | cms: Invalid entry in externally edited file | fault-injection | L1 | automated | file `{ "search.blockAfter": -1, "search.windowMs": 30000 }` | contributor at spawn | spawned env has `CONTEXT_MODE_SEARCH_WINDOW_MS=30000`, no `CONTEXT_MODE_SEARCH_BLOCK_AFTER`; one warning names the key |
| X5 | cms: External edit seen on next spawn | state | L1 | automated | file written with `windowMs:30000`, spawn, file rewritten with `windowMs:45000` | second spawn | second spawned env `CONTEXT_MODE_SEARCH_WINDOW_MS=45000` |
| X6 | psec: failing contributor | fault-injection (abort) | L1 | automated | contributor throws / returns `null` / returns `{A:1}` (non-string) | `buildSpawnEnv` | spawn env built; no var from that contributor; one warning per case |
| X7 | cms: Absent file means defaults | fault-injection | L1 | automated | no file, settings dir absent | GET route; bridge; contributor | GET 200 all defaults; bridge/contributor project nothing; no dir/file created by reads |
| X8 | hs: Contaminated server spawns a working session | fault-injection (state) | L2 | automated | dashboard server started with `CONTEXT_MODE_BRIDGE_DEPTH=1 CONTEXT_MODE_BRIDGE_IDLE_MS=0` | spawn headless session via REST | `ps eww <pi pid>` shows neither var; context-mode MCP child process (`server.bundle.mjs`) is running under that pi |
| X9 | hs: Contaminated tmux server | fault-injection (state) | L2 | automated | tmux server started with `CONTEXT_MODE_BRIDGE_DEPTH=1` in its global env | spawn tmux session via REST into that tmux server | pane pi process env (`ps eww`) has no `CONTEXT_MODE_BRIDGE_DEPTH` |
| X10 | cms: stale bridge-projected value | state-transition | L2 | automated | file `fetch.strict:true`; a pi session (bridge loaded) auto-starts the dashboard server; then file set to `fetch.strict:false` | spawn headless session via REST | new pi process env has no `CTX_FETCH_STRICT` and no `PI_CONTEXT_MODE_SETTINGS_PROJECTED` |
| X11 | cms: no split SessionDB | invariant | L2 | automated | file `storage.dataDir:"/tmp/cm-x"` | spawn headless session, run one prompt that triggers a `ctx_*` call | the Pi extension's session DB and the MCP child's session DB are under `/tmp/cm-x` (both `lsof`/open-file listings point there) |
| X12 | cms: operator export precedence | decision-table | L2 | automated | server env `CONTEXT_MODE_TZ=UTC`, file `Europe/Budapest` | spawn headless and tmux sessions | both pi processes have `CONTEXT_MODE_TZ=UTC` |

---

## Coverage summary

- Requirements covered: 12/12. Abbreviations: cms = context-mode-settings (6 requirements), psec = plugin-spawn-env-contributor (3), hs = headless-spawn MODIFIED (1), sl = server-launch MODIFIED (1), hms = hermes-memory-settings ADDED (1).
- Scenarios by class: edge 20 · perf 0 · frontend 4 · error 12
- Scenarios by level: L1 27 · L2 5 · L3 3 · — 1
- Scenarios by disposition: automated 35 · manual-only 1

## New infra needed

- None for L1 and L3.
- L2: X8–X12 need a qa smoke script that can start the dashboard with an injected env and spawn sessions. The existing qa runtime smoke scripts start the server, so extending one is preferred over a new harness.
- X11 requires `lsof` (macOS/Linux only), so it is skipped on Windows.
