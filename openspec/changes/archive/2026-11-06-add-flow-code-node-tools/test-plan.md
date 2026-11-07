# Test Plan — add-flow-code-node-tools

Stage: design   Generated: 2026-11-06

Hard gate passed. The user answered C1–C3 and the answers are folded into specs/flows-plugin/spec.md:
- C1: output cap is a fixed 64 MiB per stream.
- C2: an already-aborted signal gives `code: 130` with no spawn.
- C3: termination resolves within 2 s (SIGTERM, then SIGKILL after a 1 s grace).

L1 home: `packages/flows-plugin/src/bridge/__tests__/`. Run through `npm test`, which sets an ephemeral `HOME`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Flows plugin publishes a tool facade | state-transition | L1 | automated | fake pi with `on` / `events` | call bridge `activate({ pi })` | `globalThis[Symbol.for("pi-dashboard.flow-tools")]` has functions `has`, `resolve`, `run`, `shell` and no `list` |
| E2 | Flows plugin publishes a tool facade | state-transition | L1 | automated | slot published by `activate` | fire the registered `session_shutdown` handler | slot is `undefined`; a second `session_shutdown` does not throw |
| E3 | Flows plugin publishes a tool facade | state-transition | L1 | automated | slot cleared by `session_shutdown` | fire the registered `session_start` handler | slot holds a facade again |
| E4 | Facade resolves any registered tool by name | equivalence partitioning | L1 | automated | live default registry (test host has git, node, bash) | `has("git")`, `has("node")`, `has("bash")`, `has("not-a-registered-tool")` | `true`, `true`, `true`, `false` |
| E5 | Facade resolves any registered tool by name | equivalence partitioning | L1 | automated | live default registry | `resolve("git")` and `resolve("not-a-registered-tool")` | first is an absolute path (`path.isAbsolute`); second is `null`; neither throws |
| E6 | Facade resolves any registered tool by name | equivalence partitioning | L1 | automated | a registered `env` probe-kind tool (path-less resolution) | `resolve(<env tool name>)` | `null` |
| E7 | Facade runs registered tools without throwing | equivalence partitioning | L1 | automated | live registry | `await run("git", ["--version"])` | `{ ok: true, code: 0 }`, `out` matches `/git version/` |
| E8 | Facade runs registered tools without throwing | equivalence partitioning | L1 | automated | spy on the `platform/exec.js` `spawn` | `await run("not-a-registered-tool")` | resolves `{ ok: false, code: 127 }`; spawn spy called 0 times |
| E9 | Facade runs registered tools without throwing | equivalence partitioning | L1 | automated | `AbortController` aborted before the call; spawn spy | `await run("git", ["--version"], { signal })` and `await shell("echo x", { signal })` | each resolves `{ ok: false, code: 130 }` with no measurable delay; spawn spy called 0 times |
| E10 | Facade runs registered tools without throwing | equivalence partitioning | L1 | automated | registered `kind: "module"` tool (for example `node-pty` dir) | `await run(<module tool>)` | resolves `ok: false`; the promise does not reject |
| E11 | Facade run and shell stop runaway children | BVA (timeoutMs) | L1 | automated | `timeoutMs` ∈ {0, -1, NaN, Infinity} | `await shell("sleep 1", { timeoutMs })` | each resolves `ok: true` after about 1 s (no timeout applied) |
| E12 | Facade run and shell stop runaway children | BVA (output cap) | L1 | automated | script writing 64 MiB − 1 byte to stdout | `await shell(<script>)` | `ok: true`, `stdout.length` === 64 MiB − 1 |
| E13 | Facade run and shell stop runaway children | BVA (output cap) | L1 | automated | script writing 64 MiB + 1 MiB to stdout | `await shell(<script>)` | `ok: false`, `stdout.length` ≤ 64 MiB, resolves within 2 s of crossing the cap |
| E14 | Facade shell runs bash without login profiles | decision table | L1 | automated | `process.env.BASH_ENV` = temp script that runs `echo PROFILE >&2`; `HOME` with `.bash_profile` and `.bashrc` doing the same | `await shell("echo hi")` | `ok: true`, `stdout.trim()` === `"hi"`, `stderr` does not contain `PROFILE` |
| E15 | Facade shell runs bash without login profiles | decision table | L1 | automated | `BASH_ENV` set explicitly in `opts.env` to a temp script that runs `echo FROM_ENV` | `await shell("true", { env: { BASH_ENV: <script> } })` | `stdout` contains `FROM_ENV` (an explicit caller value is kept) |
| E16 | Facade shell runs bash without login profiles | equivalence partitioning | L1 | automated | executable `fake-tool` (prints `fake 1.0`) placed only in `MANAGED_BIN` under the test `HOME`; not on PATH | `await shell("fake-tool")` | `ok: true`, `stdout` contains `fake 1.0` |
| E17 | flow_write carries dashboard-only guidance | decision table | L1 | automated | `systemPromptOptions { selectedTools: ["read","flow_write"], toolGuidelines: {} }` | fire `before_agent_start` twice | `toolGuidelines.flow_write` has length 1, and it contains `Symbol.for("pi-dashboard.flow-tools")` and an `if (tools)` guard |
| E18 | flow_write carries dashboard-only guidance | decision table | L1 | automated | `systemPromptOptions { selectedTools: ["read","bash"], toolGuidelines: {} }` | fire `before_agent_start` | `toolGuidelines` has no `flow_write` key and no other key changed |
| E19 | flow_write carries dashboard-only guidance | decision table | L1 | automated | `systemPromptOptions { selectedTools: ["flow_write"], toolGuidelines: { flow_write: ["existing"] } }` | fire `before_agent_start` | `toolGuidelines.flow_write` is `["existing", <guideline>]` (appends, preserves prior) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Facade runs registered tools without throwing (async, design D3) | threshold | L1 | automated | `await shell("sleep 1")` while a 100 ms `setInterval` counts ticks | ≥ 8 ticks recorded before the call resolves (event loop not blocked) | single call, about 1 s |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Flows plugin publishes a tool facade (end to end, real pi-flows) | state-convergence | L3 | automated | harness fixture flow `e2e/tools` with one `code` node whose handler runs `tools.run("git", ["--version"])` and calls `ctx.setSummary(r.out)` | launch the flow from the card (`Search flows...` → `tools` → `flow-launch-run`) | the flow card reaches terminal `success`, and the code step shows a summary matching `/git version/` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Facade run and shell stop runaway children | fault-injection (delay) | L1 | automated | child that never exits, with a grandchild: `sleep 30 & echo $! > <pidfile>; wait` | `await shell(<script>, { timeoutMs: 500 })` | resolves `ok: false` within 2 s after 500 ms; `process.kill(<grandchild pid>, 0)` throws `ESRCH` |
| X2 | Facade run and shell stop runaway children | fault-injection (abort) | L1 | automated | same never-exiting script with a grandchild | `controller.abort()` 300 ms after calling `shell(<script>, { signal })` | resolves `ok: false` within 2 s of the abort; the grandchild pid gives `ESRCH` |
| X3 | Facade resolves any registered tool by name | fault-injection (abort) | L1 | automated | registry stub whose `resolve` and `resolveExecutor` throw `Error("boom")` | `resolve("git")`, `await run("git")`, `await shell("true")` | `null`, `{ ok: false, code: 127 }`, `{ ok: false, code: 127 }`; nothing throws |
| X4 | Flows plugin publishes a tool facade | fault-injection (abort) | L1 | automated | `getDefaultRegistry` mocked to throw | call bridge `activate({ pi })` | `activate` does not throw; slot stays unset; other bridge contributions (prompt adapter emit) still happen |
| X5 | flow_write carries dashboard-only guidance | fault-injection (abort) | L1 | automated | `before_agent_start` event with `systemPromptOptions` undefined, and one with `toolGuidelines` frozen (`Object.freeze`) | fire the handler | handler returns without throwing in both cases |

---

## Coverage summary

- Requirements covered: 6/6
- Scenarios by class: edge 19 · perf 1 · frontend 1 · error 5
- Scenarios by level: L1 25 · L2 0 · L3 1
- Scenarios by disposition: automated 26 · manual-only 0

## New infra needed

- L3 F1: one new harness fixture flow under `docker/fixtures/sample-git/.pi/flows/flows/e2e/tools/` (`flow.yaml` plus code handler). This extends the existing fixture set (`e2e/slow`, `e2e/fanout`); no new harness.
