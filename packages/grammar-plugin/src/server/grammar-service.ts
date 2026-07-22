/**
 * Grammar service — the backend-agnostic entry point behind
 * `POST /api/grammar/check`. Validates + caps input, dispatches to the
 * configured backend, and maps every failure to a typed {@link GrammarErrorCode}
 * so the route can pick an HTTP status without leaking provider internals.
 *
 * `checkGrammar` returns a discriminated union rather than throwing, so the
 * route layer stays a thin mapper and the logic is directly unit-testable.
 * See change: add-composer-grammar-check.
 */

import type { GrammarConfig } from "../grammar-config.js";
import type {
  GrammarCheckResult,
  GrammarErrorCode,
  GrammarHealth,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { checkWithLanguageTool } from "./backends/languagetool.js";
import { checkWithLlm, type LlmModelRegistry, type LlmStreamFn } from "./backends/llm.js";
import { GrammarBackendError } from "./grammar-errors.js";

export type GrammarCheckOutcome =
  | { ok: true; result: GrammarCheckResult }
  | { ok: false; code: GrammarErrorCode; message: string };

export interface CheckGrammarArgs {
  text: string;
  language?: string;
  config: GrammarConfig;
  signal?: AbortSignal;
  /** OAuth/api_key-aware model resolver for the `llm` backend (from the model proxy). */
  registry?: LlmModelRegistry | null;
  /** pi-ai streamSimple adapter for the `llm` backend. */
  streamSimple?: LlmStreamFn | null;
}

/**
 * Run a grammar check honouring the resolved config. Never throws; all
 * failures come back as `{ ok: false, code }`.
 */
export async function checkGrammar(args: CheckGrammarArgs): Promise<GrammarCheckOutcome> {
  const { config } = args;
  if (!config.enabled) {
    return { ok: false, code: "grammar_disabled", message: "grammar feature is disabled" };
  }
  const raw = typeof args.text === "string" ? args.text : "";
  if (!raw.trim()) {
    return { ok: false, code: "empty_text", message: "text is empty" };
  }

  const truncated = raw.length > config.maxChars;
  const text = truncated ? raw.slice(0, config.maxChars) : raw;
  const language = (args.language ?? config.language) || "auto";

  try {
    let result: GrammarCheckResult;
    if (config.backend === "llm") {
      result = await checkWithLlm(text, {
        provider: config.llm?.provider,
        model: config.llm?.model,
        language,
        registry: args.registry,
        streamSimple: args.streamSimple,
        signal: args.signal,
      });
    } else {
      result = await checkWithLanguageTool(text, {
        url: config.languagetool.url,
        language,
        signal: args.signal,
      });
    }
    return { ok: true, result: { ...result, truncated } };
  } catch (err) {
    if (err instanceof GrammarBackendError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "backend_unreachable", message: "grammar backend failed" };
  }
}

/**
 * Lightweight health snapshot for the settings UI. For the LanguageTool
 * backend it performs a short connectivity probe against `<url>/v2/languages`.
 * Never throws.
 */
export async function getGrammarHealth(
  config: GrammarConfig,
  opts: { timeoutMs?: number } = {},
): Promise<GrammarHealth> {
  const health: GrammarHealth = {
    enabled: config.enabled,
    backend: config.backend,
    autoCheck: config.autoCheck,
    debounceMs: config.debounceMs,
    minChars: config.minChars,
    language: config.language,
  };
  if (config.backend === "languagetool") {
    const url = config.languagetool.url;
    health.languagetool = { url, reachable: await probeLanguageTool(url, opts.timeoutMs ?? 3000) };
  }
  return health;
}

async function probeLanguageTool(url: string, timeoutMs: number): Promise<boolean> {
  const base = url.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/v2/languages`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
