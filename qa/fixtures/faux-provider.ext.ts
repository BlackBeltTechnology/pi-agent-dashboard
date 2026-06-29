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
 * Per-session scenario routing: each prompt selects its scenario from a
 * `[[faux:<scenario-id>]]` sentinel in the latest user message. The step within
 * a multi-step scenario is the count of assistant turns since that message, so
 * scenarios like `ask-select-roundtrip` replay in order. No sentinel → fall
 * back to the `FAUX_SCRIPT` env scenario (existing Vitest + VM-smoke behaviour).
 * Per-session isolation falls out for free: each session is its own
 * `pi --mode rpc` process with its own faux registration + state.
 *
 * Env contract:
 * - `FAUX_SCRIPT`  — fallback scenario id from `faux-scenarios.ts` when no
 *   sentinel is present. Unknown/missing → a loud "faux: no scenario" reply
 *   (never a hang).
 * - `FAUX_TPS`     — tokens-per-second streaming cadence (default 50). Set low
 *   (e.g. 2) for abort scenarios.
 *
 * See change: add-faux-model-integration-tests, add-e2e-faux-model-roundtrip.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
// pi-ai's published `index.d.ts` re-exports members with `.ts` extensions,
// unresolvable under this repo's `moduleResolution: "bundler"`. Mirror
// `faux-scenarios.ts`: import the namespace and read runtime helpers off an
// `any` view (this file is now in tsc's graph via the faux-router unit test).
// Runtime resolution is unaffected.
import * as piAi from "@earendil-works/pi-ai";
import { type FauxContext, SCENARIOS } from "./faux-scenarios.js";

export interface FauxRegistration {
  setResponses: (responses: unknown[]) => void;
  appendResponses: (responses: unknown[]) => void;
}

const { fauxAssistantMessage, getApiProvider, registerFauxProvider } =
  piAi as unknown as {
    fauxAssistantMessage: (content: unknown, options?: unknown) => unknown;
    getApiProvider: (api: string) => { streamSimple?: unknown } | undefined;
    registerFauxProvider: (options: Record<string, unknown>) => FauxRegistration;
  };

/** Sentinel a prompt embeds to select its scenario, e.g. `[[faux:tool-read]]`. */
const SENTINEL = /\[\[faux:([\w-]+)\]\]/;

/** Flatten a context message to its plain text (user prompt / assistant text). */
function messageText(message: FauxContext["messages"][number]): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (block && block.type === "text" ? block.text ?? "" : ""))
    .join("");
}

/**
 * Resolve the active scenario id + step index from the agent context.
 *
 * Walks `context.messages` backward to the last `user` message matching the
 * `[[faux:<id>]]` sentinel; `stepIndex` = count of `assistant` messages after
 * it. No sentinel → fall back to `FAUX_SCRIPT`, anchored at conversation start
 * (so the old static-queue step ordering is preserved byte-for-byte).
 */
export function resolveActiveStep(context: FauxContext): {
  id: string | undefined;
  stepIndex: number;
} {
  const messages = context.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "user") continue;
    const match = SENTINEL.exec(messageText(message));
    if (match) {
      let stepIndex = 0;
      for (let j = i + 1; j < messages.length; j++) {
        if (messages[j].role === "assistant") stepIndex++;
      }
      return { id: match[1], stepIndex };
    }
  }
  let stepIndex = 0;
  for (const message of messages) {
    if (message.role === "assistant") stepIndex++;
  }
  return { id: process.env.FAUX_SCRIPT, stepIndex };
}

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

  // Self-perpetuating router: re-appends itself each call so the faux queue
  // never drains, resolves the scenario from the latest sentinel (or the
  // FAUX_SCRIPT fallback), and replays the step matching the conversation
  // position. Calls factory steps with the live context so multi-step
  // scenarios (e.g. ask-select-roundtrip) read back the user's answer.
  const router = (
    context: FauxContext,
    options: unknown,
    state: { callCount: number },
    model: unknown,
  ): unknown => {
    registration.appendResponses([router]);
    const { id, stepIndex } = resolveActiveStep(context);
    const scenario = id ? SCENARIOS[id] : undefined;
    if (!scenario) {
      // Fail loud, not hang: a misconfigured run gets a single visible reply.
      return fauxAssistantMessage(`faux: no scenario (id=${id ?? "unset"})`);
    }
    const step = scenario.script[stepIndex] ?? scenario.script[scenario.script.length - 1];
    return typeof step === "function" ? step(context, options, state, model) : step;
  };
  registration.setResponses([router as never]);
}
