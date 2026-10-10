// Static reader for JavaScript literal values in application source under analysis.
// Never evaluates code: objects, arrays, strings, numbers, true/false/null/undefined only;
// anything else (calls, identifiers, `${}` templates, spreads) throws "not a literal".

const ESC = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
const NUM = /^[-+]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/;
const WORDS = [
  ["true", true],
  ["false", false],
  ["null", null],
  ["undefined", undefined],
];

function fail(c, what) {
  throw new Error(`not a literal at offset ${c.i}: ${what} (${JSON.stringify(c.src.slice(c.i, c.i + 30))})`);
}

/** Skip whitespace, line and block comments. */
function skip(c) {
  for (;;) {
    while (c.i < c.src.length && /\s/.test(c.src[c.i])) c.i++;
    if (c.src.startsWith("//", c.i)) {
      const nl = c.src.indexOf("\n", c.i);
      c.i = nl < 0 ? c.src.length : nl;
    } else if (c.src.startsWith("/*", c.i)) {
      const e = c.src.indexOf("*/", c.i + 2);
      if (e < 0) fail(c, "unterminated comment");
      c.i = e + 2;
    } else return;
  }
}

/** \uXXXX, \u{X..} or \xXX (cursor after the letter `e`) -> the character. */
function hexEscape(c, e) {
  const braced = e === "u" && c.src[c.i] === "{";
  const hex = braced ? c.src.slice(c.i + 1, c.src.indexOf("}", c.i)) : c.src.slice(c.i, c.i + (e === "u" ? 4 : 2));
  if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) fail(c, `bad \\${e} escape`);
  c.i += braced ? hex.length + 2 : hex.length;
  return String.fromCodePoint(Number.parseInt(hex, 16));
}

/** One escape sequence after a backslash (cursor on the escape letter) -> its text. */
function escape(c) {
  const e = c.src[c.i++];
  if (e === "u" || e === "x") return hexEscape(c, e);
  if (e === "\r" && c.src[c.i] === "\n") c.i++;
  if (e === "\r" || e === "\n") return ""; // line continuation
  return ESC[e] ?? e;
}

function string(c) {
  const q = c.src[c.i++];
  let out = "";
  while (c.i < c.src.length && c.src[c.i] !== q) {
    const ch = c.src[c.i++];
    if (q === "`" && ch === "$" && c.src[c.i] === "{") fail(c, "template substitution");
    out += ch === "\\" ? escape(c) : ch;
  }
  if (c.src[c.i] !== q) fail(c, "unterminated string");
  c.i++;
  return out;
}

function scalar(c) {
  const num = NUM.exec(c.src.slice(c.i));
  if (num) {
    c.i += num[0].length;
    return Number(num[0]);
  }
  const word = WORDS.find(([w]) => c.src.startsWith(w, c.i) && !/[\w$]/.test(c.src[c.i + w.length] ?? ""));
  if (!word) fail(c, "unsupported expression");
  c.i += word[0].length;
  return word[1];
}

function value(c) {
  skip(c);
  const ch = c.src[c.i];
  if (ch === "{") return object(c);
  if (ch === "[") return array(c);
  if (ch === "'" || ch === '"' || ch === "`") return string(c);
  return scalar(c);
}

/** Comma-separated items up to `close`, trailing comma allowed; `item` parses one. */
function items(c, close, item) {
  c.i++;
  for (;;) {
    skip(c);
    if (c.src[c.i] === close) break;
    item();
    skip(c);
    if (c.src[c.i] === ",") c.i++;
    else if (c.src[c.i] !== close) fail(c, `expected , or ${close}`);
  }
  c.i++;
}

function array(c) {
  const out = [];
  items(c, "]", () => out.push(value(c)));
  return out;
}

function key(c) {
  if (c.src[c.i] === "'" || c.src[c.i] === '"') return string(c);
  const m = /^[\w$]+/.exec(c.src.slice(c.i));
  if (!m) fail(c, "bad key");
  c.i += m[0].length;
  return m[0];
}

function object(c) {
  const out = {};
  items(c, "}", () => {
    const k = key(c);
    skip(c);
    if (c.src[c.i] !== ":") fail(c, "expected :");
    c.i++;
    // defineProperty: a "__proto__" key stays an own property, never a prototype swap
    Object.defineProperty(out, k, { value: value(c), enumerable: true, writable: true, configurable: true });
  });
  return out;
}

/** Parse the literal starting at `pos` (leading whitespace/comments skipped) -> { value, end }. */
export function parseLiteralAt(src, pos) {
  const c = { src, i: pos };
  const v = value(c);
  return { value: v, end: c.i };
}
