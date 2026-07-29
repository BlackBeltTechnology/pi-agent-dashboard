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
import { type FauxContext } from "./faux-scenarios.js";
export interface FauxRegistration {
    setResponses: (responses: unknown[]) => void;
    appendResponses: (responses: unknown[]) => void;
}
/** Keep fixture tool writes inside the pi session cwd. */
export declare function fixturePath(path: string): string;
/**
 * Resolve the active scenario id + step index from the agent context.
 *
 * Walks `context.messages` backward to the last `user` message matching the
 * `[[faux:<id>]]` sentinel; `stepIndex` = count of `assistant` messages after
 * it. No sentinel → fall back to `FAUX_SCRIPT`, anchored at conversation start
 * (so the old static-queue step ordering is preserved byte-for-byte).
 */
export declare function resolveActiveStep(context: FauxContext): {
    id: string | undefined;
    stepIndex: number;
};
export default function fauxProviderExtension(pi: ExtensionAPI): void;
