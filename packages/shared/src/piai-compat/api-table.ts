/**
 * `model.api` → lazy api-module table (design D4).
 *
 * `Api` is an OPEN union (`KnownApi | (string & {})`), so no compile-time
 * exhaustiveness check is possible and the factory export names are irregular
 * (`openAICodexResponsesApi`, `googleGenerativeAIApi`, …). The table is
 * therefore explicit, and a drift test diffs it against the `*.lazy.js` set
 * the resolved runtime actually ships.
 *
 * An unmapped `api` is a DISPATCH ERROR, never a silent fallback.
 *
 * See change: adopt-piai-factory-api-registry.
 */

export interface LazyApiEntry {
  /** Path relative to pi-ai's `dist/`. */
  module: string;
  /** Named export — a factory returning `{ stream, streamSimple }`. */
  exportName: string;
}

/** Every TEXT-streaming api the ≥0.85 runtime ships. */
export const API_LAZY_TABLE: Readonly<Record<string, LazyApiEntry>> = {
  "anthropic-messages": { module: "api/anthropic-messages.lazy.js", exportName: "anthropicMessagesApi" },
  "azure-openai-responses": { module: "api/azure-openai-responses.lazy.js", exportName: "azureOpenAIResponsesApi" },
  "bedrock-converse-stream": { module: "api/bedrock-converse-stream.lazy.js", exportName: "bedrockConverseStreamApi" },
  "google-generative-ai": { module: "api/google-generative-ai.lazy.js", exportName: "googleGenerativeAIApi" },
  "google-vertex": { module: "api/google-vertex.lazy.js", exportName: "googleVertexApi" },
  "mistral-conversations": { module: "api/mistral-conversations.lazy.js", exportName: "mistralConversationsApi" },
  "openai-codex-responses": { module: "api/openai-codex-responses.lazy.js", exportName: "openAICodexResponsesApi" },
  "openai-completions": { module: "api/openai-completions.lazy.js", exportName: "openAICompletionsApi" },
  "openai-responses": { module: "api/openai-responses.lazy.js", exportName: "openAIResponsesApi" },
  "pi-messages": { module: "api/pi-messages.lazy.js", exportName: "piMessagesApi" },
};

/**
 * `*.lazy.js` factories that are deliberately NOT in the table.
 *
 * `openrouter-images.lazy.js` returns `{ generateImages }` — an images api
 * with no `streamSimple`. A naive "every factory must be mapped" diff would
 * false-fail on it, so the exclusion is explicit and asserted.
 */
export const NON_TEXT_LAZY_FILES: ReadonlySet<string> = new Set(["openrouter-images.lazy.js"]);
