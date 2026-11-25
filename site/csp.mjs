/**
 * Inline-hash check for pages that carry a meta Content-Security-Policy (GitHub Pages cannot send
 * headers, so `oauth/return.html` pins its one inline script and style by sha256 in a <meta>).
 * Used by build.mjs (fails the build) and by design-scratch/scripts/return-check.mjs. Not shipped.
 * See change: add-google-connect (D12b).
 */
import { createHash } from "node:crypto";

/** CSP source expression for the given inline text, e.g. `'sha256-…='`. */
export const cspHash = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

const inline = (html, tag) =>
  [...html.matchAll(new RegExp(`<${tag}(?![^>]*\\bsrc\\s*=)[^>]*>([\\s\\S]*?)</${tag}>`, "gi"))].map((m) => m[1]);

const hashesOf = (policy, directive) => {
  const d = policy.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${directive} `));
  return new Set(d ? d.split(/\s+/).filter((t) => t.startsWith("'sha256-")) : []);
};

/** Problems with the page's meta CSP (empty = fine). Pages without a meta CSP are not checked. */
export function checkInlineHashes(html, label) {
  const meta = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
  if (!meta) return [];
  const policy = meta[1];
  const problems = [];
  if (/'unsafe-(inline|eval)'/.test(policy)) problems.push(`${label}: CSP allows unsafe-inline/unsafe-eval`);
  if (/<script\b[^>]*\bsrc\s*=/i.test(html)) problems.push(`${label}: <script src> is not allowed on a page with a pinned CSP`);
  for (const [tag, directive] of [["script", "script-src"], ["style", "style-src"]]) {
    const pinned = hashesOf(policy, directive);
    const actual = inline(html, tag).filter((t) => t.trim()).map(cspHash);
    for (const h of actual) if (!pinned.has(h)) problems.push(`${label}: hash mismatch — inline <${tag}> is ${h}, ${directive} pins ${[...pinned].join(" ") || "nothing"}`);
    for (const h of pinned) if (!actual.includes(h)) problems.push(`${label}: hash mismatch — ${directive} pins ${h}, which matches no inline <${tag}> (stale)`);
  }
  return problems;
}
