/**
 * LLM grammar backend. Runs one completion through the dashboard's in-process
 * model runtime — pi-ai's `streamSimple`, with credentials resolved by the
 * shared {@link InternalRegistry} (`getApiKeyAndHeaders`, OAuth- AND api_key-
 * aware) — and parses a strict JSON response into {@link GrammarCheckResult}.
 *
 * This is the SAME resolution path the model proxy (`/v1/chat/completions`,
 * `/v1/messages`) uses, so it works for OAuth logins (auth.json) and does NOT
 * depend on `providers.json#providers` (which is empty in OAuth-only setups —
 * that was why the old provider-probe path failed with backend_unconfigured).
 *
 * Privacy: with this backend the draft leaves the machine to the provider.
 * Credentials are resolved server-side and never returned to the client.
 * See change: add-composer-grammar-check.
 */

import type {
  GrammarCheckResult,
  GrammarIssueKind,
  GrammarSuggestion,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { convertOpenAIMessages } from "../../model-proxy/convert/index.js";
import { withTimeoutSignal } from "../abort.js";
import { GrammarBackendError } from "../grammar-errors.js";
import { summarize } from "./languagetool.js";

/** OAuth/api_key-aware model resolver (subset of the model-proxy InternalRegistry). */
export interface LlmModelRegistry {
  find(provider: string, modelId: string): Promise<unknown | null>;
  getApiKeyAndHeaders(model: unknown): Promise<{ apiKey: string; headers: Record<string, string> }>;
}

/** Subset of pi-ai's streamSimple (as adapted by the server) that we consume. */
export type LlmStreamFn = (opts: {
  model: unknown;
  messages: unknown[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}) => AsyncIterable<{ type?: string; message?: unknown; error?: { errorMessage?: string } }>;

/** Extract plain text from a pi-ai "done" message (string or text-block array). */
function extractMessageText(msg: unknown): string {
  const content = (msg as { content?: unknown })?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => (c as { type?: string })?.type === "text")
      .map((c) => (c as { text?: string }).text ?? "")
      .join("");
  }
  return "";
}

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_OUTPUT_TOKENS = 2048;

const VALID_KINDS: GrammarIssueKind[] = ["spelling", "grammar", "style", "punctuation"];

interface RawSuggestion {
  original?: unknown;
  replacement?: unknown;
  kind?: unknown;
  message?: unknown;
}

interface RawResult {
  correctedText?: unknown;
  suggestions?: unknown;
  summary?: unknown;
}

function systemPrompt(language: string): string {
  const lang = language && language !== "auto" ? ` The text language is "${language}".` : "";
  return (
    "You are an expert writing assistant and proofreader." +
    lang +
    " Correct every spelling, grammar, and punctuation mistake, AND improve the writing" +
    " for clarity, concision, flow, and word choice. Preserve the author's original meaning," +
    " intent, voice/tone, language, markdown formatting, and any code or URLs verbatim; do not" +
    " add new content or change facts. " +
    "Return ONLY a JSON object (no prose, no code fences) with keys: " +
    '"correctedText" (string: the full text with mistakes fixed AND wording improved), ' +
    '"suggestions" (array of objects: {"original": string, "replacement": string, ' +
    '"kind": one of "spelling"|"grammar"|"style"|"punctuation", "message": short explanation}; ' +
    'use "style" for clarity/flow/word-choice improvements that are not strict errors), ' +
    'and "summary" (string: a brief overview of the changes). ' +
    "Each suggestion's `original` MUST be an exact substring of the input text. " +
    "If the text needs no changes, set correctedText to the input unchanged and suggestions to []."
  );
}

/** Extract a JSON object from an LLM text response, tolerating code fences. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new GrammarBackendError("backend_bad_response", "no JSON object in LLM response");
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new GrammarBackendError("backend_bad_response", "unparseable JSON in LLM response");
  }
}

/**
 * Turn a parsed LLM object into a validated result. Offsets from the model are
 * NOT trusted — each suggestion's `offset`/`length` is recomputed by locating
 * its `original` substring in the source text (scanning forward), so a bad
 * offset can never corrupt the draft when applied client-side.
 */
