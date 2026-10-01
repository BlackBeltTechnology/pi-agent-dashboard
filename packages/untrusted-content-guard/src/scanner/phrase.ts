/**
 * Phrase layer — a small, versioned list of instruction-like phrases.
 *
 * ADVISORY ONLY (design Non-Goals): visible persuasive text cannot be detected
 * deterministically, so every hit is a LOW finding and nothing is removed.
 * Rule-list version: 1. Bump it (here and in README) whenever the list changes.
 */

import type { FindingSet } from "./findings.js";

const PHRASE_RULES: readonly RegExp[] = [
  /\bignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions|prompts|rules)\b/gi,
  /\bdisregard (?:all |any )?(?:the |your )?(?:previous|prior|above|earlier)? ?(?:instructions|rules|guidelines)\b/gi,
  /\bforget (?:all |everything )?(?:you were told|your (?:previous )?instructions)\b/gi,
  /\b(?:new|updated) (?:system )?instructions\s*:/gi,
  /\bdo not (?:tell|inform|alert|notify) the user\b/gi,
  /\b(?:forward|send) (?:this|these|all) (?:emails?|messages?|files?) to\b/gi,
];

export function phraseLayer(text: string, findings: FindingSet): void {
  for (const rule of PHRASE_RULES) {
    rule.lastIndex = 0;
    let count = 0;
    let first = "";
    for (let m = rule.exec(text); m !== null; m = rule.exec(text)) {
      if (count++ === 0) first = m[0];
    }
    if (count > 0) findings.add("phrase", "low", first, count);
  }
}
