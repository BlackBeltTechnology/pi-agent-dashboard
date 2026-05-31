/**
 * Pure tokenizer for tool-output linkification.
 *
 * Detects URLs and file references (with optional `:line[:col]` suffix or
 * recognised code/document extensions) in plain-text tool result strings.
 * Single linear pass; the concatenation of every token's `text` field for
 * a non-overflow input MUST equal the original input verbatim.
 *
 * See change: linkify-tool-output, spec `tool-output-linkification`.
 */

export type Token =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string }
  | { kind: "file"; text: string; path: string; line?: number; col?: number };

/** Maximum number of link tokens before remainder degrades to plain text. */
export const MAX_LINKS = 5000;

/** Recognised extensions for path detection (per spec). Longer-first for regex alternation. */
const EXTS = [
  "tsx", "ts", "jsx", "js", "mjs", "cjs",
  "mdx", "md",
  "json", "yaml", "yml",
  "scss", "css",
  "html", "sh",
  "py", "go", "rs", "txt",
];
const EXT_GROUP = `(?:${EXTS.join("|")})`;

// A single path segment — letters, digits, dot, dash, underscore. Must NOT
// be empty and SHOULD start with a non-dot character to keep prose tokens
// like `1.2.3` from looking pathy. Trailing `.ext` is enforced at the
// top-level pattern, so a `1.0.0` token cannot match (`.0` is not in EXTS).
const SEG = "[\\w][\\w.-]*";

// Combined regex. Alternation order encodes precedence:
//   1. URL  (winning a path-shaped tail)
//   2. path-with-line(-col)  (winning bare path-with-ext at same span)
//   3. path-with-ext  (must have a separator OR `./` / `../` prefix)
// The `g` flag lets us walk the input in a single linear pass with .exec().
const COMBINED = new RegExp(
  // url
  `(?<url>https?:\\/\\/[^\\s<>()"'\\\`]+)` +
  // path-with-line(-col)
  `|(?<file_line>(?:\\.{1,2}\\/)?(?:${SEG}\\/)*${SEG}\\.${EXT_GROUP}:\\d+(?::\\d+)?)` +
  // path-with-ext: either explicit ./../ prefix (no separator needed) OR at least one separator
  `|(?<file_ext>(?:\\.{1,2}\\/)(?:${SEG}\\/)*${SEG}\\.${EXT_GROUP}|(?:${SEG}\\/)+${SEG}\\.${EXT_GROUP})`,
  "g",
);

// URL trailing punctuation to strip per spec (so "see https://x.com." links
// to "https://x.com" and not "https://x.com.").
const URL_TRAIL = /[.,;:!?)\]}>'"]+$/;

/**
 * Tokenise a tool-output string into a flat token stream.
 *
 * Contract:
 * - Single linear pass (no quadratic backtracking).
 * - Coverage (non-overflow): `tokens.map(t => t.text).join("") === text`.
 * - Overflow: after `MAX_LINKS` link tokens, remaining matches degrade to
 *   plain `text` tokens; a final synthetic `text` token
 *   `"\n+<N> more links suppressed"` is appended.
 */
export function tokenize(text: string): Token[] {
  if (!text) return [];

  const tokens: Token[] = [];
  COMBINED.lastIndex = 0;
  let cursor = 0;
  let linkCount = 0;
  let suppressed = 0;
  let m: RegExpExecArray | null;

  while ((m = COMBINED.exec(text)) !== null) {
    const matchStart = m.index;
    let matchEnd = matchStart + m[0].length;
    let matchText = m[0];
    const groups = (m.groups ?? {}) as {
      url?: string;
      file_line?: string;
      file_ext?: string;
    };

    // Strip trailing punctuation from URL matches and rewind lastIndex so the
    // stripped characters become part of the following text token.
    if (groups.url) {
      const tail = matchText.match(URL_TRAIL);
      if (tail) {
        const trim = tail[0].length;
        matchText = matchText.slice(0, matchText.length - trim);
        matchEnd = matchStart + matchText.length;
        COMBINED.lastIndex = matchEnd;
      }
    }

    // Defensive: a regex engine should not emit a zero-width match here, but
    // if one ever appears, advance past it to avoid an infinite loop.
    if (matchEnd <= matchStart) {
      COMBINED.lastIndex = matchStart + 1;
      continue;
    }

    if (matchStart > cursor) {
      tokens.push({ kind: "text", text: text.slice(cursor, matchStart) });
    }

    if (linkCount >= MAX_LINKS) {
      // Overflow — degrade to text but preserve coverage of the original input.
      tokens.push({ kind: "text", text: matchText });
      suppressed++;
    } else if (groups.url) {
      tokens.push({ kind: "url", text: matchText });
      linkCount++;
    } else if (groups.file_line) {
      // Trailing `:line` or `:line:col`. The path is everything before that suffix.
      const lineColRe = /:(\d+):(\d+)$/;
      const lineOnlyRe = /:(\d+)$/;
      const colMatch = matchText.match(lineColRe);
      if (colMatch) {
        const line = Number.parseInt(colMatch[1], 10);
        const col = Number.parseInt(colMatch[2], 10);
        const pathPart = matchText.slice(0, matchText.length - colMatch[0].length);
        tokens.push({ kind: "file", text: matchText, path: pathPart, line, col });
      } else {
        const lineMatch = matchText.match(lineOnlyRe)!;
        const line = Number.parseInt(lineMatch[1], 10);
        const pathPart = matchText.slice(0, matchText.length - lineMatch[0].length);
        tokens.push({ kind: "file", text: matchText, path: pathPart, line });
      }
      linkCount++;
    } else {
      // file_ext — bare path with recognised extension.
      tokens.push({ kind: "file", text: matchText, path: matchText });
      linkCount++;
    }

    cursor = matchEnd;
  }

  if (cursor < text.length) {
    tokens.push({ kind: "text", text: text.slice(cursor) });
  }

  if (suppressed > 0) {
    tokens.push({ kind: "text", text: `\n+${suppressed} more links suppressed` });
  }

  return tokens;
}
