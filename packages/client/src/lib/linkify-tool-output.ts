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
  | { kind: "file"; text: string; path: string; line?: number; col?: number; absolute?: boolean };

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
// Absolute-context segment — may start with `.` (dot-directories like
// `.config`, `.git`, `.pi`, `.worktrees`). Safe because a leading `/`, drive
// letter, or `file://` scheme already disambiguates from prose, so the bare
// `1.2.3` guard that constrains SEG is unnecessary here.
const ASEG = "[\\w.][\\w.-]*";
// URI path segment — also admits percent-escapes (`%20`) and `~`.
const URISEG = "[\\w%~.-]+";
// Optional trailing `:line` or `:line:col` suffix.
const LINE_COL = "(?::\\d+(?::\\d+)?)?";

// Combined regex. Alternation order encodes precedence:
//   1. URL              (wins a path-shaped tail)
//   2. file:// URI      (absolute; scheme stripped + percent-decoded later)
//   3. POSIX absolute   (leading `/`, root preserved)
//   4. Windows drive    (`C:\…` / `C:/…`, drive colon ≠ line separator)
//   5. path-with-line(-col)  (relative; wins bare path-with-ext at same span)
//   6. path-with-ext         (relative; needs a separator OR `./` / `../`)
// Absolute branches fold the optional `:line[:col]` suffix inline so the
// drive colon is never mistaken for the line separator (only a trailing
// `:\d+` suffix is parsed). The `g` flag walks the input in one linear pass.
const COMBINED = new RegExp(
  // url
  `(?<url>https?:\\/\\/[^\\s<>()"'\\\`]+)` +
  // file:// URI (file:// or file:///) with recognised extension
  `|(?<file_uri>file:\\/\\/\\/?(?:${URISEG}\\/)*${URISEG}\\.${EXT_GROUP}${LINE_COL})` +
  // POSIX absolute path (dot-directory segments allowed)
  `|(?<file_posix>\\/(?:${ASEG}\\/)*${ASEG}\\.${EXT_GROUP}${LINE_COL})` +
  // Windows drive-absolute path (`\\` or `/` separators; dot-dirs allowed)
  `|(?<file_win>[A-Za-z]:[\\\\/](?:${ASEG}[\\\\/])*${ASEG}\\.${EXT_GROUP}${LINE_COL})` +
  // path-with-line(-col)
  `|(?<file_line>(?:\\.{1,2}\\/)?(?:${SEG}\\/)*${SEG}\\.${EXT_GROUP}:\\d+(?::\\d+)?)` +
  // path-with-ext: either explicit ./../ prefix (no separator needed) OR at least one separator
  `|(?<file_ext>(?:\\.{1,2}\\/)(?:${SEG}\\/)*${SEG}\\.${EXT_GROUP}|(?:${SEG}\\/)+${SEG}\\.${EXT_GROUP})`,
  "g",
);

/**
 * Strip a trailing `:line` or `:line:col` suffix. Only a *trailing* numeric
 * suffix is parsed, so a Windows drive colon (`C:\…`) is never consumed.
 */
function splitLineCol(s: string): { path: string; line?: number; col?: number } {
  const colMatch = s.match(/:(\d+):(\d+)$/);
  if (colMatch) {
    return {
      path: s.slice(0, s.length - colMatch[0].length),
      line: Number.parseInt(colMatch[1], 10),
      col: Number.parseInt(colMatch[2], 10),
    };
  }
  const lineMatch = s.match(/:(\d+)$/);
  if (lineMatch) {
    return {
      path: s.slice(0, s.length - lineMatch[0].length),
      line: Number.parseInt(lineMatch[1], 10),
    };
  }
  return { path: s };
}

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
      file_uri?: string;
      file_posix?: string;
      file_win?: string;
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
    } else if (groups.file_uri) {
      // `file://` URI — strip the scheme, parse a trailing line:col, then
      // percent-decode the path payload. A decode failure (malformed `%`)
      // degrades to a plain text token, preserving verbatim coverage.
      const payload = matchText.replace(/^file:\/\//i, "");
      const { path: rawPath, line, col } = splitLineCol(payload);
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        tokens.push({ kind: "text", text: matchText });
        cursor = matchEnd;
        continue;
      }
      tokens.push({ kind: "file", text: matchText, path: decoded, line, col, absolute: true });
      linkCount++;
    } else if (groups.file_posix || groups.file_win) {
      // Absolute path (root preserved). Parse only a trailing line:col so a
      // Windows drive colon is never consumed.
      const { path: pathPart, line, col } = splitLineCol(matchText);
      tokens.push({ kind: "file", text: matchText, path: pathPart, line, col, absolute: true });
      linkCount++;
    } else if (groups.file_line) {
      // Relative path with a trailing `:line` or `:line:col` suffix.
      const { path: pathPart, line, col } = splitLineCol(matchText);
      tokens.push({ kind: "file", text: matchText, path: pathPart, line, col });
      linkCount++;
    } else {
      // file_ext — relative bare path with recognised extension.
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
