/**
 * LLM grammar backend. Runs one chat completion against a configured provider
 * (resolved from `~/.pi/agent/providers.json`, reusing the provider-probe
 * credential resolver) and parses a strict JSON response into the shared
 * {@link GrammarCheckResult}. Supports `openai-completions` and
 * `anthropic-messages` provider APIs.
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
import { readProvidersFromDisk, resolveProbeApiKey } from "../../package/provider-probe.js";
import { withTimeoutSignal } from "../abort.js";
import { GrammarBackendError } from "../grammar-errors.js";
import { summarize } from "./languagetool.js";

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
    "You are a meticulous grammar and spelling checker." +
    lang +
    " Return ONLY a JSON object (no prose, no code fences) with keys: " +
    '"correctedText" (string: the full text with spelling/grammar/punctuation fixed), ' +
    '"suggestions" (array of objects: {"original": string, "replacement": string, ' +
    '"kind": one of "spelling"|"grammar"|"style"|"punctuation", "message": short explanation}), ' +
    'and "summary" (string). Preserve the author\'s meaning, tone, markdown, and any code. ' +
    "Each suggestion's `original` MUST be an exact substring of the input text. " +
    "If there are no issues, set correctedText to the input unchanged and suggestions to []."
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

async function callProvider(
  entry: { baseUrl: string; apiKey: string; api?: string },
  model: string,
  text: string,
  language: string,
  signal: AbortSignal,
): Promise<string> {
  const base = entry.baseUrl.replace(/\/+$/, "");
  const system = systemPrompt(language);
  if (entry.api === "anthropic-messages") {
    const response = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": entry.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 0,
        system,
        messages: [{ role: "user", content: text }],
      }),
      signal,
    });
    if (!response.ok) {
      throw new GrammarBackendError("backend_unreachable", `provider HTTP ${response.status}`);
    }
    const json = (await response.json()) as { content?: Array<{ text?: string }> };
    return json.content?.map((c) => c.text ?? "").join("") ?? "";
  }
  // Default: OpenAI-compatible chat completions.
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${entry.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
    }),
    signal,
  });
  if (!response.ok) {
    throw new GrammarBackendError("backend_unreachable", `provider HTTP ${response.status}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Run a grammar check via the configured LLM provider/model. Throws a
 * {@link GrammarBackendError} on any failure.
 */
export async function checkWithLlm(
  text: string,
  opts: {
    provider?: string;
    model?: string;
    language: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<GrammarCheckResult> {
  if (!opts.provider || !opts.model) {
    throw new GrammarBackendError("backend_unconfigured", "grammar.llm provider/model not set");
  }
  const providers = readProvidersFromDisk();
  const entry = providers[opts.provider];
  if (!entry?.baseUrl) {
    throw new GrammarBackendError("backend_unconfigured", `no provider "${opts.provider}"`);
  }
  const resolved = resolveProbeApiKey({
    apiKey: entry.apiKey,
    name: opts.provider,
    readProviders: readProvidersFromDisk,
  });
  if (!resolved.ok) {
    throw new GrammarBackendError("backend_unconfigured", resolved.error);
  }

  const { signal, done } = withTimeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const body = await callProvider(
      { baseUrl: entry.baseUrl, apiKey: resolved.key, api: entry.api },
      opts.model,
      text,
      opts.language,
      signal,
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
