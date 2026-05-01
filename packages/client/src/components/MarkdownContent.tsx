import React, { useRef, useCallback, useMemo, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useThemeContext } from "./ThemeProvider.js";
import { getSyntaxTheme } from "../lib/syntax-theme.js";
import { Icon } from "@mdi/react";
import { mdiContentCopy, mdiTable } from "@mdi/js";
import { CopyButton } from "./CopyButton.js";
import { wrapAsciiTables } from "../lib/wrap-ascii-tables.js";
import { MermaidBlock } from "./MermaidBlock.js";

interface Props {
  content: string;
}

type HastNode = {
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function stripReactRefAttributes() {
  return function transformer(tree: HastNode) {
    visitHast(tree, (node) => {
      if (node.properties && Object.prototype.hasOwnProperty.call(node.properties, "ref")) {
        delete node.properties.ref;
      }
    });
  };
}

function visitHast(node: HastNode, visitor: (node: HastNode) => void) {
  visitor(node);
  for (const child of node.children ?? []) {
    visitHast(child, visitor);
  }
}

/**
 * Returns true when `href` resolves to an origin different from the current
 * page (i.e. the link is external and clicking it would strand the user if it
 * replaced the dashboard view). Fragment-only refs (`#foo`), relative paths,
 * and absolute URLs matching `window.location.origin` are all considered
 * internal. Unparseable hrefs are treated as external so the anchor gets
 * `target="_blank"` — safer than silently navigating away.
 * See issue #13.
 */
export function isExternalHref(href: string | undefined): boolean {
  if (!href) return false; // bare <a> without href → leave alone
  if (href.startsWith("#")) return false; // fragment-only, same-document
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const resolved = new URL(href, base);
    return resolved.origin !== new URL(base).origin;
  } catch {
    return true;
  }
}

/** Convert a <table> DOM element to markdown */
export function tableToMarkdown(table: HTMLTableElement): string {
  const rows: string[][] = [];
  for (const row of table.rows) {
    const cells: string[] = [];
    for (const cell of row.cells) {
      cells.push(cell.textContent?.trim() ?? "");
    }
    rows.push(cells);
  }
  if (rows.length === 0) return "";

  const header = `| ${rows[0].join(" | ")} |`;
  const separator = `| ${rows[0].map(() => "---").join(" | ")} |`;
  const body = rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
  return [header, separator, body].join("\n");
}

