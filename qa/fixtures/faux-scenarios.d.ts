/**
 * Shared faux scenario catalog.
 *
 * Single source of truth for the scripted model responses driven by the faux
 * provider (`faux-provider.ext.ts`). Both the server-side integration test
 * (`packages/server/src/__tests__/faux-session.integration.test.ts`) and the
 * client-side renderer test
 * (`packages/client/src/components/__tests__/faux-renderers.integration.test.tsx`)
 * import this catalog, so a faux event stream is defined once and asserted in
 * both places.
 *
 * Each entry is `{ script, expect }` where `script` is a `FauxResponseStep[]`
 * composed purely from the faux helpers (`fauxText` / `fauxThinking` /
 * `fauxToolCall` / `fauxAssistantMessage`) plus factory steps. Keeping `script`
 * as pure data + factories lets the client layer import it without spawning a
 * pi subprocess.
 *
 * See change: add-faux-model-integration-tests.
 */
/** Minimal structural type for a faux tool-call content block. */
export interface MiniToolCall {
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
/** A scripted step: a faux assistant message or a factory of one. */
export type FauxResponseStep = unknown | ((context: FauxContext, options: unknown, state: {
    callCount: number;
}, model: unknown) => unknown);
/** Minimal view of the agent context a factory step reads. */
export interface FauxContext {
    messages: Array<{
        role: string;
        content?: Array<{
            type: string;
            text?: string;
        }>;
    }>;
}
/** Assertion hints shared across both test layers. */
export interface ScenarioExpect {
    /** Substring that MUST appear in the streamed assistant text. */
    text?: string;
    /** Tool name a single-tool scenario emits (renderer-matrix scenarios). */
    toolName?: string;
    /** `ask_user` method a single-interactive scenario emits. */
    method?: string;
}
export interface Scenario {
    script: FauxResponseStep[];
    expect: ScenarioExpect;
}
/** Marker text the happy-path scenario streams; asserted verbatim downstream. */
export declare const PLAIN_TEXT_MARKER = "The quick brown faux jumps over the lazy dog.";
export declare const SCENARIOS: Record<string, Scenario>;
export type ScenarioId = keyof typeof SCENARIOS;
