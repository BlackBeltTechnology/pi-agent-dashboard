/**
 * Render asciidoctor `latexmath` passthrough in rendered AsciiDoc HTML.
 *
 * Asciidoctor emits `stem:[…]` as `\(…\)` and `[stem]` blocks as `\[…\]`, leaving
 * rendering to a client-side math engine. This replaces those delimiters with
 * KaTeX HTML (KaTeX escapes its input; `trust` stays off). `<pre>`/`<code>`
 * spans are left untouched so code listings keep literal `\(` text. KaTeX is
 * injected so callers can load it lazily.
 */
import type katexType from "katex";

type Katex = Pick<typeof katexType, "renderToString">;

const MATH_RE = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
// Split out code spans; odd indices are protected (pre/code) chunks.
const CODE_RE = /(<pre[\s>][\s\S]*?<\/pre>|<code[\s>][\s\S]*?<\/code>)/gi;

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };
const decode = (s: string): string => s.replace(/&(?:lt|gt|amp|quot|#39);/g, (m) => ENTITIES[m] ?? m);

export function hasAdocMath(html: string): boolean {
  return /\\\(|\\\[/.test(html);
}

export function renderAdocMath(html: string, katex: Katex): string {
  return html
    .split(CODE_RE)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk.replace(MATH_RE, (_m, inline: string | undefined, block: string | undefined) =>
            katex.renderToString(decode(inline ?? block ?? ""), {
              displayMode: block !== undefined,
              throwOnError: false,
            }),
          ),
    )
    .join("");
}
