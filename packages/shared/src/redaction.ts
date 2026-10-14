/**
 * Versioned secret redaction applied to question snapshots before they are
 * persisted or sent to a model. Best-effort, not a security boundary.
 * Bump `REDACTION_VERSION` and add a `_V<N>` set when patterns change.
 * See change: add-pending-question-stack (D2).
 */

export const REDACTION_VERSION = 1;

export const REDACTION_PLACEHOLDER = "[REDACTED]";

export const REDACTION_PATTERNS_V1: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Authorization:\s*Bearer\s+\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:api|access|secret)[_-]?key\s*[:=]\s*\S+/gi,
  /\bpassword\s*[:=]\s*\S+/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,
];

/** Replace every `REDACTION_PATTERNS_V1` match with a placeholder. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of REDACTION_PATTERNS_V1) {
    out = out.replace(re, REDACTION_PLACEHOLDER);
  }
  return out;
}
