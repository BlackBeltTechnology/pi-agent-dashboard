# Test Plan — test-trust-audit

Stage: design   Generated: 2026-09-13

Requirement refs: `COV` = specs/test-coverage-reporting; `BD` = specs/bridge-decomposition (ADDED + MODIFIED); `BE` = specs/bridge-extension (MODIFIED multiselect lint); `PTE` = specs/parallel-test-execution (ADDED); `D#` = design decision.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | COV unloaded file at zero | EP (loaded vs unloaded) | L1 | automated | root vitest config with the coverage block; a fixture-free check that `coverage.include` covers `packages/*/src/**/*.{ts,tsx}` and `reportOnFailure === true` | import the root config and read `test.coverage` | `include` matches `packages/extension/src/bridge.ts` and not `packages/extension/src/__tests__/x.test.ts`, `test-support/x.ts`, `packages/electron/src/x.ts`, `x.d.ts`; `reportOnFailure` is `true`; `provider` is `v8` |
| E2 | COV unloaded file at zero (end-to-end) | BVA on "0 tests load it" | ci | automated | `npm run test:coverage` on the extension project in CI (`vitest run --project … --coverage`) | job reads `coverage/coverage-summary.json` | an entry for `packages/extension/src/bridge.ts` exists with `lines.pct === 0` before the extraction slice lands, and after it exists with `lines.pct > 0`; package `total.lines.total` includes its lines |
| E3 | COV wrapper protects real home | decision-table (script has wrapper / not) | L1 | automated | root `package.json` `scripts["test:coverage"]` string | parse the script | contains `HOME=$(mktemp -d -t pi-test-` and `--localstorage-file=` and `--coverage` (same guard shape as the existing script-wrapper tests) |
| E4 | BD handler runs against stub instance | EP per module | L1 | automated | each of `lifecycle.ts`, `dispatch.ts`, `forwarders.ts`, `ui-prompt-patch.ts` imported directly; stub `pi` (records `on`/`sendMessage` calls), fresh `createInstance(pi, 1, {})` | invoke one representative handler per module (e.g. `session_start` with `reason: "start"`, `handleInboundMessage(inst, {type:"stop_after_turn"})`) | handler executes; only `inst`/`inst.shared` fields change; `vi.mock` registry shows `bridge.ts` was never loaded (assert via `import.meta` spy / module-graph check that `../bridge.ts` is absent from loaded modules) |
| E5 | BD inbound message reaches same branch | decision table over 21 `msg.type` values | L1 | automated | one stub `inst` + stub `pi` per case; each of the 21 message types with a minimal valid payload | `handleInboundMessage(inst, msg)` | per row: the expected pi call / outbound message / state field (captured from the pre-extraction handler in the same test file as a table: e.g. `stop_after_turn` → `inst.shared.shouldStopAfterTurn === true`; `set_thinking_level` → `pi.setThinkingLevel` called with payload; `credentials_updated` → `activateProviderRegister` re-run; unknown type → no call, no throw) |
| E6 | BD extracted modules never import entry point | source-scan | L1 | automated | `packages/extension/src/bridge-handlers/*.ts` | read each file's import specifiers | none resolves to `../bridge.ts` / `./bridge.js` |
| E7 | BD guard retargeted (negative check) | mutation-style | L1 | automated | `tui-prompt-adapter.ts` source + an in-test mutated copy with `else if (prompt.type === "multiselect" && originals.custom)` appended | run the retargeted `no-tui-multiselect-arm-regression` predicate on both strings | original → pass; mutated → fail |
| E8 | BD source-scanning guards follow moved code (all 10 readers) | EP over readers | L1 | automated | list of 10 test files that `readFileSync` a bridge path (from proposal) | for each, the pattern it searches for | pattern found in the file the test now reads (a meta-test: for each reader, extract its target path + needle, assert needle present) — prevents vacuous pass |
| E9 | BD MODIFIED session-sync delegation | state | L1 | automated | `lifecycle.ts` `session_start` with stub `session-sync` module mocked | `session_start` fires with `reason: "resume"` | `handleSessionChange` from `session-sync` invoked once with the instance's session id |
| E10 | D4 kept grep tests carry `@structural-pin` | source-scan | L1 | automated | every `*.test.ts(x)` under `packages/**/__tests__` that contains `readFileSync(` on a `.ts`/`.tsx` path | read the describe block's JSDoc | contains `@structural-pin ` followed by ≥10 non-space chars; files lacking it are listed in the failure message |
| E11 | PTE no test file in both projects | set-intersection | L1 | automated | resolved `include`/`exclude` of `packages/client/vitest.config.ts` and `vitest.node.config.ts` | glob both against `packages/client/src` | intersection is empty; union equals the pre-change jsdom include set (no file dropped) |
| E12 | PTE node project imports worker module | source-scan | L1 | automated | `packages/client/vitest.node.config.ts` text | grep | contains `from "../../vitest.workers"` and no `maxWorkers:` numeric/string literal (extend the existing `vitest.workers` single-source guard test) |
| E13 | PTE DOM test stays in jsdom | EP | L1 | automated | a client test that calls `render()` from `@testing-library/react` (e.g. `ChatView` suite) | resolve which project's include matches it | matches jsdom project only |
| E14 | D7 shared heavy files split | BVA on per-file duration | L1 (timed) | automated | `vitest run --project shared --reporter=json` | read per-file `duration` | no file among the three split groups exceeds 10 000 ms; assertion count across the split files equals the pre-split count (recorded constant in the test) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | D8 measure-only | before/after | — | manual-only | `npm test` client + client-node + shared projects on the reference machine | wall, `environment`, `import` totals recorded in design `## Measurements` — no threshold (user decision) | 1 run before hygiene slice, 3 runs after |
| P2 | PTE isolate gate — 3 consecutive green | soak | ci | automated | `vitest run --project @blackbelt-technology/pi-dashboard-web` ×3 on the gate commit | 3/3 exit 0 | CI job matrix `run: [1,2,3]` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | PTE leaves no shared state (order independence) | state-convergence | ci | automated | jsdom client project | `vitest run --project … --sequence.shuffle --sequence.seed=<fixed>` and a second seed | both exit 0 with the same passed/failed counts as the default order |
| F2 | PTE per-file HOME under `isolate:false` | invariant | L1 | automated | two client test files in the same worker that each write `$HOME/.pi/marker-<file>` | run with `isolate:false` | each file sees only its own marker; `process.env.HOME` differs between the two files |
| F3 | PTE per-fork localStorage under `isolate:false` | invariant | L1 | automated | two client test files that write `localStorage.setItem("k", <file>)` | run with `isolate:false`, shuffled | on entry each file reads `localStorage.getItem("k") === null` (hygiene restores) |
| F4 | D6 shared setup restores `localStorage` replacement | state-transition | L1 | automated | a test that assigns `globalThis.localStorage = stub` | `afterEach` from the shared setup runs | `localStorage.clear` is a function again and `Object.getOwnPropertyDescriptor(globalThis,"localStorage")` equals the original |
| F5 | D6 default `ThemeProvider` in shared render | EP | L1 | automated | a component calling `useThemeContext()` rendered via the shared `render` helper without an explicit provider | render | no "must be used within ThemeProvider" throw; theme is the default |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | COV report survives failing test | fault-injection (failing test) | ci | automated | a deliberately failing test injected via `--testNamePattern` on a known-red fixture, or `vitest run --coverage` on a project with one `it.fails`-inverted test | run `test:coverage` | exit code ≠ 0 AND `coverage/coverage-summary.json` exists and is non-empty |
| X2 | BD reload takeover keeps old instance inert | state-transition (illegal edge) | L1 | automated | one shared `BridgeState` `{generation: 1}`; `instA = createInstance(pi, 1, shared)`, `instB = createInstance(pi, 2, shared)`; `shared.generation = 2`; handlers from `lifecycle.ts` wired to both | fire `turn_end` on both | `instA.isActive() === false` and A's handler sends nothing; B's handler sends `turn_end`-driven message once |
| X3 | BD cross-reload values adopted, not defaulted | state-transition | L1 | automated | `shared = {generation:1, sessionId:"S1", attachedChange:"c1", shouldStopAfterTurn:true}`; `initBridge`-equivalent adoption path exercised via `createInstance(pi, 2, shared)` | read `inst.shared` after creation | `sessionId === "S1"`, `attachedChange === "c1"`, `shouldStopAfterTurn === true` |
| X4 | BD subagent re-entry guard unchanged | illegal edge | L1 | automated | `shared = {generation:1, pi: piA}`; call the default export with `piB` | default export | returns without bumping `generation` (still 1) and without registering listeners on `piB` (existing test if present — extend, don't duplicate) |
| X5 | BD inbound dispatch on unknown type | robustness | L1 | automated | `{type: "__nope__"}` | `handleInboundMessage` | no throw; no pi call; no outbound message |
| X6 | BD `session_start` with `ctx.hasUI === false` | decision-table (hasUI) | L1 | automated | stub ctx `hasUI:false` | `session_start` | `ui-prompt-patch` not invoked; PromptBus TUI adapter not registered; dashboard adapter still registered |
| X7 | PTE misclassified pure test fails loudly, not silently | fault-injection | L1 | automated | a test file in the node include set that references `document` | run node project | fails with `ReferenceError: document is not defined` (so D5's verify-by-running step catches it) |

---

## Coverage summary

- Requirements covered: 14/14 (COV 3/3 scenarios blocks; BD 5 ADDED + 1 MODIFIED; BE 1 MODIFIED lint; PTE 3 ADDED; design D4/D6/D7/D8)
- Scenarios by class: edge 14 · perf 2 · frontend 5 · error 7
- Scenarios by level: L1 22 · ci 5 · manual-only 1
- Scenarios by disposition: automated 27 · manual-only 1

## New infra needed

- `ci`: a coverage job (or step) in `ci.yml` that runs `npm run test:coverage --project <one project>` and asserts on `coverage-summary.json` (E2, X1), plus a 3× matrix step for the isolate gate (P2, F1). Existing `ci.yml` has neither; extend it, do not add a workflow file.
- No new L2/L3 infra. No Playwright scenarios: nothing in this change is rendered-UI.
