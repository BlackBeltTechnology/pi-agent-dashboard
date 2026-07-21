/**
 * Translate handler — bridge side.
 *
 * Receives `translate_request` from the server, resolves the model and auth
 * via pi's modelRegistry (works for BOTH custom api-key providers and OAuth
 * providers like opencode-go / anthropic-cli / gemini-cli), POSTs to the
 * upstream provider, and replies with `translate_response` carrying the
 * same `requestId`.
 *
 * Pure helpers (request/response builders, tolerant JSON parser, error
 * summarizer) come from the shared package — same implementation as the
 * server's direct path.
 */

import {
  buildCompletionRequest,
  extractCompletionText,
  parseTolerantJson,
  redactErrorText,
  summarizeUpstreamError,
  type CompletionResult,
  type ProbeApi,
} from "@blackbelt-technology/pi-dashboard-shared/provider-completion-helpers.js";
import { runWithRetry } from "@blackbelt-technology/pi-dashboard-shared/completion-retry.js";
import type {
  TranslateRequestMessage,
  TranslateResponseMessage,
} from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Pull provider+id out of a "provider/model" reference. Returns null when
 * the format is unrecognized (no slash).
 */
export function parseModelRef(modelRef: string): { provider: string; id: string } | null {
  const slash = modelRef.indexOf("/");
  if (slash <= 0 || slash === modelRef.length - 1) return null;
  return { provider: modelRef.slice(0, slash), id: modelRef.slice(slash + 1) };
}

/**
 * Pi's `getApiKeyAndHeaders(model)` returns various shapes across versions.
 * Normalize to `{ ok, apiKey, headers, baseUrl?, error? }`.
 */
function normalizeAuth(auth: any): {
  ok: boolean;
  apiKey: string;
  headers: Record<string, string>;
  baseUrl?: string;
  error?: string;
} {
  if (!auth) return { ok: false, apiKey: "", headers: {}, error: "no auth returned" };
  if (auth.ok === false) {
    return { ok: false, apiKey: "", headers: {}, error: auth.error ?? "auth resolution failed" };
  }
  return {
    ok: true,
    apiKey: typeof auth.apiKey === "string" ? auth.apiKey : "",
    headers: auth.headers && typeof auth.headers === "object" ? { ...auth.headers } : {},
    baseUrl: typeof auth.baseUrl === "string" ? auth.baseUrl : undefined,
  };
}

/**
 * Best-effort api-type guess from a model object. Pi's ModelRegistry usually
 * exposes `model.provider.api` or `model.api`; we accept either.
 */
export function inferApiType(model: any): ProbeApi | null {
  const candidates = [
    model?.api,
    model?.provider?.api,
    model?.providerConfig?.api,
  ];
  for (const c of candidates) {
    if (
      c === "openai-completions" ||
      c === "openai-responses" ||
      c === "anthropic-messages" ||
      c === "google-generative-ai"
    ) {
      return c;
    }
  }
  return null;
}

/**
 * Best-effort baseUrl from a model object. Falls back to a per-api default.
 */
