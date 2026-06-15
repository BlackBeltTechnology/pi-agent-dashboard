/**
 * pi extension fixture: scriptable faux model provider.
 *
 * Registers pi-ai's built-in `registerFauxProvider()` so a session can be driven
 * deterministically with NO API key and NO real model. Used by the faux-model
 * integration tests (server + client + VM smoke).
 *
 * Recipe (validated): `registerFauxProvider({ api: "faux" })` only registers the
 * stream implementation in pi-ai's api-registry — it does NOT put the model in
 * pi's CLI catalog. Pairing it with `pi.registerProvider("faux", { api: "faux" })`
 * makes `faux/faux-1` appear in `--list-models` and selectable via
 * `--model faux/faux-1`, routing prompts to the faux stream.
 *
 * Imports `@earendil-works/pi-ai` with NO version pin of its own so it resolves
 * against whatever pi-ai the running pi bundles.
 *
 * Env contract:
 * - `FAUX_SCRIPT`  — scenario id from `faux-scenarios.ts`. Unknown/missing →
 *   a loud "faux: no scenario" reply (never a hang).
 * - `FAUX_TPS`     — tokens-per-second streaming cadence (default 50). Set low
 *   (e.g. 2) for abort scenarios.
 *
 * See change: add-faux-model-integration-tests.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  getApiProvider,
  registerFauxProvider,
} from "@earendil-works/pi-ai";
import { SCENARIOS } from "./faux-scenarios.js";

export default function fauxProviderExtension(pi: ExtensionAPI): void {
  const registration = registerFauxProvider({
    api: "faux",
    provider: "faux",
    models: [{ id: "faux-1", input: ["text", "image"] }],
    tokensPerSecond: Number(process.env.FAUX_TPS ?? 50),
  });

  // Grab the faux stream implementation and pass it to `pi.registerProvider`
  // as `streamSimple` directly. This embeds the stream in pi's provider config
  // so it survives RPC-mode `rebindSession()` (which clears pi-ai's module-level
  // api-registry) — relying on `api: "faux"` registry lookup alone fails in
  // headless rpc sessions with "No API provider registered for api: faux".
  const fauxStream = getApiProvider("faux")?.streamSimple;

  // Surface the faux model in pi's CLI catalog so `--model faux/faux-1` resolves
  // and routes to the faux stream.
  pi.registerProvider("faux", {
    name: "Faux",
    baseUrl: "http://localhost:0",
    apiKey: "faux-no-key",
    api: "faux" as never,
    streamSimple: fauxStream as never,
    models: [
      {
        id: "faux-1",
        name: "faux-1",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
    ],
  });

  const scenarioId = process.env.FAUX_SCRIPT;
  const scenario = scenarioId ? SCENARIOS[scenarioId] : undefined;
  if (scenario) {
    registration.setResponses(scenario.script);
  } else {
    // Fail loud, not hang: a misconfigured run gets a single visible reply.
    registration.setResponses([
      fauxAssistantMessage(`faux: no scenario (FAUX_SCRIPT=${scenarioId ?? "unset"})`),
    ]);
  }
}
