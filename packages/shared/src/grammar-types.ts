/**
 * Wire contract for the composer grammar/spell check feature, shared by the
 * dashboard server (`packages/server/src/grammar/`) and the web client
 * (`useGrammarCheck` + `GrammarPanel`).
 *
 * `POST /api/grammar/check` returns a {@link GrammarCheckResult}. Offsets in a
 * {@link GrammarSuggestion} index into the ORIGINAL submitted text; the client
 * treats `original` (not `offset`) as the source of truth when applying a
 * single suggestion, so an LLM backend returning imprecise offsets cannot
 * corrupt the draft. See change: add-composer-grammar-check.
 */

/**
 * The grammar backend. Collapsed to a single member after the LanguageTool
 * backend was removed (change: grammar-llm-only-with-explore) — retained as a
 * one-member type because `GrammarCheckResult.backend` is on the wire and
 * clients/tests read it. Always `"llm"`.
 */
export type GrammarBackendKind = "llm";

/**
 * Which presentation the composer corrections panel uses: the default inline
 * `redline` (whole draft on one line, changes in place) or the stacked `list`.
 * See change: add-grammar-compact-view.
 */
export type GrammarCorrectionView = "redline" | "list";

export type GrammarIssueKind = "spelling" | "grammar" | "style" | "punctuation";

export interface GrammarSuggestion {
  /** Stable within a single result (e.g. `${offset}:${length}:${i}`). */
  id: string;
  /** Char offset of the flagged span in the ORIGINAL text. */
  offset: number;
  /** Length of the flagged span in the ORIGINAL text. */
  length: number;
  /** Exact original span text — the source of truth for applying the fix. */
  original: string;
  /** Suggested replacement text. */
  replacement: string;
  kind: GrammarIssueKind;
  /** One-line human explanation. */
  message: string;
}

export interface GrammarCheckResult {
  backend: GrammarBackendKind;
  /** Fully corrected version of the input — the apply-all target. */
  correctedText: string;
  suggestions: GrammarSuggestion[];
  /** Short summary, e.g. "2 spelling · 1 subject-verb agreement". */
  summary: string;
  /** Language actually used for the check (resolved, never "auto"). */
  language: string;
  /** True when the input exceeded `maxChars` and was clipped before checking. */
  truncated: boolean;
}

/** Request body for `POST /api/grammar/check`. */
export interface GrammarCheckRequest {
  text: string;
  language?: string;
}

/**
 * Response body for `GET /api/grammar/health`. Carries the non-secret client
 * config so the composer can drive its UI from one fetch. Provider credentials
 * and the configured LLM model are intentionally NOT included.
 */
export interface GrammarHealth {
  enabled: boolean;
  backend: GrammarBackendKind;
  autoCheck: boolean;
  debounceMs: number;
  minChars: number;
  language: string;
  /** Which corrections presentation the composer should render. */
  correctionView: GrammarCorrectionView;
}

/** Typed error codes returned by the grammar endpoints. */
export type GrammarErrorCode =
  | "grammar_disabled"
  | "empty_text"
  | "backend_unreachable"
  | "backend_timeout"
  | "backend_bad_response"
  | "backend_unconfigured";
