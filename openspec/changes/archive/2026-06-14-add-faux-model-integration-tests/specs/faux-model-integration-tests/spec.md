# faux-model-integration-tests (ADDED)

## ADDED Requirements

### Requirement: Shared faux fixture and scenario catalog

The repo SHALL provide a single pi extension fixture and a scenario catalog that both the server-side and client-side test layers consume, so a faux event stream is defined once and asserted in both places.

- `qa/fixtures/faux-provider.ext.ts` SHALL register a faux provider via `registerFauxProvider()` from `@earendil-works/pi-ai`, exposing model id `faux/faux-1`.
- The fixture SHALL import `@earendil-works/pi-ai` with no version pin of its own, so it resolves against the pi runtime's bundled copy at extension-load time.
- The fixture SHALL select its scripted response steps from a scenario id passed via env (`FAUX_SCRIPT`), so one fixture file drives every scenario.
- `qa/fixtures/faux-scenarios.ts` SHALL export a catalog where each entry is `{ id, script, expect }` and `script` is a `FauxResponseStep[]` composed from `fauxText` / `fauxThinking` / `fauxToolCall` / `fauxAssistantMessage`.

#### Scenario: Fixture resolves pi's bundled pi-ai

- **WHEN** a pi session loads `qa/fixtures/faux-provider.ext.ts`
- **THEN** `registerFauxProvider` resolves from the same `@earendil-works/pi-ai` version the running pi bundles
- **AND** model `faux/faux-1` is selectable with no API key configured

#### Scenario: Catalog shared by both layers

- **WHEN** a scenario is added to `qa/fixtures/faux-scenarios.ts`
- **THEN** the server-side and client-side integration tests both reference that single catalog entry
- **AND** the event stream asserted in each layer derives from the same `script`

### Requirement: Server-side prompt round-trip coverage

`packages/server` SHALL include a Vitest integration test that spawns a real pi subprocess driven by the faux fixture, drives a prompt through the dashboard REST API, and asserts the streamed events arriving on the browser `/ws` gateway.

- The test SHALL drive the prompt via the same REST endpoint the browser uses (not by passing the prompt as pi argv).
- The test SHALL assert: assistant text streams back; status transitions to a busy state then back to idle; usage/cost is surfaced; the run start/end lifecycle fires.
- The test SHALL cover abort: an abort issued via the API mid-stream yields an `aborted` event and clears the active run.
- The test SHALL cover model error: a faux step with `stopReason: "error"` surfaces an error event and the session does not hang.
- The test SHALL cover isolation: two concurrent faux sessions do not cross-contaminate events.

#### Scenario: Prompt streams assistant text

- **WHEN** the test POSTs a prompt to a faux-backed session via the REST API
- **THEN** `text_delta` events for the scripted response arrive on `/ws`
- **AND** the session status returns to idle after `done`
- **AND** a usage/cost value is reported

#### Scenario: Abort mid-stream

- **GIVEN** a faux scenario with a low `tokensPerSecond` so the stream is slow
- **WHEN** the test issues an abort via the API before the stream completes
- **THEN** an `aborted` event is emitted
- **AND** the active run is cleared (no lingering busy status)

#### Scenario: Model error surfaces

- **WHEN** a faux step returns `stopReason: "error"`
- **THEN** an error event reaches `/ws`
- **AND** the session is not left in a permanent busy state

#### Scenario: Concurrent sessions stay isolated

- **WHEN** two faux-backed sessions each receive a distinct prompt
- **THEN** each session's `/ws` stream contains only its own scripted events

### Requirement: Client-side renderer coverage from faux streams

`packages/client` SHALL include a Vitest + jsdom integration test that feeds faux-produced event streams into `ChatView` and asserts every renderer in the tool-renderer registry and every `ask_user` interactive renderer mounts with real event data.

- Tool-renderers covered: `read`, `edit`, `write`, `bash`, the `ctx_*` family (asserting dispatch to `CtxToolRenderer`), `agent`, and an unknown tool name (asserting `GenericToolRenderer` fallback).
- Interactive renderers covered: one `ask_user` call per `method` — `confirm`, `select`, `multiselect`, `input`, `editor`, `batch`, `notify` — and an unknown method (asserting `GenericInteractiveRenderer` fallback).
- The test SHALL NOT modify renderer or registry source; it only exercises the existing dispatch.

#### Scenario: Each tool-renderer mounts from a faux tool call

- **WHEN** a faux scenario emits `fauxToolCall("<name>", args)` for each registered tool name
- **THEN** `ChatView` mounts the renderer mapped to that name in `tool-renderers/registry.ts`
- **AND** an unknown tool name mounts `GenericToolRenderer`

#### Scenario: Each interactive renderer mounts from an ask_user call

- **WHEN** a faux scenario emits `fauxToolCall("ask_user", { method, ... })` for each method
- **THEN** `ChatView` mounts the interactive renderer for that method
- **AND** an unknown method mounts `GenericInteractiveRenderer`

### Requirement: ask_user answer round-trip

The integration layer SHALL prove that an answer submitted to an `ask_user` prompt round-trips back into the agent context, using a faux factory step that branches on the submitted answer.

#### Scenario: Answer flows back into the next response

- **GIVEN** a faux scenario whose first step emits `ask_user` with method `select` and a follow-up factory step
- **WHEN** the test submits an answer via the API
- **THEN** the answer appears as a tool result in the agent context
- **AND** the factory step reads the answer and emits a follow-up text reflecting it
- **AND** the follow-up text reaches the consumer (server `/ws` or rendered `ChatView`)

### Requirement: Clean-environment VM smoke

The VM QA suite SHALL include exactly one faux-backed smoke test proving the prompt round-trip works on a fresh install with no API key.

- `qa/tests/10-faux-model.sh` SHALL spawn `pi` with the faux fixture and `--model faux/faux-1`, drive one happy-path prompt via the dashboard API, and assert the streamed text reaches the browser WS.
- The script SHALL be registered in `qa/tests/run-all.sh`.
- The VM layer SHALL carry only this single happy-path smoke; the full scenario matrix lives in the Vitest layers.

#### Scenario: Faux prompt round-trip on a clean VM

- **WHEN** `qa/tests/10-faux-model.sh` runs on a freshly provisioned VM with no model API key
- **THEN** a faux-backed pi session connects to the dashboard
- **AND** a prompt driven via the API produces assistant text on the browser WS
- **AND** the script exits 0
