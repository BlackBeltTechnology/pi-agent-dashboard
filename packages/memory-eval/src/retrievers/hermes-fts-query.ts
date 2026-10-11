/**
 * Replica of pi-hermes-memory's FTS query normalisation (v0.9.10
 * `src/store/fts-query.ts`). Re-implemented, not imported: the repo does not
 * depend on the npm install. The committed golden fixture (`fixtures/hermes-golden`)
 * pins its behaviour; the live test catches upstream drift.
 * See change: add-memory-eval-tier-r (design M4, "Faithfulness").
 */
const FTS5_OPERATOR_PATTERN = /\b(OR|AND|NOT|NEAR)\b/;
const FTS5_TOKEN_PATTERN = /"([^"]*)"|(\S+)/g;
const CONNECTORS = new Set(["and", "or", "not", "near"]);

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "shall", "dare", "ought", "used",
  "i", "me", "my", "mine", "we", "our", "ours", "you", "your", "yours",
  "he", "him", "his", "she", "her", "hers", "it", "its", "they", "them",
  "their", "theirs", "that", "this", "these", "those", "what", "which",
  "who", "whom", "whose", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very", "s",
  "t", "just", "don", "now", "about", "above", "after", "again", "against",
  "am", "at", "before", "behind", "below", "between", "by", "during",
  "from", "further", "into", "over", "per", "through",
  "throughout", "till", "to", "under", "until", "up", "upon", "via", "with",
  "within", "without", "as", "if", "or", "but", "and", "out", "of",
  "for", "in", "on", "any", "got", "here", "there",
]);

export const hasExplicitFts5Operator = (q: string): boolean => FTS5_OPERATOR_PATTERN.test(q.trim());

function nlTerms(query: string): string[] {
  const terms: string[] = [];
  for (const m of query.matchAll(FTS5_TOKEN_PATTERN)) {
    const phrase = m[1];
    const term = m[2];
    if (phrase === undefined && term && CONNECTORS.has(term.toLowerCase())) continue;
    if (phrase === undefined && term && STOP_WORDS.has(term.toLowerCase())) continue;
    const raw = phrase ?? term ?? "";
    if (raw.length > 0) terms.push(raw);
  }
  return terms;
}

const quote = (terms: string[], sep: string) => terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(sep);

export function normalizeFts5Query(query: string): string {
  const t = query.trim();
  if (!t) return "";
  if (hasExplicitFts5Operator(t)) return t;
  return quote(nlTerms(t), " ");
}

export function buildFallbackFts5Query(query: string): string | null {
  const t = query.trim();
  if (!t || hasExplicitFts5Operator(t)) return null;
  const terms = nlTerms(t);
  return terms.length <= 1 ? null : quote(terms, " OR ");
}

export function collectLikeTerms(query: string): string[] {
  const terms: string[] = [];
  for (const m of query.matchAll(FTS5_TOKEN_PATTERN)) {
    const phrase = m[1];
    const term = m[2];
    if (phrase === undefined && term && CONNECTORS.has(term.toLowerCase())) continue;
    const raw = phrase ?? term ?? "";
    if (raw.length > 0) terms.push(raw);
  }
  return terms;
}

export function normalizeNaturalLanguageFts5Query(query: string): string {
  const t = query.trim();
  return t ? quote(nlTerms(t), " ") : "";
}

export function buildNaturalLanguageFallbackQuery(query: string): string | null {
  const t = query.trim();
  if (!t) return null;
  const terms = nlTerms(t);
  return terms.length <= 1 ? null : quote(terms, " OR ");
}

export function isFts5QueryError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("fts5") || msg.includes("unterminated string");
}
