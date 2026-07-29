/**
 * One-shot LLM completion for a configured custom provider (server path).
 *
 * The pure helpers (`buildCompletionRequest`, `extractCompletionText`,
 * `parseTolerantJson`, `summarizeUpstreamError`) live in the shared package
 * so the bridge can reuse them for the OAuth / pi-managed provider path.
 *
 * This file keeps the server-only I/O bits: reading `~/.pi/agent/providers.json`,
 * resolving api keys, and the fetch loop with timeout + redaction.
 */

import {
  type ProbeApi,
  resolveProbeApiKey,
  readProvidersFromDisk,
} from "./package/provider-probe.js";
import {
  buildCompletionRequest,
  extractCompletionText,
  parseTolerantJson,
  redactErrorText,
  summarizeUpstreamError,
  type CompletionRequest,
  type CompletionResult,
} from "@blackbelt-technology/pi-dashboard-shared/provider-completion-helpers.js";
import { runWithRetry } from "@blackbelt-technology/pi-dashboard-shared/completion-retry.js";

// Re-export so existing imports `../provider-completion.js` keep working.
export {
  buildCompletionRequest,
  extractCompletionText,
  parseTolerantJson,
  summarizeUpstreamError,
};
export type { CompletionRequest, CompletionResult };

const DEFAULT_TIMEOUT_MS = 30000;

// -- I/O: complete with a configured provider -----------------------------

export interface CompleteWithProviderInput {
  /** Provider name as stored in providers.json (e.g. "anthropic", "openai"). */
  providerName: string;
  /** Model id to use (e.g. "claude-3-5-sonnet-20241022"). */
  model: string;
  system: string;
  user: string;
  timeoutMs?: number;
  maxTokens?: number;
}

export async function completeWithProvider(
  input: CompleteWithProviderInput,
): Promise<CompletionResult> {
  // Retry transient upstream failures (503 high-demand, 429, 5xx, network).
  // Terminal errors (auth/quota) are not retried — see completion-retry.ts.
  return runWithRetry(() => completeWithProviderOnce(input));
}

async function completeWithProviderOnce(
  input: CompleteWithProviderInput,
): Promise<CompletionResult> {
  const providers = readProvidersFromDisk();
  const entry = providers[input.providerName];
  if (!entry) {
    return {
      ok: false,
      error: `Provider "${input.providerName}" is not configured in ~/.pi/agent/providers.json. Add it under Settings → Custom LLM Providers.`,
    };
  }

  const api = entry.api as ProbeApi | undefined;
  if (!api) {
    return {
      ok: false,
      error: `Provider "${input.providerName}" has no "api" type set in providers.json.`,
    };
  }

  if (!entry.baseUrl) {
    return { ok: false, error: `Provider "${input.providerName}" has no baseUrl.` };
  }

  const resolved = resolveProbeApiKey({
    apiKey: entry.apiKey,
    name: input.providerName,
    readProviders: readProvidersFromDisk,
  });
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  let req: CompletionRequest;
  try {
    req = buildCompletionRequest({
      baseUrl: entry.baseUrl,
      apiKey: resolved.key,
      api,
      model: input.model,
      system: input.system,
      user: input.user,
      maxTokens: input.maxTokens,
    });
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(req.url, {
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
        model: input.model,
      });
      const excerpt = redactErrorText(summary, resolved.key);
      return { ok: false, status: response.status, error: excerpt };
    }

    let raw = "";
    try {
      raw = await response.text();
    } catch {
      raw = "";
    }
    // 200 + HTML body is also an upstream error.
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
        model: input.model,
      });
      return {
        ok: false,
        status: response.status,
        error: redactErrorText(summary, resolved.key),
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
    const message = err?.message ?? String(err);
    return { ok: false, error: redactErrorText(message, resolved.key) };
  }
}
