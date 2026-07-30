/**
 * JSONC (JSON-with-comments) parsing, matching pi core byte-for-byte in intent.
 *
 * pi's `models.json` loader is `JSON.parse(stripJsonComments(content))`
 * (pi-coding-agent/dist/core/model-config.js). A commented `~/.pi/agent/models.json`
 * is therefore a SUPPORTED authoring format, and any dashboard reader that uses
 * a bare `JSON.parse` rejects a file pi itself accepts — which surfaced as a
 * repeating `models.json parse failed` warning plus silently-dropped custom
 * models.
 *
 * Scope is deliberately just comments (line + block), mirroring the
 * `strip-json-comments` default that pi uses. Trailing commas are NOT accepted,
 * because pi does not accept them either.
 *
 * See change: honor-native-models-json-metadata (JSONC parity fix).
 */

/**
 * Remove `//` line comments and block comments from JSON text.
 *
 * String literals are preserved verbatim (including `//` inside URLs and
 * comment-looking payloads), and escape sequences are tracked so an escaped
 * quote never ends string state. Newlines inside stripped regions are kept so
 * a subsequent `JSON.parse` failure still reports a useful line number.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      // Line comment: drop through to (but keep) the newline.
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) out += "\n";
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      // Block comment: drop content, re-emit contained newlines.
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out += "\n";
        i++;
      }
      i++; // consume the closing '/' (loop's i++ handles the '*')
      continue;
    }

    out += ch;
  }

  return out;
}

/**
 * Parse JSONC text. Throws on genuinely malformed JSON so callers keep their
 * existing warn-and-degrade behaviour.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text));
}
