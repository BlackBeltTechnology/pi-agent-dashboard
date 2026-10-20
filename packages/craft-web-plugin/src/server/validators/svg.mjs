// SVG script filter (D7). `/api/file/raw` serves `.svg` inline, so a script-bearing SVG a frame writes must not
// reach disk. A bounded, full-document TOKENIZER (no XML parser, no entity expansion):
//   - skips the XML declaration, comments, processing instructions and whitespace before the root;
//   - rejects `<!DOCTYPE` / `<!ENTITY` anywhere;
//   - the first element's local name must be `svg`;
//   - element names compare by LOCAL name (prefix-insensitive: `svg:script`);
//   - rejects `script`, `foreignObject`, `iframe`, `embed`, `object`, `handler` elements;
//   - rejects any `on*` attribute;
//   - rejects SMIL `set` / `animate*` whose `attributeName` is `on*`, `href` or `xlink:href`;
//   - attribute values are decoded (numeric + named character references) and stripped of whitespace /
//     control characters before the URL check: `javascript:`, `vbscript:`, `data:text/html` → reject.
// Scans the whole document (the claim caps SVG at 16 MiB). See change: extend-craft-web-to-all-apps.
import { latin1, OK, reject } from "./text-window.mjs";

const BANNED_ELEMENTS = new Set(["script", "foreignobject", "iframe", "embed", "object", "handler"]);
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: "\t", newline: "\n", sol: "/", lpar: "(", rpar: ")" };
const BAD_URL = /^(?:javascript|vbscript):|^data:text\/html/i;

/** Decode numeric + named character references (unknown names left as-is). */
function decodeRefs(v) {
  return v.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));?/gi, (m, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Math.min(Number(dec), 0x10ffff));
    if (hex) return String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff));
    const n = NAMED[name.toLowerCase()];
    return n === undefined ? m : n;
  });
}

const localName = (qname) => qname.slice(qname.lastIndexOf(":") + 1).toLowerCase();
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function checkElement(name, attrs) {
  const local = localName(name);
  if (BANNED_ELEMENTS.has(local)) return `<${name}> is not allowed`;
  const smil = local === "set" || local.startsWith("animate");
  for (const m of attrs.matchAll(ATTR_RE)) {
    const attr = m[1];
    const aLocal = localName(attr);
    if (aLocal.startsWith("on")) return `event handler attribute ${attr}`;
    const raw = m[2] ?? m[3] ?? m[4] ?? "";
    const value = decodeRefs(raw);
    if (smil && aLocal === "attributename") {
      const target = value.trim().toLowerCase();
      if (target.startsWith("on") || localName(target) === "href") return `animation of ${value.trim()}`;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what the strip removes
    const compact = value.replace(/[\s\u0000-\u001f]+/g, "");
    if (BAD_URL.test(compact)) return `script URL in ${attr}`;
  }
  return null;
}

/** @param {Uint8Array} bytes */
export function validateSvg(bytes) {
  const text = latin1(bytes, 0, bytes.length);
  let i = 0;
  let seenRoot = false;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt < 0) break;
    // Only whitespace (and a leading UTF-8 BOM, latin-1 decoded) may precede the root element.
    if (!seenRoot && text.slice(i, lt).replace(/^(?:\uFEFF|\u00ef\u00bb\u00bf)/, "").trim() !== "") return reject("text before the root element");
    if (text.startsWith("<!--", lt)) {
      const end = text.indexOf("-->", lt + 4);
      if (end < 0) return reject("unterminated comment");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<?", lt)) {
      const end = text.indexOf("?>", lt + 2);
      if (end < 0) return reject("unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (text.startsWith("<![CDATA[", lt)) {
      const end = text.indexOf("]]>", lt + 9);
      if (end < 0) return reject("unterminated CDATA");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<!", lt)) return reject("DOCTYPE / ENTITY declarations are not allowed");
    if (text.startsWith("</", lt)) {
      const end = text.indexOf(">", lt);
      if (end < 0) return reject("unterminated end tag");
      i = end + 1;
      continue;
    }
    // Start tag: the name, then attributes up to the closing `>` outside quotes.
    const nameMatch = /^<([^\s/>]+)/.exec(text.slice(lt, lt + 256));
    if (!nameMatch) {
      i = lt + 1;
      continue;
    }
    let j = lt + nameMatch[0].length;
    let quote = "";
    for (; j < n; j++) {
      const c = text[j];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
    }
    if (j >= n) return reject("unterminated start tag");
    const name = nameMatch[1];
    if (!seenRoot) {
      if (localName(name) !== "svg") return reject("the root element is not <svg>");
      seenRoot = true;
    }
    const problem = checkElement(name, text.slice(lt + nameMatch[0].length, j));
    if (problem) return reject(problem);
    i = j + 1;
  }
  return seenRoot ? OK : reject("no <svg> root element");
}
