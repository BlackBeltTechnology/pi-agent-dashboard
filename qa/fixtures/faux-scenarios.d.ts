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
    /**
     * Final assembled system prompt pi-ai passes to the provider (`Context.systemPrompt`).
     * Carries the dashboard `before_agent_start` injector fragment when present.
     * See change: inject-session-context-into-agent.
     */
    systemPrompt?: string;
    messages: Array<{
        role: string;
        content?: Array<{
            type: string;
            text?: string;
        }>;
    }>;
}
/**
 * Opening delimiter the dashboard session-context injector emits. Kept in sync
 * with `CONTEXT_DELIMITER` in `packages/extension/src/dashboard-context-injector.ts`.
 * Duplicated (not imported) so the faux catalog stays decoupled from the
 * extension package. See change: inject-session-context-into-agent.
 */
export declare const DASHBOARD_CONTEXT_DELIMITER = "\u2500\u2500 pi-dashboard session context \u2500\u2500";
/** Sentinel streamed when no dashboard fragment is found in the system prompt. */
export declare const NO_DASHBOARD_CONTEXT_MARKER = "NO_DASHBOARD_CONTEXT";
/**
 * Slice the dashboard session-context fragment (delimiter through end) out of a
 * system prompt. Returns NO_DASHBOARD_CONTEXT_MARKER when absent. Matches the
 * LAST delimiter occurrence (the injector splices at the tail). Pure.
 * See change: inject-session-context-into-agent.
 */
export declare function extractDashboardFragment(systemPrompt: string | undefined): string;
/**
 * Marker a flow-agent's system prompt embeds so the faux provider can branch
 * its reply per agent. The synthetic e2e flow's agent `.md` bodies carry
 * `[[flow-agent:<name>]]`; the `flow-agent-branch` scenario reads it off
 * `context.systemPrompt` and echoes a per-agent completion line. Keeps the
 * fixture as pure data + a factory — no per-spec wiring.
 * See change: add-flow-plugin-e2e-tests.
 */
export declare const FLOW_AGENT_MARKER: RegExp;
/** Extract the flow-agent name from a system prompt, or `"unknown"` when absent. Pure. */
export declare function flowAgentName(systemPrompt: string | undefined): string;
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
/**
 * Inline-screenshot scenario (Fix B end-to-end). A real `bash` tool call writes
 * a tiny valid PNG UNDER THE DEFAULT ARTIFACT ROOT (`$HOME/.agent-browser/tmp`,
 * = `/home/pi/...` in the test container) so the bridge's artifact-root gate
 * allows it, then echoes `Screenshot saved: <path>`. The bridge's tool-result
 * inliner (`inlineToolResultImages`) reads the file at `tool_execution_end`,
 * attaches a `type:"image"` block, and strips the path so no dead link renders.
 * The e2e asserts the inline `<img>` + path-consumption.
 * See change: inline-agent-screenshot-artifacts.
 */
export declare const SCREENSHOT_INLINE: {
    readonly path: "/home/pi/.agent-browser/tmp/e2e-shot.png";
    readonly mime: "image/png";
};
/**
 * Deterministic marker prefix for the `tool-list-models` scenario (change:
 * fix-list-models-empty-on-unhydrated-registry). Step 1 executes the REAL bridge
 * `list_models` tool against the faux-populated session registry; step 2 reads
 * the tool result out of context and echoes the readiness discriminator as plain
 * assistant text the e2e asserts. `faux/faux-1` (registered via
 * `pi.registerProvider`) guarantees a hydrated, non-empty catalogue — so this is
 * the live end-to-end proof of the `registryReady: true` / populated path (V.2).
 */
export declare const LIST_MODELS_MARKER_PREFIX = "list-models registryReady=";
/**
 * Read the `list_models` tool result out of context and render the readiness
 * discriminator as a single deterministic line. Pure; parse-safe (a malformed
 * or absent result yields `parse-error`, never a throw). Mirrors the
 * `ask-select-roundtrip` factory that reads `lastToolResultText(context)`.
 */
export declare function summarizeListModelsResult(context: FauxContext): string;
/**
 * Tail marker for the `long-transcript` scenario — the last plain-text message.
 * The virtualization e2e (`tests/e2e/chat-transcript-virtualization.spec.ts`)
 * waits for this text to know the long stream has settled, and asserts the
 * streaming tail against it. See change: virtualize-chat-transcript-tanstack.
 */
export declare const LONG_TRANSCRIPT_TAIL = "long-transcript complete";
/**
 * Tail marker for the `scroll-top-heavy` scenario (change: fix-chat-scroll-to-
 * top-estimate-drift). The scroll-to-top e2e waits for it to know the transcript
 * settled at the bottom before climbing.
 */
export declare const SCROLL_TOP_HEAVY_TAIL = "scroll-top-heavy complete";
/**
 * Later-inference marker for the supersede-heal e2e. The second scripted
 * assistant message (a NEW `message_start`) is the proof-of-completion signal
 * the supersede heal requires. See change: fix-stuck-tool-card-superseded-heal.
 */
export declare const SUPERSEDE_HEAL_MARKER = "supersede-heal follow-up landed";
/**
 * Completion marker for the `oversized-turn` scenario. The scenario drives a
 * bash tool call that emits a large multi-KB output — the kind of oversized,
 * forwarded event that used to OOM-crash the server inside a single
 * `JSON.stringify` on the broadcast path. The liveness e2e
 * (`tests/e2e/oversized-event-liveness.spec.ts`) waits for this text to know the
 * heavy turn settled, then proves the server stayed up and responsive.
 * See change: bound-subagent-event-serialization.
 */
export declare const OVERSIZED_TURN_MARKER = "oversized-turn complete";
export declare const SCENARIOS: Record<string, Scenario>;
export type ScenarioId = keyof typeof SCENARIOS;
