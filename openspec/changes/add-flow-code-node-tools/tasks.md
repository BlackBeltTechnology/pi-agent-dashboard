# Tasks

## 1. Flow-tools facade (tests first, then implementation)

Test file `packages/flows-plugin/src/bridge/__tests__/flow-tool-registry.test.ts`. Harness exemplar: `packages/flows-plugin/src/bridge/__tests__/bridge-entry.test.ts` (fake pi plus `activate`). Run via `npm test` (ephemeral `HOME`).

- [ ] 1.1 Test E1 (test-plan #E1): fake pi with on and events · call bridge activate · the pi-dashboard.flow-tools global slot has has, resolve, run, shell functions and no list. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.2 Test E2 (test-plan #E2): slot published by activate · fire the registered session_shutdown handler · slot is undefined and a second session_shutdown does not throw. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.3 Test E3 (test-plan #E3): slot cleared by session_shutdown · fire the registered session_start handler · slot holds a facade again. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.4 Test E4 (test-plan #E4): live default registry · has for git, node, bash and not-a-registered-tool · true, true, true, false. Exemplar: `packages/shared/src/tool-registry/__tests__/` registry tests.
- [ ] 1.5 Test E5 (test-plan #E5): live default registry · resolve git and resolve not-a-registered-tool · first is an absolute path, second is null, neither throws. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.6 Test E6 (test-plan #E6): a registered env probe-kind tool with path-less resolution · resolve that tool · null. Exemplar: `packages/shared/src/tool-registry/__tests__/` registry tests.
- [ ] 1.7 Test E7 (test-plan #E7): live registry · await run git --version · ok true, code 0, out matches git version. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.8 Test E8 (test-plan #E8): spy on the platform/exec.js spawn · await run not-a-registered-tool · resolves ok false, code 127, spawn spy called 0 times. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.9 Test E9 (test-plan #E9): AbortController aborted before the call plus spawn spy · run git --version and shell echo x with that signal · each resolves ok false, code 130, spawn spy called 0 times. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.10 Test E10 (test-plan #E10): registered module-kind tool (node-pty dir) · await run that tool · resolves ok false and the promise does not reject. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.11 Test E11 (test-plan #E11): timeoutMs of 0, -1, NaN, Infinity · await shell sleep 1 with each · each resolves ok true after about 1 s. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.12 Test E12 (test-plan #E12): script writing 64 MiB minus 1 byte to stdout · await shell of it · ok true and stdout length equals 64 MiB minus 1. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.13 Test E13 (test-plan #E13): script writing 65 MiB to stdout · await shell of it · ok false, stdout length at most 64 MiB, resolves within 2 s of crossing the cap. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.14 Test E14 (test-plan #E14): BASH_ENV pointing at a script that echoes PROFILE to stderr plus HOME with .bash_profile and .bashrc doing the same · await shell echo hi · ok true, stdout hi, stderr without PROFILE. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.15 Test E15 (test-plan #E15): BASH_ENV set explicitly in opts.env to a script echoing FROM_ENV · await shell true with that env · stdout contains FROM_ENV. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.16 Test E16 (test-plan #E16): executable fake-tool printing fake 1.0 placed only in MANAGED_BIN under the test HOME · await shell fake-tool · ok true and stdout contains fake 1.0. Exemplar: `packages/shared/src/platform/__tests__/` binary-lookup tests.
- [ ] 1.17 Test P1 (test-plan #P1): await shell sleep 1 while a 100 ms setInterval counts ticks · call in flight · at least 8 ticks recorded before it resolves. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.18 Test X1 (test-plan #X1): never-exiting script that backgrounds sleep 30 and writes the grandchild pid to a file · await shell with timeoutMs 500 · resolves ok false within 2 s after 500 ms and process.kill of the grandchild pid with signal 0 throws ESRCH. Exemplar: `packages/shared/src/platform/__tests__/` process tests.
- [ ] 1.19 Test X2 (test-plan #X2): same never-exiting script with a grandchild · controller.abort 300 ms after calling shell with that signal · resolves ok false within 2 s of the abort and the grandchild pid gives ESRCH. Exemplar: `packages/shared/src/platform/__tests__/` process tests.
- [ ] 1.20 Test X3 (test-plan #X3): registry stub whose resolve and resolveExecutor throw boom · resolve git, run git, shell true · null, then ok false code 127 twice, nothing throws. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.21 Test X4 (test-plan #X4): getDefaultRegistry mocked to throw · call bridge activate · activate does not throw, slot stays unset, prompt adapter emit still happens. Exemplar: `__tests__/bridge-entry.test.ts`.
- [ ] 1.22 Implement `packages/flows-plugin/src/bridge/flow-tool-registry.ts` per design D1–D4 and D6. Exports `publishFlowTools()`, `clearFlowTools()`, `FLOW_TOOLS_SYMBOL_KEY`. The facade over `getDefaultRegistry()` offers `has` / `resolve` (no `list`) and async `run` / `shell` with these details:
  - spawn via the `platform/exec.js` `spawn` and `resolveExecutor().argv`
  - env from `buildSpawnEnvForArgv` over `new ToolResolver().buildSpawnEnv(process.env)` plus `opts.env`
  - POSIX detached, with `killProcessGroup` at `timeoutMs: 1000`
  - fixed 64 MiB cap per stream
  - codes 127 and 130
  - shell uses `bash --noprofile --norc -c` with inherited `BASH_ENV` / `ENV` stripped

  Verify: tasks 1.1–1.21 pass under `npm test`.
- [ ] 1.23 Wire into `packages/flows-plugin/src/bridge/index.ts`: publish on activate and every `session_start`, clear on `session_shutdown`, all wrapped so `activate` never throws. Verify: 1.1–1.3 and 1.21 pass, and the existing `__tests__/bridge-entry.test.ts` still passes.
- [ ] 1.24 Add a `flow-tool-registry.ts` row and a `__tests__/flow-tool-registry.test.ts` row to `packages/flows-plugin/src/bridge/AGENTS.md`, and extend the `index.ts` row. Verify: the rows exist in path-alphabetical order.

## 2. flow_write guideline (tests first, then implementation)

Test file `packages/flows-plugin/src/bridge/__tests__/flow-tools-guideline.test.ts`. Harness exemplar: `packages/roles-plugin/src/bridge/__tests__/bridge-entry.test.ts` (fake pi `fire(systemPromptOptions)`).

- [ ] 2.1 Test E17 (test-plan #E17): systemPromptOptions with selectedTools read and flow_write and empty toolGuidelines · fire before_agent_start twice · toolGuidelines.flow_write has length 1 and contains the pi-dashboard.flow-tools symbol and an if (tools) guard. Exemplar: `packages/roles-plugin/src/bridge/__tests__/bridge-entry.test.ts`.
- [ ] 2.2 Test E18 (test-plan #E18): systemPromptOptions with selectedTools read and bash · fire before_agent_start · no flow_write key and no other key changed. Exemplar: `packages/roles-plugin/src/bridge/__tests__/bridge-entry.test.ts`.
- [ ] 2.3 Test E19 (test-plan #E19): selectedTools flow_write and toolGuidelines.flow_write already holding existing · fire before_agent_start · flow_write equals existing followed by the guideline. Exemplar: `packages/roles-plugin/src/bridge/__tests__/bridge-entry.test.ts`.
- [ ] 2.4 Test X5 (test-plan #X5): before_agent_start event with systemPromptOptions undefined, and one with frozen toolGuidelines · fire the handler · returns without throwing in both. Exemplar: `packages/roles-plugin/src/bridge/__tests__/bridge-entry.test.ts`.
- [ ] 2.5 Implement `packages/flows-plugin/src/bridge/flow-tools-guideline.ts` per design D5. It exports `startFlowToolsGuideline(pi)` and `FLOW_TOOLS_GUIDELINE`. The guideline text carries the literal guard snippet with a fallback branch, the methods and the result shape; it appends once, only when `flow_write` is selected, inside try/catch. Wire it into `bridge/index.ts` activate. Verify: tasks 2.1–2.4 pass and `__tests__/bridge-entry.test.ts` still passes.
- [ ] 2.6 Add a `flow-tools-guideline.ts` row and a `__tests__/flow-tools-guideline.test.ts` row to `packages/flows-plugin/src/bridge/AGENTS.md`. Verify: the rows exist.

## 3. End-to-end through real pi-flows

- [ ] 3.1 Test F1 (test-plan #F1): harness fixture flow e2e/tools whose code node runs tools.run git --version and calls ctx.setSummary with the output · launch it from the card via Search flows, tools, flow-launch-run · flow card reaches terminal success and the code step summary matches git version. Add the fixture under `docker/fixtures/sample-git/.pi/flows/flows/e2e/tools/` (copy the shape of `e2e/slow/`). Exemplar: `tests/e2e/flow-roundtrip.spec.ts` (gate, pick flow, terminal state) and `tests/e2e/flow-fanout-decision.spec.ts` (code-node fixture flow).
