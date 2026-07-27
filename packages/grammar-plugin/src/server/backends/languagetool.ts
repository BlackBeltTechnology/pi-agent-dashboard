/**
 * LanguageTool grammar backend. POSTs the draft to a local (or configured)
 * LanguageTool HTTP server's `/v2/check` endpoint and maps its `matches` into
 * the shared {@link GrammarCheckResult} contract. Offline — the draft never
 * leaves the machine the LanguageTool server runs on.
 *
 * Pure helpers (`mapMatches`, `applyCorrections`, `summarize`) are separated
 * from the single I/O function (`checkWithLanguageTool`) for unit testing.
 * See change: add-composer-grammar-check.
 */

import type {
  GrammarCheckResult,
  GrammarIssueKind,
  GrammarSuggestion,
} from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { withTimeoutSignal } from "../abort.js";

const DEFAULT_TIMEOUT_MS = 8000;

/** LanguageTool `/v2/check` match shape (only the fields we consume). */
export interface LanguageToolMatch {
  offset: number;
  length: number;
  message?: string;
  shortMessage?: string;
  replacements?: Array<{ value?: string }>;
  rule?: { issueType?: string; category?: { id?: string; name?: string } };
}

/** Map a LanguageTool `issueType` to our coarse {@link GrammarIssueKind}. */
export function classifyIssue(issueType: string | undefined): GrammarIssueKind {
  switch (issueType) {
    case "misspelling":
      return "spelling";
    case "grammar":
      return "grammar";
    case "typographical":
    case "whitespace":
      return "punctuation";
    default:
      return "style";
  }
}

/**
 * Map LanguageTool matches → suggestions. Drops matches with no replacement
 * (nothing to apply) and matches with a non-positive length.
 */
export function mapMatches(matches: LanguageToolMatch[], text: string): GrammarSuggestion[] {
  const out: GrammarSuggestion[] = [];
  matches.forEach((m, i) => {
    const replacement = m.replacements?.[0]?.value;
    if (typeof replacement !== "string") return;
    if (typeof m.offset !== "number" || typeof m.length !== "number" || m.length <= 0) return;
    const original = text.slice(m.offset, m.offset + m.length);
    if (original === replacement) return;
    out.push({
      id: `${m.offset}:${m.length}:${i}`,
      offset: m.offset,
      length: m.length,
      original,
      replacement,
      kind: classifyIssue(m.rule?.issueType),
      message: m.shortMessage?.trim() || m.message?.trim() || "Suggested correction",
    });
  });
  return out;
}

/**
 * Apply non-overlapping suggestions right-to-left so earlier offsets stay
 * valid. Overlapping suggestions (a later one starting before the previous
 * accepted one ends) are skipped.
 */
export function applyCorrections(text: string, suggestions: GrammarSuggestion[]): string {
  const sorted = [...suggestions].sort((a, b) => b.offset - a.offset);
  let out = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const s of sorted) {
    const end = s.offset + s.length;
    if (end > lastStart) continue; // overlaps a already-applied (later) span
    if (s.offset < 0 || end > out.length) continue;
    out = out.slice(0, s.offset) + s.replacement + out.slice(end);
    lastStart = s.offset;
  }
  return out;
}

const KIND_LABELS: Record<GrammarIssueKind, string> = {
  spelling: "spelling",
  grammar: "grammar",
  style: "style",
  punctuation: "punctuation",
};

/** Human summary from suggestion-kind counts, e.g. "2 spelling · 1 grammar". */
export function summarize(suggestions: GrammarSuggestion[]): string {
  if (suggestions.length === 0) return "No issues found";
  const counts = new Map<GrammarIssueKind, number>();
  for (const s of suggestions) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const parts: string[] = [];
  for (const kind of ["spelling", "grammar", "punctuation", "style"] as GrammarIssueKind[]) {
    const n = counts.get(kind);
    if (n) parts.push(`${n} ${KIND_LABELS[kind]}`);
  }
  return parts.join(" · ");
}

/**
 * Run a check against a LanguageTool server. Throws on network/timeout/HTTP
 * failure so the service layer can map it to a typed error code.
 */
export async function checkWithLanguageTool(
  text: string,
  opts: {
    url: string;
    language: string;
    /** Allow sentence-start capitalization corrections. Default `false`. */
    capitalizeFirstWord?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<GrammarCheckResult> {
  const base = opts.url.replace(/\/+$/, "");
  const { signal, done } = withTimeoutSignal(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  const body = new URLSearchParams({ text, language: opts.language || "auto" });
  // When sentence-start capitalization is opt-out (default), disable the LT rule
  // so lowercase sentence starts are never flagged. See change: add-grammar-capitalize-toggle.
  if (!opts.capitalizeFirstWord) body.append("disabledRules", "UPPERCASE_SENTENCE_START");
  try {
    const response = await fetch(`${base}/v2/check`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
    });
    if (!response.ok) {
      throw new Error(`LanguageTool HTTP ${response.status}`);
    }
    const json = (await response.json()) as {
      matches?: LanguageToolMatch[];
      language?: { code?: string; name?: string };
    };
    const suggestions = mapMatches(json.matches ?? [], text);
    return {
      backend: "languagetool",
      correctedText: applyCorrections(text, suggestions),
      suggestions,
      summary: summarize(suggestions),
      language: json.language?.code || opts.language || "auto",
      truncated: false,
    };
  } finally {
    done();
  }
}