export function inferBaseUrl(model: any, api: ProbeApi, override?: string): string | null {
  if (override) return override;
  const candidates = [
    model?.baseUrl,
    model?.provider?.baseUrl,
    model?.providerConfig?.baseUrl,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  // Standard defaults
  switch (api) {
    case "openai-completions":
    case "openai-responses":
      return "https://api.openai.com/v1";
    case "anthropic-messages":
      return "https://api.anthropic.com";
    case "google-generative-ai":
      return "https://generativelanguage.googleapis.com/v1beta";
  }
}

export interface HandleTranslateDeps {
  /** pi modelRegistry from session ctx — required. */
  modelRegistry: any;
  /** Connection.send() — used to deliver the response message. */
  send: (msg: TranslateResponseMessage) => void;
  /** Override fetch (tests). Default: globalThis.fetch. */
  fetch?: typeof fetch;
  /** Override timeout (tests). */
  timeoutMs?: number;
}

/**
 * Process one translate_request. Always emits exactly one translate_response
 * (ok or error) with the same requestId. Never throws.
 */
export async function handleTranslateRequest(
  msg: TranslateRequestMessage,
  deps: HandleTranslateDeps,
): Promise<void> {
  const { modelRegistry, send } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const reply = (r: TranslateResponseMessage) => {
    try {
      send(r);
    } catch (err) {
      // best-effort; nothing to do if the socket is gone
      console.error("[dashboard] translate_response send failed", err);
    }
  };

  if (!modelRegistry) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: "Bridge has no modelRegistry yet — try after the session is ready.",
    });
    return;
  }

  const ref = parseModelRef(msg.modelRef);
  if (!ref) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: `Invalid modelRef "${msg.modelRef}". Expected "provider/id".`,
    });
    return;
  }

  let model: any = null;
  try {
    model = modelRegistry.find?.(ref.provider, ref.id) ?? null;
    if (!model) {
      const all = modelRegistry.getAll?.() ?? modelRegistry.getAvailable?.() ?? [];
      model =
        all.find((m: any) => m.provider === ref.provider && m.id === ref.id) ?? null;
    }
  } catch (err: any) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: `modelRegistry.find threw: ${err?.message ?? String(err)}`,
    });
    return;
  }

  if (!model) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: `Model "${msg.modelRef}" not found in pi's model registry.`,
    });
    return;
  }

  const api = inferApiType(model);
  if (!api) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: `Could not determine api type for model "${msg.modelRef}". Got: ${JSON.stringify({ api: model?.api, provider: model?.provider?.api })}`,
    });
    return;
  }

  let auth;
  try {
    auth = normalizeAuth(await modelRegistry.getApiKeyAndHeaders?.(model));
  } catch (err: any) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: `Auth resolution threw: ${err?.message ?? String(err)}`,
    });
    return;
  }

  if (!auth.ok) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: auth.error ?? "Auth resolution failed",
    });
    return;
  }

  const baseUrl = inferBaseUrl(model, api, auth.baseUrl);
  if (!baseUrl) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: `Could not resolve baseUrl for model "${msg.modelRef}".`,
    });
    return;
  }

  let req;
  try {
    req = buildCompletionRequest({
      baseUrl,
      apiKey: auth.apiKey,
      api,
      model: ref.id,
      system: msg.system,
      user: msg.user,
      maxTokens: msg.maxTokens,
      extraHeaders: auth.headers,
    });
  } catch (err: any) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      error: err?.message ?? String(err),
    });
    return;
  }

  // One attempt: returns a CompletionResult so runWithRetry can decide
  // whether a transient failure (503 high-demand, 429, 5xx, network) is
  // worth retrying. Terminal errors (auth/quota) short-circuit in the wrapper.
  const attempt = async (): Promise<CompletionResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(req.url, {
        method: "POST",
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        let bodyText = "";
        try {
          bodyText = await response.text();
        } catch {
          bodyText = "";
        }
        const summary = summarizeUpstreamError({
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: bodyText || response.statusText || "",
          model: ref.id,
        });
        return {
          ok: false,
          status: response.status,
          error: redactErrorText(summary, auth.apiKey),
        };
      }

      let raw = "";
      try {
        raw = await response.text();
      } catch {
        raw = "";
      }
      const trimmed = raw.trimStart();
      const looksHtml =
        trimmed.startsWith("<!DOCTYPE") ||
        trimmed.startsWith("<html") ||
        (response.headers.get("content-type") || "")
          .toLowerCase()
          .includes("text/html");
      if (looksHtml) {
        const summary = summarizeUpstreamError({
          status: response.status,
          contentType: response.headers.get("content-type"),
          body: raw,
          model: ref.id,
        });
        return {
          ok: false,
          status: response.status,
          error: redactErrorText(summary, auth.apiKey),
        };
      }

      const body = parseTolerantJson(raw);
      const text = extractCompletionText(api, body);
      if (text === null) {
        return {
          ok: false,
          status: response.status,
          error: "Could not extract completion text from provider response.",
        };
      }
      return { ok: true, text };
    } catch (err: any) {
      clearTimeout(timer);
      return {
        ok: false,
        error: redactErrorText(err?.message ?? String(err), auth.apiKey),
      };
    }
  };

  const result = await runWithRetry(attempt);
  if (result.ok) {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: true,
      text: result.text,
    });
  } else {
    reply({
      type: "translate_response",
      requestId: msg.requestId,
      ok: false,
      ...(typeof result.status === "number" ? { status: result.status } : {}),
      error: result.error,
    });
  }
}
