/**
 * Pure helpers for one-shot LLM completion requests, shared between
 * the dashboard server (calling configured custom providers via api keys)
 * and the bridge extension (calling pi-managed providers via headers
 * resolved from `modelRegistry.getApiKeyAndHeaders`).
 *
 * No I/O, no fs, no fetch — only request/body builders, response parsers,
 * and error summarizers.
 */

export type ProbeApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";

export interface CompletionRequestInput {
  baseUrl: string;
  /** Plain api key. Empty string is acceptable when `extraHeaders` carry auth (e.g. OAuth Bearer). */
  apiKey: string;
  api: ProbeApi;
  model: string;
  system: string;
  user: string;
  /** Hard cap on output tokens. Anthropic requires this. */
  maxTokens?: number;
  /**
   * Headers to merge on top of the per-api defaults (overriding when keys
   * collide). Bridge path uses this to inject OAuth `Authorization: Bearer`
   * + provider-specific beta headers from `getApiKeyAndHeaders`.
   */
  extraHeaders?: Record<string, string>;
}

export interface CompletionRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type CompletionResult =
  | { ok: true; text: string }
  | { ok: false; status?: number; error: string };

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_ERROR_BODY_CHARS = 500;

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

// -- Build per-api request -------------------------------------------------

export function buildCompletionRequest(input: CompletionRequestInput): CompletionRequest {
  const base = stripTrailingSlash(input.baseUrl);
  const maxTokens = input.maxTokens ?? 2048;
  const extra = input.extraHeaders ?? {};

  let result: CompletionRequest;

  switch (input.api) {
    case "openai-completions": {
      // OpenAI-compatible chat completions. We deliberately omit thinking /
      // reasoning controls here — they are non-standard for chat/completions
      // and proxies vary wildly on which values they accept (e.g. DeepSeek
      // rejects `reasoning_effort: minimal`).
      result = {
        url: `${base}/chat/completions`,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          max_tokens: maxTokens,
          temperature: 0,
          stream: false,
        }),
      };
      break;
    }
    case "openai-responses": {
      // `reasoning.effort: low` is the lowest universally-accepted value
      // across o-series and proxies ("minimal" is gpt-5.x only).
      result = {
        url: `${base}/responses`,
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          instructions: input.system,
          input: input.user,
          max_output_tokens: maxTokens,
          stream: false,
          reasoning: { effort: "low" },
        }),
      };
      break;
    }
    case "anthropic-messages": {
      // Extended thinking is opt-in — we omit `thinking`.
      result = {
        url: `${base}/v1/messages`,
        headers: {
          "x-api-key": input.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          system: input.system,
          messages: [{ role: "user", content: input.user }],
          max_tokens: maxTokens,
          stream: false,
        }),
      };
      break;
    }
    case "google-generative-ai": {
      // baseUrl already includes /v1beta. `thinkingBudget: 0` disables
      // thinking on Gemini 2.5+; older models silently ignore the field.
      result = {
        url: `${base}/models/${encodeURIComponent(input.model)}:generateContent?key=${encodeURIComponent(input.apiKey)}`,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.user }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: maxTokens,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      };
      break;
    }
    default:
      throw new Error(`Unsupported api type: ${String(input.api)}`);
  }

  // Merge extraHeaders last — bridge OAuth path overrides x-api-key /
  // Authorization with the actual OAuth Bearer token.
  if (Object.keys(extra).length > 0) {
    result.headers = { ...result.headers, ...extra };
  }
  return result;
}

// -- Per-shape response extractors ----------------------------------------

function extractOpenAICompletions(body: any): string | null {
  const content = body?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : null;
}

function extractOpenAIResponses(body: any): string | null {
  if (typeof body?.output_text === "string") return body.output_text;
  const out = body?.output;
  if (Array.isArray(out)) {
    const parts: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.text === "string") parts.push(c.text);
        else if (typeof c?.text?.value === "string") parts.push(c.text.value);
      }
    }
    if (parts.length > 0) return parts.join("");
  }
  return null;
}

function extractAnthropicMessages(body: any): string | null {
  const content = body?.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const c of content) {
      if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
    }
    if (parts.length > 0) return parts.join("");
  }
  return null;
}

function extractGoogleGenerativeAi(body: any): string | null {
  const candidates = body?.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const parts = candidates[0]?.content?.parts;
    if (Array.isArray(parts)) {
      const texts: string[] = [];
      for (const p of parts) {
        if (typeof p?.text === "string") texts.push(p.text);
      }
      if (texts.length > 0) return texts.join("");
    }
  }
  return null;
}

/**
 * Try the configured shape first, then fall back to the others. Proxies
 * (e.g. LLMproxy) advertise one api for the request but the response shape
 * may follow whichever real backend served it (DeepSeek → OpenAI shape
 * even when the proxy was called with Anthropic-style request).
 */
export function extractCompletionText(api: ProbeApi, body: any): string | null {
  if (!body || typeof body !== "object") return null;

  const extractors: Record<ProbeApi, (b: any) => string | null> = {
    "openai-completions": extractOpenAICompletions,
    "openai-responses": extractOpenAIResponses,
    "anthropic-messages": extractAnthropicMessages,
    "google-generative-ai": extractGoogleGenerativeAi,
  };

  const primary = extractors[api]?.(body);
  if (primary !== null && primary !== undefined) return primary;

  const fallbackOrder: ProbeApi[] = [
    "openai-completions",
    "anthropic-messages",
    "openai-responses",
    "google-generative-ai",
  ];
  for (const fb of fallbackOrder) {
    if (fb === api) continue;
    const out = extractors[fb](body);
    if (out !== null) return out;
  }
  return null;
}

// -- Tolerant JSON parser for proxies that append SSE markers -------------

/**
 * Parse a response body that *should* be one JSON object, but may have
 * SSE-style trailers appended (e.g. LLMproxy ends bodies with `data: [DONE]`).
 * Strategy: clean JSON → first balanced object → SSE walk.
 */
export function parseTolerantJson(raw: string): any | null {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }

  const trimmed = raw.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("{")) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(trimmed.slice(0, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }

  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("data:"));
  for (let i = lines.length - 1; i >= 0; i--) {
    const payload = lines[i]!.slice("data:".length).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      return JSON.parse(payload);
    } catch {
      // try previous line
    }
  }
  return null;
}

// -- Error summarizer + redactor ------------------------------------------

export function redactErrorText(text: string, apiKey: string): string {
  let out = text;
  if (apiKey && out.includes(apiKey)) {
    out = out.split(apiKey).join("[REDACTED]");
  }
  return out.length > MAX_ERROR_BODY_CHARS ? out.slice(0, MAX_ERROR_BODY_CHARS) : out;
}

/**
 * Detect HTML-shaped bodies (proxy error pages, marketing redirects, etc.)
 * and produce a short friendly message instead of dumping raw markup.
 */
export function summarizeUpstreamError(args: {
  status: number;
  contentType: string | null;
  body: string;
  model: string;
}): string {
  const { status, contentType, body, model } = args;
  const trimmed = body.trimStart();
  const looksHtml =
    (contentType && contentType.toLowerCase().includes("text/html")) ||
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<");

  if (looksHtml) {
    const titleMatch = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    const title = titleMatch ? titleMatch[1]!.trim() : "";
    const titlePart = title ? ` (${title})` : "";
    return [
      `Provider returned an HTML error page${titlePart} — HTTP ${status}.`,
      `The model "${model}" may not be routed by this provider, or its endpoint`,
      `differs from the configured api type. Try a different model.`,
    ].join(" ");
  }
  return body || `HTTP ${status}`;
}
