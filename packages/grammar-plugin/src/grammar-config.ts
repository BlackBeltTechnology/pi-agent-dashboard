/**
 * Grammar plugin config — type, defaults, and validating parser. Owned by the
 * plugin (was core `shared/config.ts`); persisted under the plugin config
 * namespace `plugins.grammar.*` (validated by `configSchema.json`).
 * `parseGrammarConfig` stays the clamp/validation authority the server route +
 * settings UI both use. See change: make-grammar-fully-plugin-contained.
 */
import type { GrammarBackendKind } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";

export interface GrammarConfig {
  /** Master gate. Default `false` — feature is fully invisible when off. */
  enabled: boolean;
  /** Which backend performs the check. Default `"languagetool"`. */
  backend: GrammarBackendKind;
  /** Run a debounced check as the user types. Default `true`. */
  autoCheck: boolean;
  /** Idle debounce before an auto-check. Default 1200. Clamped [300, 10000]. */
  debounceMs: number;
  /** Minimum draft length before auto-check runs. Default 12. Clamped [1, 500]. */
  minChars: number;
  /** Input cap; longer text is clipped + flagged `truncated`. Default 4000. Clamped [100, 20000]. */
  maxChars: number;
  /** Language passed to the backend. Default `"auto"` (e.g. `"en-US"`, `"hu-HU"`). */
  language: string;
  /**
   * Whether the checker may correct sentence-start capitalization. Default
   * `false` — the checker never touches lowercase sentence starts unless the
   * user opts in (LLM: prompt instruction; LanguageTool: disables the
   * `UPPERCASE_SENTENCE_START` rule). See change: add-grammar-capitalize-toggle.
   */
  capitalizeFirstWord: boolean;
  /** LanguageTool backend server. Default `http://localhost:8081`. */
  languagetool: { url: string };
  /** LLM backend provider/model. Only set when configured. */
  llm?: { provider: string; model: string };
}

export const DEFAULT_GRAMMAR: GrammarConfig = {
  enabled: false,
  backend: "languagetool",
  autoCheck: true,
  debounceMs: 1200,
  minChars: 12,
  maxChars: 4000,
  language: "auto",
  capitalizeFirstWord: false,
  languagetool: { url: "http://localhost:8081" },
};

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Validate + clamp a raw config object into a full {@link GrammarConfig}. */
export function parseGrammarConfig(raw: unknown): GrammarConfig {
  const d = DEFAULT_GRAMMAR;
  if (!raw || typeof raw !== "object") {
    return { ...d, languagetool: { ...d.languagetool } };
  }
  const r = raw as Record<string, unknown>;
  const backend: GrammarBackendKind =
    r.backend === "llm" || r.backend === "languagetool" ? r.backend : d.backend;
  const lt = r.languagetool as { url?: unknown } | undefined;
  const url =
    typeof lt?.url === "string" && lt.url.trim() ? (lt.url as string) : d.languagetool.url;
  let llm: { provider: string; model: string } | undefined;
  const rl = r.llm as { provider?: unknown; model?: unknown } | undefined;
  if (
    rl &&
    typeof rl === "object" &&
    typeof rl.provider === "string" &&
    rl.provider &&
    typeof rl.model === "string" &&
    rl.model
  ) {
    llm = { provider: rl.provider, model: rl.model };
  }
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    backend,
    autoCheck: typeof r.autoCheck === "boolean" ? r.autoCheck : d.autoCheck,
    debounceMs: clampNumber(r.debounceMs, d.debounceMs, 300, 10000),
    minChars: clampNumber(r.minChars, d.minChars, 1, 500),
    maxChars: clampNumber(r.maxChars, d.maxChars, 100, 20000),
    language: typeof r.language === "string" && r.language.trim() ? r.language : d.language,
    capitalizeFirstWord:
      typeof r.capitalizeFirstWord === "boolean" ? r.capitalizeFirstWord : d.capitalizeFirstWord,
    languagetool: { url },
    ...(llm ? { llm } : {}),
  };
}
