## Why

The dashboard's entire reason to exist is monitoring and driving live pi sessions: a prompt goes in, a model streams text / thinking / tool calls back, the bridge forwards those events, the server fans them out, and the client renders them. **None of that round-trip is tested.** The QA suite (`qa/tests/01-09`) proves install, server start, WebSocket handshake, terminal, git, and Electron bootstrap — but never sends a prompt through a session and asserts the streamed assistant events arrive and render. The archived QA work (`cross-platform-qa-vms`, `expand-electron-qa-coverage`) and the active `server-launch-smoke-suite` all stop at "server is up"; the model-call surface is dark.

The reason is real: a clean VM (or CI box) has no API key and no model, so nothing can exercise a prompt → response. Today the unit tests that touch renderers (`ChatView.test.tsx`, `AskUserToolRenderer.test.tsx`, etc.) hand-build props in isolation — they never prove the props that arrive from a *real pi event stream* match what the renderers expect. A schema drift in pi's event shape (e.g. a tool-call delta key rename) passes every existing test and breaks the live dashboard.

pi ships the exact seam to close this gap. `@earendil-works/pi-ai` exports **`registerFauxProvider()`** (`providers/faux.ts`) — a fully scriptable dummy provider that streams real `text_*` / `thinking_*` / `toolcall_*` / `done` / `error` / `aborted` events through pi's normal pipeline, computes a fake usage/cost estimate, supports abort and error stop reasons, and lets each response step be a factory `(context, options, state) => AssistantMessage` that branches on what the agent actually sent. From the bridge's perspective a faux session is **indistinguishable from a real model session** — same events, same order, same shapes — but it is deterministic, free, and needs no API key.

Version check (confirmed against installed tree): the pi runtime QA spawns is `pi-coding-agent@^0.78.0`, which bundles `pi-ai@0.78.0`, which exports all five faux symbols (`registerFauxProvider`, `fauxText`, `fauxThinking`, `fauxToolCall`, `fauxAssistantMessage`). The root tree also carries `pi-ai@0.75.5` which exports the same. The fixture MUST NOT hard-pin its own `pi-ai` — it imports `@earendil-works/pi-ai` and resolves against pi's bundled copy at extension-load time, so it always matches whatever pi version ships.

## What Changes

Two layers, per the cost/value split: most scenarios run as fast in-process Vitest tests; one thin VM smoke proves the flow survives a clean install.

### Shared faux fixture

- Add `qa/fixtures/faux-provider.ext.ts` — a pi extension that calls `registerFauxProvider()` and reads its scripted response steps from an env var (`FAUX_SCRIPT`, a JSON-encoded scenario id or inline script) so a single fixture file drives every scenario. Default model id `faux/faux-1`, `tokensPerSecond` configurable via env for streaming-cadence scenarios.
- Add `qa/fixtures/faux-scenarios.ts` — the scenario catalog: each entry is `{ id, script: FauxResponseStep[], expect }`, composed from `fauxText` / `fauxThinking` / `fauxToolCall` / `fauxAssistantMessage`. Shared by the server-side and client-side test layers so both assert against the *same* event stream.

### Server-side integration tests (Vitest, `packages/server`)

- Add `packages/server/src/__tests__/faux-session.integration.test.ts` — spawns a real `pi` subprocess with `-e qa/fixtures/faux-provider.ext.ts --model faux/faux-1`, connects it to a real in-process dashboard server, **drives the prompt through the REST API** (the same endpoint the browser uses), and asserts the events that arrive on the browser `/ws` gateway.
- Coverage: prompt accepted → assistant text streams back → status transitions (`thinking`/`running` → `idle`) → usage/cost surfaces → run lifecycle (start/end) → abort via API mid-stream yields an `aborted` event and clears the run → model error (`stopReason: "error"`) surfaces without hanging → two concurrent faux sessions stay isolated.

### Client-side renderer integration tests (Vitest + jsdom, `packages/client`)

- Add `packages/client/src/components/__tests__/faux-renderers.integration.test.tsx` — feeds the **same faux-produced event streams** (captured from the scenario catalog) into `ChatView` and asserts every renderer in the registry mounts with real data:
  - tool-renderers: `read`, `edit`, `write`, `bash`, `ctx_*` (→ `CtxToolRenderer`), `agent`, and an unknown tool (→ `GenericToolRenderer` fallback).
  - interactive renderers via `ask_user` tool calls, one per `method`: `confirm`, `select`, `multiselect`, `input`, `editor`, `batch`, `notify`, and an unknown method (→ `GenericInteractiveRenderer`).
- The `ask_user` scenarios are the bidirectional case: faux emits the `ask_user` tool call → the client renders the interactive prompt → the test submits the answer via the API → a faux **factory step reads the answer from `context`** and emits a follow-up text → the test asserts the answer round-tripped (not merely that the prompt rendered).

### One VM QA smoke

- Add `qa/tests/10-faux-model.sh` — in a clean VM (no API key, managed Node), spawn `pi -e <fixture> --model faux/faux-1`, drive one happy-path prompt via the dashboard API, assert the streamed text reaches the browser WS. Registered in `qa/tests/run-all.sh`. This is the *only* VM-level faux test — its job is "the faux flow works on a fresh box", not protocol correctness (that lives in Vitest).

### Documentation

- Add `qa/fixtures/README.md` documenting the fixture, the scenario catalog shape, and how to add a scenario.
- Add a `docs/file-index-*` row per new file (delegated, caveman style).

## Capabilities

### Added Capabilities

- `faux-model-integration-tests`: a deterministic, key-free integration layer that drives prompt → model → event → renderer round-trips using pi's built-in `registerFauxProvider`, covering the full event vocabulary, every tool-renderer, and every `ask_user` interactive renderer, plus one clean-env VM smoke.

## Impact

- **Files (new)**:
  - `qa/fixtures/faux-provider.ext.ts`
  - `qa/fixtures/faux-scenarios.ts`
  - `qa/fixtures/README.md`
  - `packages/server/src/__tests__/faux-session.integration.test.ts`
  - `packages/client/src/components/__tests__/faux-renderers.integration.test.tsx`
  - `qa/tests/10-faux-model.sh`
- **Files (modified)**:
  - `qa/tests/run-all.sh` — register `10-faux-model.sh`.
- **No production code changes.** This proposal only adds tests and fixtures; it exercises existing renderer/registry/event-wiring architecture and must not modify it.

## Open Questions

- Spawn mechanism for the server-side test: reuse `spawnPiSession` / `process-manager` so the test exercises the real spawn path, or spawn pi directly for hermeticity? Leaning on a direct `child_process` spawn with the bridge extension present, to keep the test independent of the platform-specific spawn-mechanism selection (tmux/wt/keeper) which is already covered elsewhere.
- Whether `--model faux/faux-1` injection needs a `SessionOptions.model` / extension flag added to `sessionFlagsToArgv` (currently it only emits session-file flags). For the Vitest layer this is avoided by direct spawn; if the VM smoke drives spawn through the dashboard API, a `model` + `extension` flag passthrough may be a prerequisite — to be confirmed in the design/tasks phase.
