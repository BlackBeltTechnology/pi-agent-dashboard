## 1. Shared faux fixture + scenario catalog

- [x] 1.1 Add `qa/fixtures/faux-provider.ext.ts`: default-export `(pi) => { ... }` extension that calls `registerFauxProvider({ provider: "faux", models: [{ id: "faux-1", input: ["text","image"] }], tokensPerSecond: Number(process.env.FAUX_TPS ?? 50) })`. Import `registerFauxProvider`/`fauxText`/`fauxThinking`/`fauxToolCall`/`fauxAssistantMessage` from `@earendil-works/pi-ai` with NO version in the fixture's own deps (resolve against pi's bundled copy).
- [x] 1.2 Fixture reads `process.env.FAUX_SCRIPT` (scenario id), looks the script up in `faux-scenarios.ts`, and calls `faux.setResponses(script)`. Unknown/missing id → `setResponses([fauxAssistantMessage("faux: no scenario")])` so a misconfigured run fails loud, not hangs.
- [x] 1.3 Add `qa/fixtures/faux-scenarios.ts`: export `SCENARIOS: Record<string, { script: FauxResponseStep[]; expect: {...} }>`. Compose every scenario from the faux helpers. Keep `script` pure data + factories so both test layers import it without spawning.
- [x] 1.4 Verify `faux/faux-1` is selectable with no API key: `pi -e qa/fixtures/faux-provider.ext.ts --list-models | grep faux-1`. Record the exact `--model` token form (`faux/faux-1` vs `faux-1`) for downstream tasks.

## 2. Server-side integration test (`packages/server`)

- [x] 2.1 Add `packages/server/src/__tests__/faux-session.integration.test.ts`. Boot an in-process dashboard server on ephemeral ports (reuse existing server test harness if one exists; else start `createServer` with random ports + isolated `HOME` via `mktemp`).
- [x] 2.2 Spawn a real pi subprocess: `child_process.spawn("pi", ["-e", "<fixture-abs>", "--model", "<token>"], { env: { ...process.env, FAUX_SCRIPT: id, PI_DASHBOARD_* pointing at the test server } })`. Bridge extension must be present so the session auto-registers. Await `session_register` on the pi gateway before driving.
- [x] 2.3 Drive the prompt through the REST API (the same endpoint the browser uses — confirm the route in `session-api.ts`). Subscribe a browser-side `/ws` client and collect events.
- [x] 2.4 Assert happy path: `text_delta` events for the scripted text arrive; status goes busy→idle; usage/cost surfaces; run start/end fires. Use scenario `plain-text`.
- [x] 2.5 Assert abort: scenario `slow-stream` (`FAUX_TPS=2`), issue abort via API mid-stream, expect `aborted` event + cleared run.
- [x] 2.6 Assert model error: scenario `model-error` (`fauxAssistantMessage(_, { stopReason: "error" })`), expect error event on `/ws`, session not stuck busy.
- [x] 2.7 Assert isolation: two faux sessions, distinct prompts, each `/ws` stream contains only its own events.
- [x] 2.8 Teardown: kill pi subprocess(es) + close server in `afterEach`/`afterAll`; trap zombie pids. Guard the whole suite behind a `pi`-on-PATH probe → `describe.skip` with a clear message when pi is absent (so `npm test` on a bare box doesn't red-fail).

## 3. Client-side renderer integration test (`packages/client`)

- [x] 3.1 Add `packages/client/src/components/__tests__/faux-renderers.integration.test.tsx`. Build event streams from `faux-scenarios.ts` (no subprocess — translate each `script` into the chat event sequence `ChatView` consumes, or capture once from the server layer into a JSON fixture).
- [x] 3.2 Tool-renderer matrix: one scenario per registered tool name (`read`, `edit`, `write`, `bash`, a `ctx_*`, `agent`) + one unknown name. Render `ChatView`, assert the mapped renderer mounted (query by a stable testid/role each renderer already exposes — reuse the selectors from existing per-renderer unit tests). Assert unknown → `GenericToolRenderer`.
- [x] 3.3 Interactive-renderer matrix: one `ask_user` scenario per `method` (`confirm`/`select`/`multiselect`/`input`/`editor`/`batch`/`notify`) + one unknown method. Assert the matching interactive renderer mounts; unknown → `GenericInteractiveRenderer`.
- [x] 3.4 ask_user round-trip — folded into server suite §2 (answer-submit path is server-mediated `prompt_response` over `/ws`); pointer left in client test header: scenario `ask-select-roundtrip` — first step `fauxToolCall("ask_user", { method:"select", options:["a","b"] })`, second step a factory that reads the answer from `context` and emits `fauxText("you picked <answer>")`. In the client test, submit the answer via the renderer's action path, assert the follow-up text renders. (If the answer-submit path requires the server, fold this assertion into the server suite §2 instead and leave a pointer here.)

## 4. VM QA smoke

- [x] 4.1 Add `qa/tests/10-faux-model.sh`: source nvm, ensure server running (start if needed), spawn `pi -e <fixture> --model <token>` with `FAUX_SCRIPT=plain-text`, drive one prompt via the dashboard API, poll the browser WS (Node + `ws`) for the scripted text, assert presence. `set -euo pipefail` + trap cleanup (kill pi, stop server).
- [x] 4.2 Register `10-faux-model.sh` in `qa/tests/run-all.sh` TESTS array. Note in a comment it skips (exit 0 + `SKIP:` first line) when `pi` is not on PATH, matching the existing SKIP convention.

## 5. Prerequisite check: model/extension flag passthrough

- [x] 5.1 RESOLVED: VM smoke (`10-faux-model.sh`) spawns pi DIRECTLY via node `child_process` (bypasses dashboard spawn API), so `sessionFlagsToArgv` (emits only `--session`/`--fork`) needs no `--model`/`-e` passthrough. No production-code change; no follow-up change scoped. Confirm whether the VM smoke drives spawn via the dashboard API (needs `--model` + `-e` passthrough) or spawns pi directly. If via API: check `sessionFlagsToArgv` in `packages/shared/src/platform/spawn-mechanism.ts` — it currently emits only session-file flags. If passthrough is needed, scope a minimal `SessionOptions.model` + `extensions` addition as a SEPARATE follow-up change (do not bundle production-code changes into this test-only proposal).

## 6. Documentation

- [x] 6.1 Add `qa/fixtures/README.md`: fixture purpose, scenario-catalog shape, how to add a scenario, the `FAUX_SCRIPT`/`FAUX_TPS` env contract, the confirmed `--model` token form.
- [x] 6.2 Delegate to a subagent: add caveman-style file-index rows for all new files under the matching `docs/file-index-*.md` splits (server, client, skills-misc/qa). Path-alphabetical.

## 7. Verification

- [x] 7.1 `openspec validate add-faux-model-integration-tests` passes.
- [x] 7.2 Verified: both new suites pass with pi on PATH (server 5, client 17); server suite `describe.skip`s cleanly when pi bin absent (5 skipped, 0 failed); `npm run lint` (tsc --noEmit) reports 0 errors.
- [x] 7.3 Every tool-renderer (read/edit/write/bash/Agent/ctx_*/ask_user/unknown→Generic) and every `ask_user` method (confirm/select/multiselect/input/editor/batch/notify/unknown→Generic) has a mounting + dispatch assertion.
- [x] 7.4 No production source changed (git diff touches only `qa/`, `packages/*/__tests__/`, `docs/`, `openspec/`).
