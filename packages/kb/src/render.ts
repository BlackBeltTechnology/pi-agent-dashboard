// One parameterized hit renderer shared by the CLI and the kb_search tool.
// See change: slim-kb-search-output.
//
// The CLI and the tool's condensed output carry the SAME fields in the SAME
// order (path :: headingPath, (+N dup), parent heading, snippet) and differ only
// on three axes, captured by RenderOpts:
//   - leading token: raw BM25 score (CLI) vs 1-based rank ordinal (tool)
//   - parent glyph:  "[parent: " (CLI, bracketed inline) vs "⤷ " (tool)
//   - line structure: single-line + indented snippet (CLI) vs multi-line (tool)
import type { KbHit } from "./types.js";

export interface RenderOpts {
  /** Leading token per hit: raw BM25 `score` (CLI) or 1-based `rank` (tool). */
  leading: "score" | "rank";
  /** Prefix for the parent-heading continuation (CLI "[parent: ", tool "⤷ "). */
  parentGlyph: string;
  /** Multi-line block per hit (tool) vs single header line + indented snippet (CLI). */
  multiline: boolean;
}

const SNIPPET_MAX = 160;

/** Render hits to text. `rank` is a 1-based ordinal over the given (post-limit) list. */
export function renderHits(hits: KbHit[], opts: RenderOpts): string {
  const { leading, parentGlyph, multiline } = opts;
  return hits
    .map((h, i) => {
      const lead = leading === "rank" ? String(i + 1) : h.score.toFixed(2);
      const head = `${lead}  ${h.path}  ::  ${h.headingPath}`;
      const dup = h.akaPaths && h.akaPaths.length ? `(+${h.akaPaths.length} dup)` : "";
      const snippet = h.snippet.replace(/\s+/g, " ").slice(0, SNIPPET_MAX);
      if (multiline) {
        const lines = [head];
        if (dup) lines.push(`   ${dup}`);
        if (h.parent) lines.push(`   ${parentGlyph}${h.parent.headingPath}`);
        lines.push(`   ${snippet}`);
        return lines.join("\n");
      }
      // Single-line CLI form — byte-identical to the legacy inline render. The
      // bracketed parent glyph carries its own closing "]".
      const dupInline = dup ? `  ${dup}` : "";
      const parentInline = h.parent ? `  ${parentGlyph}${h.parent.headingPath}]` : "";
      return `${head}${dupInline}${parentInline}\n      ${snippet}`;
    })
    .join("\n");
}
