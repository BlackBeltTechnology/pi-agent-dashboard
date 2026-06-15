# Faux-model test fixtures

Deterministic, key-free model fixtures for the faux-model integration tests. A
faux session is indistinguishable from a real model session to the bridge —
same `text_*` / `thinking_*` / `toolcall_*` / `done` / `error` / `aborted`
events, same order — but scripted, free, and needs no API key.

Used by three layers, all sharing the one scenario catalog:

- `packages/server/src/__tests__/faux-session.integration.test.ts` — spawns a
  real `pi` subprocess, drives prompts via the dashboard REST API, asserts the
  events on the browser `/ws` gateway.
- `packages/client/src/components/__tests__/faux-renderers.integration.test.tsx`
  — feeds the catalog's tool/`ask_user` scripts into `ChatView`, asserts every
  renderer mounts.
- `qa/tests/10-faux-model.sh` — one VM smoke for the happy-path round-trip.

## Files

- `faux-provider.ext.ts` — pi extension that registers the faux provider and
  selects a scripted response from `FAUX_SCRIPT`.
- `faux-scenarios.ts` — the scenario catalog: `SCENARIOS[id] = { script, expect }`.

## How the fixture works

`registerFauxProvider()` (from `@earendil-works/pi-ai`) registers only a stream
implementation in pi-ai's api-registry — it does **not** put the model in pi's
CLI catalog. The fixture pairs it with `pi.registerProvider("faux", { ... })`
to surface `faux/faux-1` in `--list-models` and make it selectable via
`--model faux/faux-1`.

The faux stream is passed to `pi.registerProvider` as `streamSimple` directly
(grabbed via `getApiProvider("faux")`). This embeds the stream in pi's provider
config so it **survives RPC-mode `rebindSession()`**, which clears pi-ai's
module-level api-registry. Relying on `api: "faux"` registry lookup alone fails
in headless `--mode rpc` sessions with `No API provider registered for api: faux`.

The fixture imports `@earendil-works/pi-ai` with **no version pin of its own**,
resolving against whatever pi-ai the running pi bundles.

## Model token form

`faux/faux-1` (provider `faux` + model id `faux-1`). Verify selectability with:

```bash
pi -ne -e qa/fixtures/faux-provider.ext.ts --list-models | grep faux-1
```

## Env contract

- `FAUX_SCRIPT` — scenario id from `faux-scenarios.ts`. Unknown/missing id →
  a single loud `faux: no scenario` reply (fails loud, never hangs).
- `FAUX_TPS` — tokens-per-second streaming cadence (default `50`). Set low
  (e.g. `2`) so a mid-stream abort lands before the stream completes.

## Scenario catalog shape

```ts
interface ScenarioExpect { text?: string; toolName?: string; method?: string; }
interface Scenario { script: FauxResponseStep[]; expect: ScenarioExpect; }
export const SCENARIOS: Record<string, Scenario>;
```

`script` is a `FauxResponseStep[]` — pure data + factories, composed from
`fauxText` / `fauxThinking` / `fauxToolCall` / `fauxAssistantMessage`. A factory
step `(context, options, state, model) => AssistantMessage` branches on what the
agent sent (e.g. `ask-select-roundtrip` reads the submitted answer from the
toolResult in `context`).

Both test layers import the same catalog, so a faux event stream is defined once
and asserted in both places.

## Adding a scenario

1. Add an entry to `SCENARIOS` in `faux-scenarios.ts`, composed from the faux
   helpers. Keep `script` pure data + factories (no spawning) so both layers can
   import it.
2. Set `expect` to the assertion hints the consuming layer needs (`text` for the
   server round-trip; `toolName` / `method` for the renderer matrix).
3. Reference the id from the server test (via `FAUX_SCRIPT`) and/or the client
   test (translated into `ChatView` messages).