/** Map one raw model suggestion to a validated one, or null to drop it. */
function mapRawSuggestion(
  entry: RawSuggestion,
  text: string,
  fromCursor: number,
  i: number,
): { suggestion: GrammarSuggestion; nextCursor: number } | null {
  if (!entry || typeof entry !== "object") return null;
  const original = typeof entry.original === "string" ? entry.original : "";
  const replacement = typeof entry.replacement === "string" ? entry.replacement : "";
  if (!original || original === replacement) return null;
  const found = text.indexOf(original, fromCursor);
  const offset = found === -1 ? text.indexOf(original) : found;
  if (offset === -1) return null; // original not in text → drop (untrustworthy)
  const kind = VALID_KINDS.includes(entry.kind as GrammarIssueKind)
    ? (entry.kind as GrammarIssueKind)
    : "grammar";
  const message =
    typeof entry.message === "string" && entry.message.trim()
      ? entry.message.trim()
      : "Suggested correction";
  return {
    suggestion: { id: `${offset}:${original.length}:${i}`, offset, length: original.length, original, replacement, kind, message },
    nextCursor: found === -1 ? fromCursor : found + original.length,
  };
}

export function parseLlmResult(raw: unknown, text: string, language: string): GrammarCheckResult {
  if (!raw || typeof raw !== "object") {
    throw new GrammarBackendError("backend_bad_response", "LLM response was not an object");
  }
  const r = raw as RawResult;
  const correctedText = typeof r.correctedText === "string" ? r.correctedText : text;
  const suggestions: GrammarSuggestion[] = [];
  let cursor = 0;
  if (Array.isArray(r.suggestions)) {
    r.suggestions.forEach((entry: RawSuggestion, i) => {
      const mapped = mapRawSuggestion(entry, text, cursor, i);
      if (!mapped) return;
      suggestions.push(mapped.suggestion);
      cursor = mapped.nextCursor;
    });
  }
  const summary =
    typeof r.summary === "string" && r.summary.trim() ? r.summary.trim() : summarize(suggestions);
  return { backend: "llm", correctedText, suggestions, summary, language, truncated: false };
}

/** Resolve a model + credentials from the registry, or throw backend_unconfigured. */
async function resolveModelAndCreds(
  registry: LlmModelRegistry,
  provider: string,
  modelId: string,
): Promise<{ model: unknown; creds: { apiKey: string; headers: Record<string, string> } }> {
  const model = await registry.find(provider, modelId);
  if (!model) {
    throw new GrammarBackendError(
      "backend_unconfigured",
      `model "${provider}/${modelId}" is not available`,
    );
  }
  return { model, creds: await registry.getApiKeyAndHeaders(model) };
}

/** Drain a streamSimple event stream to the final assistant text, or throw. */
async function collectStreamText(
  events: AsyncIterable<{ type?: string; message?: unknown; error?: { errorMessage?: string } }>,
): Promise<string> {
  let finalMsg: unknown;
  for await (const event of events) {
    if (event?.type === "done") finalMsg = event.message;
    else if (event?.type === "error") {
      throw new GrammarBackendError(
        "backend_unreachable",
        event.error?.errorMessage || "provider error",
      );
    }
  }
  if (finalMsg === undefined) {
    throw new GrammarBackendError("backend_bad_response", "no response from model");
  }
  return extractMessageText(finalMsg);
}

/**
 * Run a grammar check via the dashboard's model runtime (pi-ai `streamSimple`)
 * with credentials resolved by the {@link LlmModelRegistry} (OAuth/api_key).
 * Throws a {@link GrammarBackendError} on any failure.
 */
export async function checkWithLlm(
  text: string,
  opts: {
    provider?: string;
    model?: string;
    language: string;
    registry?: LlmModelRegistry | null;
    streamSimple?: LlmStreamFn | null;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<GrammarCheckResult> {
  if (!opts.provider || !opts.model) {
    throw new GrammarBackendError("backend_unconfigured", "grammar.llm provider/model not set");
  }
  if (!opts.registry || !opts.streamSimple) {
    throw new GrammarBackendError(
      "backend_unconfigured",
      "model runtime unavailable (pi-ai not resolved)",
    );
  }
  const { model, creds } = await resolveModelAndCreds(opts.registry, opts.provider, opts.model);
  // Reuse the canonical OpenAI→pi-ai message converter so the message shape
  // matches what the model proxy sends; our grammar system prompt is separate.
  const { messages } = convertOpenAIMessages([{ role: "user", content: text }]);

  const { signal, done } = withTimeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const body = await collectStreamText(
      opts.streamSimple({
        model,
        messages,
        system: systemPrompt(opts.language),
        maxTokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        apiKey: creds.apiKey,
        headers: creds.headers,
        signal,
      }),
    );
    return parseLlmResult(extractJsonObject(body), text, opts.language);
  } catch (err) {
    if (err instanceof GrammarBackendError) throw err;
    if (signal.aborted) {
      throw new GrammarBackendError("backend_timeout", "LLM request timed out");
    }
    throw new GrammarBackendError("backend_unreachable", "LLM request failed");
  } finally {
    done();
  }
}
