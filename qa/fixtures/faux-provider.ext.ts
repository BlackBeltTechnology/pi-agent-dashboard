/**
 * pi extension fixture: scriptable faux model provider.
 *
 * Builds a scriptable faux model provider from pi-ai's built-in
 * `fauxProvider()` so a session can be driven deterministically with NO API key
 * and NO real model. Used by the faux-model
 * integration tests (server + client + VM smoke).
 *
 * Recipe (validated): `fauxProvider({ api: "faux" })` returns a Provider
 * carrying its own `streamSimple` — since pi-ai 0.85 there is NO global
 * api-registry to register into, so it does NOT by itself put the model in
 * pi's CLI catalog. Passing that `streamSimple` to
 * `pi.registerProvider("faux", { … })` makes `faux/faux-1` appear in
 * `--list-models` and selectable via `--model faux/faux-1`, routing prompts to
 * the faux stream.
 *
 * pi-ai 0.85 BREAKING: `registerFauxProvider()` + `getApiProvider()` were
 * replaced by the factory-shaped `fauxProvider()`, which RETURNS the provider
 * instead of registering it. See change: adopt-piai-factory-api-registry.
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
  /** The faux `Provider`; carries the `streamSimple` handed to pi. */
  provider: { streamSimple?: unknown };
}

const { fauxAssistantMessage, fauxProvider } =
  piAi as unknown as {
    fauxAssistantMessage: (content: unknown, options?: unknown) => unknown;
    fauxProvider: (options: Record<string, unknown>) => FauxRegistration;
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
  const registration = fauxProvider({
    api: "faux",
    provider: "faux",
    models: [
      { id: "faux-1", input: ["text", "image"] },
      // Second model so an explicit `--model faux/faux-2` resolves to something
      // DIFFERENT from the seeded `config.defaultModel` (faux/faux-1) — the
      // explicit-model-preserved e2e asserts the default never overrides it.
      // See change: fix-default-model-clobbers-explicit-model (test-plan #I1).
      { id: "faux-2", input: ["text", "image"] },
    ],
    tokensPerSecond: Number(process.env.FAUX_TPS ?? 50),
  });

  // Grab the faux stream implementation off the returned Provider and pass it
  // to `pi.registerProvider` as `streamSimple` directly. This embeds the stream
  // in pi's provider config so it survives RPC-mode `rebindSession()` (which
  // clears pi-ai's module-level api-registry) — relying on an `api: "faux"`
  // registry lookup alone fails in headless rpc sessions with "No API provider
  // registered for api: faux". On pi-ai >= 0.85 that lookup does not exist at
  // all, so this `streamSimple` is the ONLY delivery path for the stream.
  const fauxStream = registration.provider.streamSimple;

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
      {
        id: "faux-2",
        name: "faux-2",
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
