/**
 * Best-effort secret scrub applied to case and retrieved text before it is sent
 * to the judge provider (design M5). Paths, commands and hex hashes stay: the
 * judge needs them. The rule table is hashed into every verdict cache key, so
 * editing it re-judges. NOT a guarantee: the consent prompt says "best-effort".
 */
export interface ScrubRule {
  kind: string;
  re: RegExp;
  /** Replacement; `$n` refer to capture groups. */
  replace: string;
}

const NAME = String.raw`[A-Za-z0-9_.-]*(?:KEY|TOKEN|SECRET|PASS(?:WORD|WD)?(?![A-Za-z])|AUTH(?!OR)|CREDENTIAL)[A-Za-z0-9_.-]*`;

export const SCRUB_RULES: ScrubRule[] = [
  { kind: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g, replace: "[REDACTED:private-key]" },
  { kind: "auth-header", re: /(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s"']+/gi, replace: "$1[REDACTED:auth-header]" },
  { kind: "jwt", re: /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, replace: "[REDACTED:jwt]" },
  { kind: "sk-key", re: /\bsk-[A-Za-z0-9_-]{8,}/g, replace: "[REDACTED:sk-key]" },
  { kind: "github-token", re: /\b(?:gh[pos]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, replace: "[REDACTED:github-token]" },
  { kind: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{16,}/g, replace: "[REDACTED:gitlab-token]" },
  { kind: "slack-token", re: /\bxox[a-z]-[A-Za-z0-9-]{10,}/g, replace: "[REDACTED:slack-token]" },
  { kind: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g, replace: "[REDACTED:aws-key]" },
  { kind: "url-userinfo", re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, replace: "$1[REDACTED:url-userinfo]@" },
  { kind: "secret-flag", re: /(--(?:password|token|api-key|secret)(?:=|\s+))(?!\[REDACTED:)[^\s"']+/gi, replace: "$1[REDACTED:secret-flag]" },
  {
    kind: "secret-assignment",
    re: new RegExp(String.raw`(["']?${NAME}["']?\s*[=:]\s*)(?!\[REDACTED:)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)`, "gi"),
    replace: "$1[REDACTED:secret-assignment]",
  },
];

export function scrubText(text: string, rules: ScrubRule[] = SCRUB_RULES): string {
  let out = text;
  for (const r of rules) out = out.replace(r.re, r.replace);
  return out;
}

/** Stable description of the rule table (hashed into every cache key). */
export function scrubRulesFingerprint(rules: ScrubRule[] = SCRUB_RULES): string {
  return JSON.stringify(rules.map((r) => [r.kind, r.re.source, r.re.flags, r.replace]));
}
