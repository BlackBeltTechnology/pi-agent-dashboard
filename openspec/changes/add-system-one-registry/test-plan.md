# Test Plan — add-system-one-registry

Stage: design   Generated: 2026-09-26

No open clarifications. The design-stage hard gate passed: every Triple below fills from the specs.

Fake backends are `node:http` servers on an ephemeral loopback port. A "remote" backend is the same fake, addressed through a non-loopback URL whose connection the test intercepts, so egress is asserted with zero real network. Nothing in L1 or L3 contacts `api.typesafe.ai`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | adapter: Single predict contract | EP | L1 | automated | fake answers one `choice` over `{a,b}` + one `noul` | `predict` | `ok:true`, `choice ∈ {a,b}`, `noul ∈ [0,1]`, `thresholds` = `{}` |
| E2 | adapter: response validation | EP (invalid classes) | L1 | automated | fake 1 answers with undeclared key `c`; fake 2 is valid | `predict` with chain `[f1,f2]` | `backendId:"f2"`; log attempt 1 `outcome:"error"`. Repeat for score `-0.1`, score `levels`, noul `1.01`, missing question id: each counts as `error` |
| E3 | adapter: consumer id pattern | BVA | L1 | automated | ids `a`, 128-char valid, 129-char, `A`, `-x`, `x y`, empty | `predict` | the first two proceed; the rest return `ok:false reason:"error"`, and the fake sees 0 connections |
| E4 | adapter: capability check | BVA | L1 | automated | backend `maxContextTokens:512`; state of 2,044 / 2,048 / 2,052 chars, question ≤ 4 chars | `predict` chain `[small, big]` | 2,044 → `small` answers; 2,052 → `small` skipped `capability`, `big` answers (boundary at 512 tokens incl. longest question) |
| E5 | adapter: capability check | BVA | L1 | automated | `maxOptions:5`; choice with 5 / 6 options; `maxOptions:"unknown"` with 200 options | `predict` | 5 sent; 6 skipped `capability`; `unknown` never skips |
| E6 | adapter: off-machine | decision table | L1 | automated | hosts `localhost`, `127.0.0.2`, `[::1]`, `::ffff:127.0.0.1`, `localhost.`, `10.0.0.5`, `example.com` × `allowOffMachine` {absent, false, true} | `predict` | the first 3 are on-machine and always sent; the rest (incl. IPv4-mapped and trailing dot) are off-machine: 0 connections unless `true` |
| E7 | adapter: llm egress | decision table | L1 | automated | stub `LlmCaller` with `isLocal` {true, false, throws} × switch {false, true} | `predict` chain `["llm"]` | sent only for `isLocal:true`, or switch `true`; `false`/throws → `off-machine` with switch `false`, and the stub records 0 calls |
| E8 | adapter: chain resolution | decision table | L1 | automated | {consumer override, preset chain, none} × {override names undefined id} | `predict` | override wins, else preset, else `no-backend`; undefined id dropped with 1 warning per process |
| E9 | adapter: mode | decision table | L1 | automated | calibration {none, A::c shadow, A::c enforce model m1, A::c enforce model m1 but answer model m2} × answering {A, B} | `predict` | `enforce` + thresholds only for (A, m1 = m1); every other cell `shadow` |
| E10 | adapter: self-register | EP | L1 | automated | first call; second identical call; call with changed `failurePolicy`; two ids | `predict` | one file per id under `consumers/`, mode 0600; the identical repeat does no write (mtime unchanged); a changed declaration rewrites it |
| E11 | adapter: decision log | EP | L1 | automated | state containing `SECRET-MARKER`, instructions containing `INSTR-MARKER` | 3 `predict` calls | file `decisions/<date>.<pid>.jsonl`, 0600, 3 lines, each with distributions, attempts, `model`, `mode`, state sha256; neither marker in the file |
| E12 | config: layering | decision table | L1 | automated | user {valid, invalid JSON, absent, `version:2`} × project {valid, invalid, absent} × project arg {none, trusted:false, trusted:true} | load | precedence holds; project used only with `trusted:true`; one `[system-one]` warning per bad layer/version per process |
| E13 | config: project override limits | EP (invalid) | L1 | automated | trusted project sets `allowOffMachine`, `backends.evil`, `activePreset`, `calibration.x`, consumer chain `[local-von]` | load | only the chain applies; 4 warnings naming each ignored key; `backends.evil` absent |
| E14 | config: project cannot retarget to hosted | decision table | L1 | automated | user switch `true`, backends `jev` (off) + `von` (loopback); project chain `["jev","von"]` | load + `predict` | effective project chain `["von"]`, 1 warning names `jev`; the fake jev sees 0 connections |
| E15 | config: prototype pollution | EP (hostile) | L1 | automated | project `{"presets":{"<active>":{"consumers":{"__proto__":{"allowOffMachine":true}}}}}`; also `constructor`, `prototype` at depth 1 and 4 | load, then read `allowOffMachine` | value `false`; `({}).allowOffMachine === undefined` afterwards; 1 warning per dropped key |
| E16 | config: shape | EP | L1 | automated | `managed` with port 18401; `managed` no port; `llm` with `capabilities`; backend with `apiKey`, `token` | load + `predict` | managed resolves to `http://127.0.0.1:18401/v1/systemone`; portless managed skipped `no-backend`; `llm` capabilities used; key-like fields never sent (fake sees no `Authorization`) + warning |
| E17 | config: key sources | decision table | L1 | automated | env `TYPESAFE_API_KEY` {set, unset} × file entry {set, unset} × backend `keyRef` {explicit, catalog, none} | `predict` | Bearer = env if set, else file; `keyRef` none → no header; created file mode 0600 |
| E18 | config: atomic key write | fault-injection | L1 | automated | existing `auth.json` with key K1 | write K2 with `rename` made to throw | file still holds K1 intact; no partial file |
| E19 | config: built-in presets | EP | L1 | automated | no config file | server `PUT` of the first save from UI seed | file has `hosted` + `local-only`, `activePreset:"local-only"`, `allowOffMachine:false` |
| E20 | settings API: config read hides keys | EP | L1 | automated | key `ts_TESTKEY123` stored | `GET /api/system-one/config`, `GET /keys` | neither body contains `ts_TESTKEY123` or any 4+ char prefix of it; reports `set`, `source:"file"` |
| E21 | settings API: revision + merge | state-transition | L1 | automated | file with hand-added `backends.x.timeoutMs` and top-level `note` | `PUT {config, baseRevision}` matching; then stale `baseRevision` | match → managed keys replaced, `note` byte-identical; stale → 409, file sha unchanged |
| E22 | settings API: calibration route | state-transition | L1 | automated | concurrent: supervisor port persist, then calibration save with the pre-persist revision | `POST /api/system-one/calibration` | 409, persisted port kept; with a fresh revision → only `calibration["jev::c"]` changed |
| E23 | settings API: URL validation | EP (invalid) | L1 | automated | backend URLs `file:///etc/passwd`, `data:,x`, `javascript:1`, `ftp://h`, `https://h/v1/systemone` | `PUT` | the first 4 → 400; https accepted |
| E24 | settings API: catalog | EP | L1 | automated | backends with model `jev-1.13.0`, `laya`, unknown id, `laya` + override `maxContextTokens:1000` | `GET /config` (resolved capabilities) | spec'd catalog values; unknown → all `unknown`; override wins; jev `keyRef:"TYPESAFE_API_KEY"`, price 0.042; every backend has server-computed `offMachine` (`llm` on a hosted role → `true`) |
| E25 | settings API: consumer list | EP | L1 | automated | `consumers/` with 2 valid files, 1 invalid JSON, 1 with a missing fixtures path; no selftest file | `GET /api/system-one/consumers` | selftest always listed; 2 valid listed; invalid skipped; missing fixtures → `testDisabled` with a reason |
| E26 | eval: report + caps | BVA | L1 | automated | fixtures with 499 / 500 / 501 cases, fake answering deterministically | `POST .../eval` | fake receives 499 / 500 / 500 requests; the report has per-question accuracy, noul AUC, p50/p90; cost = 0.042 × chars ÷ 4 ÷ 1e6 |
| E27 | eval: egress + enforce | decision table | L1 | automated | backend {loopback, off-machine} × switch {false, true} × save mode {shadow, enforce + confirm, enforce no confirm} | eval then save | off-machine + false → run refused, fake sees 0 requests; enforce without confirmation → no record written; with confirmation → the record's `model` = model string from the run; `managed` backend not `ready` → run refused, 0 requests |
| E28 | managed: port pick | BVA | L1 | automated | ports 18400–18402 busy, dashboard on 18403, another backend on 18404 | add portless backend | picks 18405, persisted; never 8000/8080 |
| E29 | managed: busy configured port | BVA | L1 | automated | configured port 18420 held by another listener | Start | status `failed`, reason `port-in-use`; config port still 18420; spawn not called |
| E30 | managed: platform + launcher | decision table | L1 | automated | platform {darwin, linux, win32} × `uv` {present, absent} | status + Start | win32 → `unsupported-platform`; no uv → `unavailable`; spawn called 0 times in both |
| E31 | managed: argv | EP | L1 | automated | Von and Laya backends, port 18410, checkpoint `typed-decisions` | install + Start with injected spawn | install env has `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` under `~/.pi/agent/system-one/tools/`; spawn argv[0] = `<bin>/von` (not `uv`), contains `--host 127.0.0.1 --port 18410`, `shell` not set |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | adapter: overhead budget | tail-latency | L1 | automated | 1,000 sequential `predict`, fake backend replies instantly, 5 questions, 2 KB state, log enabled | adapter overhead (total − fake handler time) p95 ≤ 5 ms | 1,000 calls |
| P2 | adapter: config re-read | invariant | L1 | automated | 1,000 `predict` with an unchanged config file | `readFile` count on config = 1 (spy); after touching mtime → 2 | 1,000 calls |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | settings-ui: Save Bar integration | state-transition | L3 | automated | docker harness with a seeded `system-one.json` | reorder chain + switch preset → host Save | Save Bar shows 1 dirty page "Decision models"; after save the bar dismisses; `GET /config` reflects both edits; exactly 1 `PUT` in the network log |
| F2 | settings-ui: stale draft | state-transition | L3 | automated | page loaded; then a `POST /managed/:id/port` (or direct file edit) changes the revision | edit + Save | Save Bar enters `error` with a conflict message + reload affordance; the file keeps the external change |
| F3 | settings-ui: off-machine gating | decision table | L3 | automated | backends `jev` (hosted) + `von` (loopback) | toggle `allowOffMachine` off / on | off: `jev` disabled in every picker, preset `hosted` shows the no-usable-backend warning; on: both enabled, warning gone |
| F4 | settings-ui: compatibility filter | EP | L3 | automated | consumer registered with `requires.maxOptions:60`; backend `laya` (maxOptions 5) | open the consumer override picker; toggle "show incompatible" | hidden by default; the toggle reveals it with a warning; choosing "Override" seeds the preset chain minus incompatible backends |
| F5 | settings-ui: key entry | EP | L3 | automated | no key set; then env key present (harness env) | enter key, submit | input `type=password`; after submit the field clears and shows `set`; the DOM never contains the key text; with an env key it shows `source: env` and no overwrite control |
| F6 | settings-ui: Test + enforce confirm | state-transition | L3 | automated | selftest consumer, loopback fake backend in harness | Run Test → Save as enforce | results table renders accuracy/AUC/p50/p90; the confirm dialog names backend + model; cancel writes nothing; confirm writes the record |
| F7 | settings-ui: fail-open + llm warning | EP | L3 | automated | consumer with `failurePolicy:"fail-open"`, override chain includes `llm` | open the override | warning text shown next to the chain |
| F8 | settings-ui: a11y | invariant | L3 | automated | section rendered in both themes (dark, `data-theme="light"`) | axe scan + keyboard Tab through all controls | 0 axe violations; every control reachable and operable with keyboard only |
| F9 | settings-ui: visual fit with existing settings pages | visual/subjective | — | manual-only | Settings → Decision models, desktop + mobile | human looks | [judgment: spacing, hierarchy and density match sibling settings sections — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | adapter: timeout | fault-injection (delay) | L1 | automated | fake 1 delays 2,100 ms (default http 2,000 ms); fake 2 fine | `predict` | `backendId:"f2"`, attempt 1 `timeout`, total < 2,300 ms |
| X2 | adapter: llm timeout | fault-injection (delay) | L1 | automated | stub `LlmCaller` ignores the signal and never resolves; fake timers | `predict` chain `["llm"]` | resolves `ok:false reason:"timeout"` at 15,000 ms of fake time |
| X3 | adapter: transport abort | fault-injection (abort) | L1 | automated | fake 1 destroys the socket mid-response | `predict` chain `[f1,f2]` | f2 answers; f1 attempt `error`; f1 hit exactly once (no retry) |
| X4 | adapter: redirect exfil | fault-injection | L1 | automated | loopback fake answers `302 Location: http://<intercepted-remote>/` | `predict` | remote interceptor sees 0 requests; attempt `error` |
| X5 | adapter: caller abort | fault-injection | L1 | automated | chain `[slow, fast]`, caller aborts `signal` at 50 ms | `predict` | `ok:false reason:"timeout"`, `fast` sees 0 connections |
| X6 | adapter: all fail → policy | fault-injection | L1 | automated | every chain entry fails, consumer policies {fail-open, fail-closed, deterministic} | `predict` | `ok:false` with `policy` equal to the declared value, `reason` = last failure |
| X7 | adapter: no config | fault-injection | L1 | automated | no `system-one.json`, fake listening | `predict` | `ok:false reason:"no-backend"`, fake connection count 0 |
| X8 | adapter: log + registry write failures | fault-injection | L1 | automated | `decisions/` and `consumers/` made read-only | `predict` | still `ok:true`; no throw |
| X9 | adapter: log retention | state-transition | L1 | automated | log files dated 29, 30, 31 days ago | library load | 31-day file deleted; 29/30 kept |
| X10 | managed: health + failure | fault-injection | L1 | automated | fake engine (node script) {serves `/v1/models` 200; 404 then valid systemone; never healthy} with fake clock | Start | `ready`; `ready` via fallback probe; `failed` at 120 s with the last 50 log lines kept |
| X11 | managed: crash | fault-injection (abort) | L1 | automated | `ready` fake engine process killed externally | next `predict` on that backend | status `failed`; the attempt fails fast (< 50 ms) as `error`; chain continues |
| X12 | managed: stop escalation | state-transition | L1 | automated | fake engine traps SIGTERM | Stop | SIGTERM, then SIGKILL at 10 s (fake clock); process gone; PID file removed |
| X13 | managed: orphan cleanup | state-transition | L1 | automated | PID file of a live real child (matching PID + start time + argv); second PID file with PID reused by an unrelated live process (start time differs) | plugin start | the first is terminated; the unrelated process is not signalled (still alive); both PID files removed |
| X14 | managed: lifecycle binding | state-transition | L1 | automated | 2 running managed children; one backend has `autostart:true` | server shutdown hook; then boot | both children gone after shutdown; on boot only the autostart backend starts |
| X15 | managed: real engine end-to-end | fault-injection (real) | — | manual-only | macOS with `uv`, real Laya package download | Start → selftest eval → Stop | [judgment: real multi-GB download + third-party engine behaviour on a dev machine; verify `ready`, eval p50 < 500 ms, `pgrep -f laya-serve` empty after Stop — not stable in CI] |

---

## Coverage summary

- Requirements covered: 26/26 (adapter 10, config 6, settings-ui 6, managed 4)
- Scenarios by class: edge 31 · perf 2 · frontend 9 · error 15
- Scenarios by level: L1 47 · L2 0 · L3 8
- Scenarios by disposition: automated 55 · manual-only 2

## New infra needed

- A fake System-1 backend helper (`packages/system-one/src/__tests__/helpers/fake-backend.ts`): a loopback `node:http` server with scripted responses, connection counting and an off-machine-URL interceptor. It is shared by the plugin tests.
- A fake engine script (`packages/system-one-plugin/src/server/__tests__/fixtures/fake-engine.mjs`) that the supervisor tests spawn as a real child for PID, start-time, signal and health behaviour.
- The L3 docker harness needs the fake backend reachable from the container (run it inside the harness or on the container loopback). No new harness type.
