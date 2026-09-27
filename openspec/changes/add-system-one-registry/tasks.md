# Tasks: add-system-one-registry

TDD order: in every group, the test tasks come first and must fail before the implementation task makes them pass.
- Every test task carries its `test-plan.md` id and its Triple: input · trigger · observable.
- Library tests live in `packages/system-one/src/__tests__/`.
- Plugin tests live in `packages/system-one-plugin/src/**/__tests__/`.
- L3 specs live in `tests/e2e/`.
- No test contacts `api.typesafe.ai`.

## 1. Scaffold and test infrastructure

- [x] 1.1 Create `packages/system-one`:
  - name `@blackbelt-technology/pi-system-one`, Node built-ins only, ESM, published public (`publishConfig.access: public`; the plugin ships and resolves it from npm);
  - `vitest.config.ts` with `pool:"forks"` and the shared `setup-home` globalSetup (see `packages/goal-plugin/vitest.config.ts`), so tests never touch the real `~`;
  - register it in the root vitest projects.

  Verify: `npm test -- --project system-one` runs an empty suite green; `pnpm install` keeps the lockfile consistent.
- [ ] 1.2 Create `packages/system-one-plugin`, a dashboard plugin with server and client entries and the `settings-section` claim. Verify: `GET /api/plugins` lists it after `curl -X POST http://localhost:8000/api/restart`.
- [x] 1.3 Build the fake backend helper `src/__tests__/helpers/fake-backend.ts`. It provides a loopback `node:http` server with scripted replies (answer, delay, socket destroy, 302, 404), a connection counter, and an off-machine-URL interceptor that records requests without real network. Copy the listen-on-0 glue from `packages/server/src/__tests__/model-proxy-second-port.test.ts`. Verify: a self-test scripts one reply and asserts the connection count.
- [ ] 1.4 Build the fake engine script `packages/system-one-plugin/src/server/__tests__/fixtures/fake-engine.mjs`. It serves `/v1/models` (200 or 404) and `/v1/systemone`, can trap SIGTERM, and can stay unhealthy. Verify: a self-test spawns it, gets a 200, and kills it.
- [ ] 1.5 Add `AGENTS.md` for both packages and their `src/` dirs, one row per file (caveman style, `See change: add-system-one-registry`). Verify: `kb dox lint` reports no missing rows.

## 2. Config (spec: system-one-config)

Exemplar for this group: `packages/kb/src/__tests__/config-doctrine.test.ts`.

