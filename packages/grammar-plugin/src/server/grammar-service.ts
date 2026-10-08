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

import type {
  GrammarCheckResult,
  GrammarErrorCode,
  GrammarHealth,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { type ResolvedModelRef, resolveModelRef } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import type { GrammarConfig } from "../grammar-config.js";
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
  /**
   * Resolve a role ref (`@fast`) to a concrete model at CHECK time, so a
   * preset change applies on the next check. Defaults to the shared resolver
   * over `providers.json`. See change: add-role-aware-model-refs.
   */
  resolveRole?: (ref: string) => ResolvedModelRef;
}

const defaultResolveRole = (ref: string): ResolvedModelRef =>
  resolveModelRef(ref, readRoleConfigFromDisk());

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

  let provider: string | undefined;
  let model: string | undefined;
  const llm = config.llm;
  if (llm && "role" in llm) {
    const r = (args.resolveRole ?? defaultResolveRole)(llm.role);
    if (r.unresolved || !r.provider || !r.id) {
      return {
        ok: false,
        code: "model_role_unassigned",
        message: `grammar model role ${llm.role} has no model assigned`,
      };
    }
    provider = r.provider;
    model = r.id;
  } else if (llm) {
    provider = llm.provider;
    model = llm.model;
  }

  try {
    const result = await checkWithLlm(text, {
      provider,
      model,
      language,
      capitalizeFirstWord: config.capitalizeFirstWord,
      registry: args.registry,
      streamSimple: args.streamSimple,
      signal: args.signal,
    });
    return { ok: true, result: { ...result, truncated } };
  } catch (err) {
    if (err instanceof GrammarBackendError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "backend_unreachable", message: "grammar backend failed" };
  }
}

/**
 * Lightweight health snapshot for the settings UI — the non-secret client
 * config only (the LLM model + credentials are never exposed). Never throws.
 */
export function getGrammarHealth(config: GrammarConfig): GrammarHealth {
  return {
    enabled: config.enabled,
    backend: "llm",
    autoCheck: config.autoCheck,
    debounceMs: config.debounceMs,
    minChars: config.minChars,
    language: config.language,
    correctionView: config.correctionView,
  };
}