/** Convert a <table> DOM element to TSV */
export function tableToTsv(table: HTMLTableElement): string {
  const lines: string[] = [];
  for (const row of table.rows) {
    const cells: string[] = [];
    for (const cell of row.cells) {
      cells.push(cell.textContent?.trim() ?? "");
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function CodeBlockWrapper({ codeString, children }: { codeString: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      <div className="flex justify-end gap-0.5 -mt-1 mb-1 opacity-50 hover:opacity-100 transition-opacity">
        <CopyButton text={codeString} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy code" />
      </div>
    </div>
  );
}

function TableWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const getTable = useCallback(() => {
    return ref.current?.querySelector("table") as HTMLTableElement | null;
  }, []);

  const copyMarkdown = useCallback(() => {
    const table = getTable();
    return table ? tableToMarkdown(table) : "";
  }, [getTable]);

  const copyTsv = useCallback(() => {
    const table = getTable();
    return table ? tableToTsv(table) : "";
  }, [getTable]);

  return (
    <div ref={ref}>
      {children}
      <div className="flex justify-end gap-0.5 -mt-1 mb-1 opacity-50 hover:opacity-100 transition-opacity">
        <CopyButton text={copyMarkdown()} icon={<Icon path={mdiContentCopy} size={0.6} />} title="Copy as Markdown" />
        <CopyButton text={copyTsv()} icon={<Icon path={mdiTable} size={0.6} />} title="Copy as TSV" />
      </div>
    </div>
  );
}

/**
 * Regex matching characters that may render wider than 1ch in monospace fonts.
 * Includes:
 * - Emoji (1F300-1F9FF, 2600-26FF, 2700-27BF)
 * - Arrows (2190-21FF) e.g. → ← ↑ ↓
 * - Em/en dashes (2014, 2013)
 * - General punctuation wide chars (2012-2015)
 * - Math operators (some wide ones)
 * - CJK would be here too but less common in LLM ASCII art
 */
const WIDE_CHARS = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u2190-\u21FF\u2012-\u2015][\uFE0E\uFE0F]?/gu;

/** Check if a codepoint is an emoji (renders double-width in terminals) */
function isEmoji(cp: number): boolean {
  return (cp >= 0x1F300 && cp <= 0x1F9FF) ||
         (cp >= 0x2600 && cp <= 0x26FF) ||
         (cp >= 0x2700 && cp <= 0x27BF);
}

/**
 * Walk text nodes inside <pre> elements and wrap wide Unicode characters
 * in fixed-width spans. Emoji get 2ch (terminal double-width), other
 * wide chars (arrows, em-dashes) get 1ch to prevent them rendering wider.
 */
function fixWideCharsInCodeBlocks(container: HTMLElement) {
  const pres = container.querySelectorAll("pre");
  for (const pre of pres) {
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (WIDE_CHARS.test(node.data)) {
        textNodes.push(node);
      }
      WIDE_CHARS.lastIndex = 0;
    }

    for (const textNode of textNodes) {
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      WIDE_CHARS.lastIndex = 0;

      while ((match = WIDE_CHARS.exec(textNode.data)) !== null) {
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(textNode.data.slice(lastIndex, match.index)));
        }
        const cp = match[0].codePointAt(0)!;
        const span = document.createElement("span");
        span.style.display = "inline-block";
        // Emoji = 2ch (terminal double-width), other wide chars = 1ch
        span.style.width = isEmoji(cp) ? "2ch" : "1ch";
        span.style.textAlign = "center";
        span.style.overflow = "hidden";
        span.textContent = match[0];
        frag.appendChild(span);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < textNode.data.length) {
        frag.appendChild(document.createTextNode(textNode.data.slice(lastIndex)));
      }

      textNode.parentNode?.replaceChild(frag, textNode);
    }
  }
}

export const MarkdownContent = React.memo(function MarkdownContent({ content }: Props) {
  // ASCII table monospace fixer — disabled pending further refinement
  // const processedContent = useMemo(() => wrapAsciiTables(content), [content]);
  const processedContent = content;
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);

  // Wide char width fixer — disabled pending further refinement
  // useEffect(() => {
  //   if (containerRef.current) {
  //     fixWideCharsInCodeBlocks(containerRef.current);
  //   }
  // });

  return (
    <div ref={containerRef} className="markdown-content text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, stripReactRefAttributes]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");

            if (match && match[1] === "mermaid") {
              return <MermaidBlock code={codeString} />;
            }

            if (match) {
              return (
                <CodeBlockWrapper codeString={codeString}>
                  <SyntaxHighlighter
                    style={syntaxStyle}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{ background: 'var(--bg-code)' }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </CodeBlockWrapper>
              );
            }

            // Check if this is a block code (inside <pre>) or inline
            // react-markdown wraps block code in <pre><code>, inline is just <code>
            const isInline = !className && codeString.indexOf("\n") === -1;

            if (isInline) {
              return (
                <code
                  className="bg-[var(--bg-surface)] px-1.5 py-0.5 rounded text-sm font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlockWrapper codeString={codeString}>
                <pre className="bg-[var(--bg-code)] rounded-md p-4 overflow-x-auto" style={{ whiteSpace: "pre", margin: 0 }}>
                  <code style={{ whiteSpace: "pre" }}>{codeString}</code>
                </pre>
              </CodeBlockWrapper>
            );
          },
          table({ children }) {
            return (
              <TableWrapper>
                <table>{children}</table>
              </TableWrapper>
            );
          },
          // External links open in a new tab/window with reverse-tabnabbing
          // protection so clicking a URL in chat content never strands the
          // dashboard view. Same-origin and fragment links stay in-document.
          // See issue #13.
          a({ href, children, ...props }) {
            const external = isExternalHref(href);
            return (
              <a
                href={href}
                className="text-blue-400 hover:underline"
                {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                {...props}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
