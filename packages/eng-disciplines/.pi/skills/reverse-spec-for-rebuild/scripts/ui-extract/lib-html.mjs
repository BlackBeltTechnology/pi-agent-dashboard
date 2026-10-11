// Minimal HTML template parser: tree with source line numbers (no dependencies).
// Lenient like browsers: unknown end tags are ignored, unclosed elements close at their parent's end.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);
const TOKEN = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|[^<]+|</g;
const ATTR = /([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(ATTR)) attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  return attrs;
}

/** End tag: close up to the nearest open element with that tag; an unknown end tag is ignored. */
function closeTo(cur, tag) {
  let n = cur;
  while (n && n.tag !== tag) n = n.parent;
  return n?.parent ? n.parent : cur;
}

/** One token applied to the tree: returns the new current element and raw-text tag. */
function applyToken(m, at, cur) {
  if (m[0].startsWith("<!--")) return { cur, raw: null };
  if (!m[2]) {
    cur.children.push({ text: m[0], line: at, parent: cur });
    return { cur, raw: null };
  }
  const tag = m[2].toLowerCase();
  if (m[1] === "/") return { cur: closeTo(cur, tag), raw: null };
  const el = { tag, attrs: parseAttrs(m[3] || ""), line: at, children: [], parent: cur };
  cur.children.push(el);
  if (RAW.has(tag)) return { cur, raw: tag };
  return { cur: !VOID.has(tag) && !m[4] ? el : cur, raw: null };
}

/** Parse to {children: [...]}; element = {tag, attrs, line, children, parent}; text = {text, line}. */
export function parseHtml(src) {
  const root = { tag: null, children: [], parent: null };
  let cur = root;
  let line = 1;
  let raw = null; // inside <script>/<style>: skip until its end tag
  for (const m of src.matchAll(TOKEN)) {
    const at = line;
    line += (m[0].match(/\n/g) || []).length;
    if (raw) {
      if (m[1] === "/" && m[2]?.toLowerCase() === raw) raw = null;
      continue;
    }
    ({ cur, raw } = applyToken(m, at, cur));
  }
  return root;
}

export const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const escAttr = (s) => escHtml(s).replace(/"/g, "&quot;");
export const isVoid = (tag) => VOID.has(tag);