- [x] 2.1 Test layering (test-plan #E12). user {valid, invalid JSON, absent, `version:2`} × project {valid, invalid, absent} × project arg {none, trusted:false, trusted:true} · load · precedence holds, the project applies only with `trusted:true`, one `[system-one]` warning per bad layer/version per process. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.2 Test project override limits (test-plan #E13). A trusted project sets `allowOffMachine`, `backends.evil`, `activePreset`, `calibration.x` and consumer chain `[local-von]` · load · only the chain applies; 4 warnings; `backends.evil` absent. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.3 Test that a project cannot retarget to hosted (test-plan #E14). User switch `true`; backends `jev` (off-machine) and `von` (loopback); project chain `["jev","von"]` · load + `predict` · effective chain `["von"]`, 1 warning names `jev`, the fake jev sees 0 connections. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.4 Test prototype pollution (test-plan #E15). A project with `consumers.__proto__.allowOffMachine=true`, plus `constructor`/`prototype` at depth 1 and 4 · load, then read · `allowOffMachine` is `false`; `({}).allowOffMachine === undefined`; 1 warning per dropped key. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.5 Test shape handling (test-plan #E16). Managed port 18401; managed with no port; `llm` with `capabilities`; backend with `apiKey`/`token` · load + `predict` · the managed URL is `http://127.0.0.1:18401/v1/systemone`; portless → `no-backend`; `llm` capabilities used; the fake sees no `Authorization` from key-like fields, plus a warning. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.6 Test key sources (test-plan #E17). env `TYPESAFE_API_KEY` {set, unset} × file entry {set, unset} × `keyRef` {explicit, catalog, none} · `predict` · Bearer = env, else file; no `keyRef` → no header; created file mode 0600. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.7 Test atomic key write (test-plan #E18). `auth.json` holds K1 · write K2 with `rename` throwing · the file still holds K1 intact, with no partial file. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 2.8 Implement `src/config.ts` (null-prototype parse, forbidden-key drop, layering, trust gate, on-machine-only project chains, mtime cache, warnings) and `src/keys.ts`. Verify: 2.1–2.7 pass.

## 3. Adapter core (spec: system-one-adapter)

Exemplar for this group: `packages/server/src/__tests__/model-proxy-second-port.test.ts` plus the fake backend helper from 1.3.

- [x] 3.1 Test the predict contract (test-plan #E1). The fake answers one `choice` over `{a,b}` and one `noul` · `predict` · `ok:true`, `choice ∈ {a,b}`, `noul ∈ [0,1]`, `thresholds` = `{}`. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.2 Test response validation (test-plan #E2). Fake 1 answers with undeclared key `c`, score -0.1, score = levels, noul 1.01, or a missing question id; fake 2 is valid · `predict` chain `[f1,f2]` · `backendId:"f2"`, and attempt 1 is `error` in each case. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.3 Test the consumer id pattern (test-plan #E3). ids `a`, 128-char, 129-char, `A`, `-x`, `x y`, empty · `predict` · the first two proceed; the rest are `ok:false reason:"error"` with 0 fake connections. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.4 Test the context capability boundary (test-plan #E4). `maxContextTokens:512`; state 2,044 / 2,048 / 2,052 chars · `predict` chain `[small,big]` · at or under 512 tokens `small` answers; over it, `small` is skipped `capability` and `big` answers. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.5 Test the option capability boundary (test-plan #E5). `maxOptions:5` with 5 / 6 options; `unknown` with 200 · `predict` · 5 sent; 6 skipped `capability`; `unknown` never skips. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.6 Test host egress classification (test-plan #E6). hosts `localhost`, `127.0.0.2`, `[::1]`, `::ffff:127.0.0.1`, `localhost.`, `10.0.0.5`, `example.com` × switch {absent, false, true} · `predict` · only the first 3 are on-machine; the others see 0 intercepted requests unless `true`. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.7 Test `llm` egress (test-plan #E7). Stub `LlmCaller` `isLocal` {true, false, throws} × switch {false, true} · `predict` chain `["llm"]` · called only for `isLocal:true` or switch `true`; otherwise `off-machine` with 0 stub calls. See `packages/dashboard-plugin-runtime/src/__tests__/server-context-model-runtime.test.ts`.
- [x] 3.8 Test chain resolution (test-plan #E8). {consumer override, preset chain, none} × an undefined id in the override · `predict` · override > preset > `no-backend`; the undefined id is dropped with 1 warning per process. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.9 Test mode (test-plan #E9). calibration {none, A::c shadow, A::c enforce m1, enforce m1 with answer m2} × answering {A, B} · `predict` · `enforce` + thresholds only for (A, m1 = m1); every other cell `shadow`. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.10 Test self-registration (test-plan #E10). First call; an identical repeat; a changed `failurePolicy`; two ids · `predict` · one 0600 file per id under `consumers/`; the repeat leaves the mtime unchanged; a change rewrites the file. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 3.11 Test timeout fall-through (test-plan #X1). Fake 1 delays 2,100 ms; fake 2 fine · `predict` · `backendId:"f2"`, attempt 1 `timeout`, total < 2,300 ms. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.12 Test the `llm` timeout with an uncooperative caller (test-plan #X2). The stub never resolves and ignores the signal; fake timers · `predict` chain `["llm"]` · `ok:false reason:"timeout"` at 15,000 ms. See `packages/dashboard-plugin-runtime/src/__tests__/server-context-model-runtime.test.ts`.
- [x] 3.13 Test transport abort (test-plan #X3). Fake 1 destroys the socket mid-response · `predict` `[f1,f2]` · f2 answers; f1 `error`; f1 hit exactly once. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.14 Test redirect exfiltration (test-plan #X4). A loopback fake answers `302` to an intercepted remote · `predict` · the interceptor sees 0 requests; the attempt is `error`. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.15 Test caller abort (test-plan #X5). Chain `[slow, fast]`; abort at 50 ms · `predict` · `ok:false reason:"timeout"`; `fast` sees 0 connections. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.16 Test all-fail → policy (test-plan #X6). Every entry fails; policies {fail-open, fail-closed, deterministic} · `predict` · `ok:false` with the declared `policy`, `reason` = last failure. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.17 Test no config (test-plan #X7). No `system-one.json`; the fake is listening · `predict` · `ok:false reason:"no-backend"`, 0 connections. See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [x] 3.18 Implement `src/predict.ts`, `src/backends/http.ts` (`redirect:"error"`, scheme allowlist), `src/backends/llm.ts` (`LlmCaller`, own timer), `src/capabilities.ts`, `src/egress.ts` and `src/registry.ts`. Verify: 3.1–3.17 pass.
- [x] 3.19 Test the overhead budget (test-plan #P1). 1,000 sequential `predict` calls, an instant fake, 5 questions, 2 KB state, log on · timed run · adapter overhead p95 ≤ 5 ms (assert on p95). See `packages/server/src/__tests__/model-proxy-second-port.test.ts`.
- [ ] 3.20 Test the config re-read (test-plan #P2). 1,000 `predict` calls with an unchanged config · spy on `readFile` · 1 read; after touching the mtime, 2 reads. See `packages/kb/src/__tests__/config-doctrine.test.ts`.

## 4. Decision log (spec: system-one-adapter)

- [x] 4.1 Test the log content (test-plan #E11). State with `SECRET-MARKER`, instructions with `INSTR-MARKER` · 3 `predict` calls · `decisions/<date>.<pid>.jsonl` at 0600 with 3 lines holding distributions, attempts, `model`, `mode` and the state sha256; neither marker present. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 4.2 Test write-failure tolerance (test-plan #X8). `decisions/` and `consumers/` read-only · `predict` · still `ok:true`, no throw. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 4.3 Test retention (test-plan #X9). Log files dated 29/30/31 days ago · library load · the 31-day file is deleted; 29 and 30 are kept. See `packages/kb/src/__tests__/config-doctrine.test.ts`.
- [x] 4.4 Implement `src/decision-log.ts`. Verify: 4.1–4.3 pass.

## 5. Plugin server API (specs: system-one-config, system-one-settings-ui)

Exemplar for this group: `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts` (Fastify `inject`).

- [ ] 5.1 Test built-in preset seeding (test-plan #E19). No config file · first `PUT` of the UI seed · the file has `hosted` + `local-only`, `activePreset:"local-only"`, `allowOffMachine:false`. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.2 Test that config reads hide keys (test-plan #E20). Key `ts_TESTKEY123` stored · `GET /api/system-one/config` and `GET /keys` · neither body contains the key or any 4+ char prefix of it; they show `set`, `source:"file"`. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.3 Test revision + merge (test-plan #E21). A file with hand-added `backends.x.timeoutMs` and top-level `note` · `PUT {config, baseRevision}` matching, then stale · match → managed keys replaced, `note` byte-identical; stale → 409 with the file sha unchanged. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.4 Test the calibration route (test-plan #E22). A supervisor port persist, then a calibration save with the pre-persist revision · `POST /api/system-one/calibration` · 409 and the port kept; with a fresh revision only `calibration["jev::c"]` changes. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.5 Test URL validation (test-plan #E23). `file:///etc/passwd`, `data:,x`, `javascript:1`, `ftp://h`, `https://h/v1/systemone` · `PUT` · the first 4 → 400; https accepted. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.6 Test the catalog (test-plan #E24). Backends `jev-1.13.0`, `laya`, an unknown id, `laya` with `maxContextTokens:1000` · `GET /config` · spec'd values; unknown → all `unknown`; the override wins; jev has `keyRef:"TYPESAFE_API_KEY"` and price 0.042; every backend carries a server-computed `offMachine` (an `llm` backend whose role resolves to a hosted provider → `true`). See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.7 Test the consumer list (test-plan #E25). 2 valid files, 1 invalid JSON, 1 with missing fixtures, no selftest file · `GET /api/system-one/consumers` · selftest always listed; 2 valid; invalid skipped; missing fixtures → Test disabled with a reason. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.8 Test the eval report and case cap (test-plan #E26). 499 / 500 / 501 cases, deterministic fake · `POST .../eval` · the fake gets 499 / 500 / 500 requests; the report has accuracy, noul AUC and p50/p90; cost = 0.042 × chars ÷ 4 ÷ 1e6. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.9 Test eval egress + the enforce confirmation (test-plan #E27). backend {loopback, off-machine} × switch {false, true} × save {shadow, enforce+confirm, enforce no confirm} · eval, then save · off-machine + false is refused with 0 fake requests; enforce without confirmation writes nothing; with confirmation the record's `model` = the run's model string; a `managed` backend not `ready` is refused with 0 fake requests. See `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`.
- [ ] 5.10 Implement `src/server/` (routes behind `networkGuard`, revision + managed-key merge, calibration merge, catalog, consumer listing, eval runner using an `LlmCaller` built on `ctx.modelRuntime` whose `isLocal` is `false` unless the provider is on-machine) and `src/server/fixtures/selftest.json` (≥ 20 cases over all three primitives). Verify: 5.1–5.9 pass.

## 6. Managed backends (spec: system-one-managed-backends)

Exemplar for this group: `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`, plus the fake engine from 1.4.

- [ ] 6.1 Test port pick (test-plan #E28). 18400–18402 busy, the dashboard on 18403, another backend on 18404 · add a portless backend · picks 18405 and persists it; never 8000 or 8080. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.2 Test a busy configured port (test-plan #E29). Port 18420 held by another listener · Start · `failed` with `port-in-use`; the config port stays 18420; spawn not called. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.3 Test platform + launcher (test-plan #E30). platform {darwin, linux, win32} × `uv` {present, absent} · status + Start · win32 → `unsupported-platform`; no uv → `unavailable`; spawn called 0 times. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.4 Test argv (test-plan #E31). Von and Laya, port 18410, checkpoint `typed-decisions` · install + Start with an injected spawn · install env `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR` sit under `~/.pi/agent/system-one/tools/`; Von argv[0] = `<bin>/von` and the argv holds `--host 127.0.0.1 --port 18410`; Laya argv = `[<bin>/laya-serve]` with env `LAYA_HOST=127.0.0.1`, `LAYA_PORT=18410`, `LAYA_MODELS=typed-decisions`; no `shell`. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.5 Test health + failure (test-plan #X10). Fake engine {`/v1/models` 200; 404 then valid systemone; never healthy}; fake clock · Start · `ready`; `ready` via fallback; `failed` at 120 s with 50 log lines kept. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.6 Test a crash (test-plan #X11). The `ready` fake engine is killed externally · next `predict` on it · status `failed`; the attempt fails in < 50 ms as `error`; the chain continues. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.7 Test stop escalation (test-plan #X12). The fake engine traps SIGTERM · Stop · SIGTERM, then SIGKILL at 10 s (fake clock); the process is gone and the PID file removed. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.8 Test orphan cleanup (test-plan #X13). A matching live child's PID file, and a PID file whose PID was reused by an unrelated process · plugin start · the first is terminated; the unrelated process is still alive; both PID files removed. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.9 Test lifecycle binding (test-plan #X14). 2 running children; one backend has `autostart:true` · shutdown hook, then boot · both gone after shutdown; only the autostart backend starts on boot. See `packages/server/src/spawn-process/__tests__/headless-pid-registry-plugin-ref.test.ts`.
- [ ] 6.10 Implement `src/server/supervisor.ts` (uv install into the owned tool dir, direct engine spawn, health probe with fallback, PID files with start time + argv, port persistence via re-read-merge). Verify: 6.1–6.9 pass.
- [ ] 6.11 Verify the engine package names and CLI flags for Von and Laya (`von serve`, `laya-serve`: host, port, checkpoint), and whether each serves `/v1/models`. Pin the verified versions in the catalog. Verify: the catalog entries cite the checked versions.
- [ ] 6.12 Manual: real engine end to end (test-plan: manual-only, #X15). On macOS with `uv`, start a Laya managed backend, run the selftest eval, then stop it. Expect `ready`, eval p50 < 500 ms, and `pgrep -f laya-serve` empty after Stop.

## 7. Settings UI (spec: system-one-settings-ui)

Exemplar for this group: `tests/e2e/blackhole-settings.spec.ts` (docker harness; read the port from `.pi-test-harness.json`). Draft-source wiring follows `packages/grammar-plugin/src/GrammarSettings.tsx`.

- [ ] 7.1 Implement `src/client/` against the approved mockup `openspec/changes/add-system-one-registry/mockups/` (`index.html` + `ui-plan.md`; design D13): the settings section registered via `useSettingsDraftSource`, pickers via `ui:model-selector`, a chain editor adapted from `packages/blackhole-plugin/src/client/ChainEditor.tsx` (focus stays on a moved entry), override seeding without incompatible backends, and theme-token classes only. Verify: `npm run build && curl -X POST http://localhost:8000/api/restart`; the section renders under Settings; the mockup probe still passes (`node openspec/changes/add-system-one-registry/mockups/ux-probe.cjs <mockup-url> /tmp/s1-probe` → `SCORE 68/68`) when copy or states change in the mockup first.
- [ ] 7.2 E2E Save Bar integration (test-plan #F1). A seeded `system-one.json` · reorder the chain, switch the preset, host Save · the Save Bar names "Decision models", then dismisses; `GET /config` reflects both edits; exactly 1 `PUT`. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.3 E2E stale draft (test-plan #F2). Page loaded, then an external revision change · edit + Save · the Save Bar shows a conflict with a reload affordance; the file keeps the external change. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.4 E2E off-machine gating (test-plan #F3). Backends `jev` + `von` · toggle `allowOffMachine` off/on · off: `jev` disabled in every picker and the `hosted` preset warning shown; on: both enabled, no warning. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.5 E2E compatibility filter (test-plan #F4). Consumer `requires.maxOptions:60`; backend `laya` · open the override picker, toggle "show incompatible" · hidden by default, revealed with a warning; choosing "Override" seeds the preset chain minus incompatible backends. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.6 E2E key entry (test-plan #F5). No key, then an env key in the harness · enter and submit · a `type=password` input that clears and shows `set`; the DOM never holds the key; with an env key it shows `source: env` and no overwrite control. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.7 E2E Test + enforce confirm (test-plan #F6). The selftest consumer against a loopback fake in the harness · Run Test → Save as enforce · accuracy/AUC/p50/p90 render; the confirm names backend + model; cancel writes nothing; confirm writes the record. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.8 E2E fail-open + llm warning (test-plan #F7). A `fail-open` consumer whose chain includes `llm` · open the override · a warning is shown next to the chain. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.9 E2E accessibility (test-plan #F8). The section in both themes (dark `:root`, light `[data-theme="light"]`; see `ui-contract.md`) · axe scan + keyboard Tab · 0 violations; every control operable with the keyboard. See `tests/e2e/blackhole-settings.spec.ts`.
- [ ] 7.10 Manual: visual fit with the other settings sections on desktop and mobile (test-plan: manual-only, #F9).

## 8. Cross-change, docs, verification

- [ ] 8.1 Amend `openspec/changes/unify-context-manager/design.md` D11:
  - the adapter becomes `@blackbelt-technology/pi-system-one`;
  - per-step routing maps to per-consumer overrides with ids `context-manager:<step>`;
  - "nothing configured → default LLM" becomes the consumer's `failurePolicy` plus an optional `llm` chain entry;
  - the query-shape rules stay.

  Verify: `openspec validate unify-context-manager` passes; the diff touches only D11.
- [ ] 8.2 Delegate to DocScribe: `docs/system-one.md` covering the config reference, how to write a consumer (declaration + `predict` + applying the failure policy), and the egress and trust model. Add rows in `docs/AGENTS.md`. Verify: `grep -n "allowOffMachine" docs/system-one.md` hits.
- [ ] 8.3 Full verification:
  - `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` passes;
  - `npm run test:e2e` passes for the 7.x specs;
  - `npm run quality:changed` is clean;
  - `openspec validate add-system-one-registry` passes;
  - run the `review-code` skill on the diff.
