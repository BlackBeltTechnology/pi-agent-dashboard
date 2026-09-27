/**
 * `scan()` — the deterministic scanner pipeline (design D1).
 *
 * Fixed order:
 *   1. size cap (2 MiB → truncate + HIGH `oversize_truncated`);
 *   2. HTML layer when the content is HTML — hidden ranges removed, each
 *      remaining decoded text node run through 3–4 and rewritten in place;
 *   3. Unicode (plain text only here — never entity-decoded);
 *   4. ANSI;
 *   5. URL;
 *   6. phrase rules (low, advisory).
 *
 * Pure: the same input + options always yields the same output and findings.
 * `warn` records findings but returns the (size-capped) input unchanged.
 */

import { ansiLayer } from "./ansi.js";
import { type Finding, FindingSet } from "./findings.js";
import { htmlLayer, isHtml } from "./html.js";
import { phraseLayer } from "./phrase.js";
import { unicodeLayer } from "./unicode.js";
import { urlLayer } from "./url.js";

type ScanMode = "warn" | "strip" | "block";

export interface ScanOptions {
  /** Default `strip`. `warn` detects only; `strip`/`block` clean. */
  mode?: ScanMode;
  /** e.g. the result's `details.contentType`; `text/html` forces the HTML layer. */
  contentType?: string;
  /** Hosts whose query-string images are not reported (subdomains included). */
  allowHosts?: readonly string[];
}

export interface ScanResult {
  cleaned: string;
  findings: Finding[];
  /** Whether the HTML layer ran. */
  html: boolean;
}

/** Scan cap: 2 MiB, measured in UTF-16 code units. */
export const MAX_SCAN_CHARS = 2 * 1024 * 1024;

function capSize(text: string, findings: FindingSet): string {
  if (text.length <= MAX_SCAN_CHARS) return text;
  let end = MAX_SCAN_CHARS;
  const unit = text.charCodeAt(end - 1);
  if (unit >= 0xd800 && unit <= 0xdbff) end -= 1; // never split a surrogate pair
  findings.add("oversize_truncated", "high", `${text.length} chars truncated to ${end}`);
  return text.slice(0, end);
}

export function scan(input: string, options: ScanOptions = {}): ScanResult {
  const mode = options.mode ?? "strip";
  const apply = mode !== "warn";
  const findings = new FindingSet();
  const capped = capSize(input, findings);

  let html = isHtml(capped, options.contentType);
  let text: string;
  if (html) {
    try {
      text = htmlLayer(capped, findings, apply);
    } catch (err) {
      // Parser failure: fall back to the plain-text layers on the raw source.
      findings.add("html_parse_failed", "high", err instanceof Error ? err.message : String(err));
      html = false;
      text = ansiLayer(unicodeLayer(capped, findings), findings);
    }
  } else {
    text = ansiLayer(unicodeLayer(capped, findings), findings);
  }

  text = urlLayer(text, findings, { replaceData: apply, allowHosts: options.allowHosts ?? [] });
  phraseLayer(text, findings);

  return { cleaned: apply ? text : capped, findings: findings.list(), html };
}
