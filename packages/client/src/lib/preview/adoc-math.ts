/**
 * Render asciidoctor `latexmath` passthrough in rendered AsciiDoc HTML.
 *
 * Asciidoctor emits `stem:[…]` as `\(…\)` and `[stem]` blocks as `\[…\]`, leaving
 * rendering to a client-side math engine. The input is server-sanitized HTML;
 * this parses it into a `<template>`, replaces the delimiters ONLY inside text
 * nodes outside `<pre>`/`<code>` with KaTeX output (`trust:false`) parsed into
 * nodes — never string-spliced into serialized HTML, so attribute values and
 * code listings stay literal and no markup can be broken open. A delimiter
 * pair split across inline tags (`\(a <em>b</em>\)`) stays literal. KaTeX is
 * injected so callers can load it lazily.
 * See change: sanitize-untrusted-rendered-content.
 */
import type katexType from "katex";

type Katex = Pick<typeof katexType, "renderToString">;

export function hasAdocMath(html: string): boolean {
  return /\\\(|\\\[/.test(html);
}

/** Replacement fragment for one text node, or null when it holds no complete pair. */
function typesetText(text: Text, katex: Katex): DocumentFragment | null {
  const re = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (let m = re.exec(text.data); m; m = re.exec(text.data)) {
    if (m.index > last) frag.append(text.data.slice(last, m.index));
    const out = document.createElement("template");
    out.innerHTML = katex.renderToString(m[1] ?? m[2] ?? "", {
      displayMode: m[2] !== undefined,
      throwOnError: false,
      trust: false,
    });
    frag.append(out.content);
    last = m.index + m[0].length;
  }
  if (last === 0) return null;
  if (last < text.data.length) frag.append(text.data.slice(last));
  return frag;
}

export function renderAdocMath(html: string, katex: Katex): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    if (hasAdocMath(text.data) && !text.parentElement?.closest("pre, code")) texts.push(text);
  }
  let changed = false;
  for (const text of texts) {
    const frag = typesetText(text, katex);
    if (frag) {
      text.replaceWith(frag);
      changed = true;
    }
  }
  return changed ? tpl.innerHTML : html;
}
