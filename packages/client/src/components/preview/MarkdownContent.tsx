import { mdiContentCopy, mdiTable } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { tokenize } from "../../lib/chat/linkify-tool-output.js";
import { useSessionAssets } from "../../lib/session/SessionAssetsContext.js";
import { getSyntaxTheme } from "../../lib/theme/syntax-theme.js";
import { useLoopbackLinkOpen } from "../../lib/use-loopback-link-open.js";
import { wrapAsciiTables } from "../../lib/preview/wrap-ascii-tables.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";
import { extractFrontmatter, FrontmatterProperties } from "./FrontmatterProperties.js";
import { ImageLightbox } from "./ImageLightbox.js";
import { MermaidBlock } from "./MermaidBlock.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
import { FileLink } from "../tool-renderers/FileLink.js";
import type { ToolContext } from "../tool-renderers/types.js";
import { UrlLink } from "../tool-renderers/UrlLink.js";

interface Props {
  content: string;
  /**
   * When provided, inline prose text and inline-`code` spans are run through
   * the tool-output tokenizer so file references and URLs become clickable.
   * Fenced/multi-line code blocks are never linkified. Omit to render plain
   * markdown (the default for non-chat surfaces).
   * See change: unify-file-link-openability.
   */
  context?: ToolContext;
  /**
   * Controls rendering of a leading YAML frontmatter block. `remark-frontmatter`
   * always strips the block from the markdown body (so it never mangles into a
   * heading), regardless of this prop. "hide" (default) renders nothing in its
   * place — preserves chat behavior. "properties" renders an Obsidian-style
   * Properties panel above the body. File/spec/skill surfaces opt in.
   * See change: improve-frontmatter-rendering.
   */
  frontmatter?: "hide" | "properties";
}

/**
 * Tokenize a plain string and render file/URL tokens as clickable elements,
 * leaving text verbatim. Used only for inline contexts (paragraph text, list
 * items, inline code). Wrapped by `linkifyChildren` in an ErrorBoundary.
 */
function renderInlineString(text: string, context: ToolContext, keyPrefix: string): React.ReactNode {
  return tokenize(text).map((tok, i) => {
    const key = `${keyPrefix}-${i}`;
    if (tok.kind === "text") return <React.Fragment key={key}>{tok.text}</React.Fragment>;
    if (tok.kind === "url") return <UrlLink key={key} href={tok.text}>{tok.text}</UrlLink>;
    return (
      <FileLink key={key} path={tok.path} line={tok.line} col={tok.col} absolute={tok.absolute} context={context}>
        {tok.text}
      </FileLink>
    );
  });
}

/**
 * Map react-markdown inline children: linkify string nodes, pass every other
 * node (existing markdown anchors, bold, nested elements) through untouched so
 * real link anchors are never double-wrapped. Fault-isolated so a tokenizer
 * throw degrades to the original children rather than crashing the render.
 */
function linkifyChildren(children: React.ReactNode, context: ToolContext): React.ReactNode {
  return (
    <ErrorBoundary fallback={<>{children}</>}>
      {React.Children.map(children, (child, i) =>
        typeof child === "string" ? renderInlineString(child, context, `lk-${i}`) : child,
      )}
    </ErrorBoundary>
  );
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

/**
 * Returns true when the fenced block holding `code` has a closing fence in the
 * raw markdown `content`. During streaming an unclosed mermaid block is the
 * trailing fence: its content grows token-by-token with no closing ``` yet, so
 * `after` carries no fence and we report incomplete. Once the fence arrives the
 * block's source is final. Unmatched `code` (e.g. HTML-entity differences) falls
 * back to `true` so rendering is never blocked — worst case is prior behaviour.
 */
export function isFencedBlockComplete(content: string, code: string): boolean {
  const idx = content.indexOf(code);
  if (idx === -1) return true;
  return content.slice(idx + code.length).includes("```");
}

function CodeBlockWrapper({ codeString, children }: { codeString: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      <div className="flex justify-end gap-0.5 -mt-1 mb-1 opacity-50 hover:opacity-100 transition-opacity">
        <CopyButton getText={() => codeString} icon={<Icon path={mdiContentCopy} size={0.6} />} title={i18nT("common.copyCode", undefined, "Copy code")} />
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
        <CopyButton getText={copyMarkdown} icon={<Icon path={mdiContentCopy} size={0.6} />} title={i18nT("common.copyAsMarkdown", undefined, "Copy as Markdown")} />
        <CopyButton getText={copyTsv} icon={<Icon path={mdiTable} size={0.6} />} title={i18nT("common.copyAsTsv", undefined, "Copy as TSV")} />
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

/**
 * `img` component override for ReactMarkdown that resolves
 * `pi-asset:<hash>` srcs against the active `SessionAssetsContext` map
 * (populated from `asset_register` WS messages). All other src schemes
 * (`data:`, `http(s):`, `blob:`, fragment, relative) fall through to a
 * default `<img>` with the original `src` so existing web-image and
 * tool-result-image behavior is preserved.
 *
 * When the hash is not yet in the map (e.g. `asset_register` arrives in
 * a later chunk), the placeholder element renders. The component
 * re-renders automatically when the context value changes, swapping the
 * placeholder for the resolved image without remount.
 *
 * See change: chat-markdown-local-images-and-math.
 */
function PiAssetImg(props: React.ImgHTMLAttributes<HTMLImageElement>) {
  const assets = useSessionAssets();
  const [lightboxSrc, setLightboxSrc] = React.useState<{ src: string; alt: string } | null>(null);
  const { src, alt, className: incomingClass, onClick: _drop, ...rest } = props;
  const altText = typeof alt === "string" ? alt : "";
  const baseClass = `${incomingClass ?? ""} cursor-pointer`.trim();
  // Reserve height before decode (CR-7) so an above-viewport async image load
  // does not shift the windowed scroll offset; release to natural height on
  // load (accepts one reflow per image). See change:
  // virtualize-chat-transcript-tanstack (task 8.1).
  const reserveStyle = { minHeight: "6rem" } as const;
  const releaseReserved = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.minHeight = "";
  };

  const openLightbox = (e: React.MouseEvent, lbSrc: string) => {
    // Stop propagation so a wrapping markdown link `[![](...)](href)` does
    // not navigate when the user clicks to enlarge the image. See change:
    // add-lightbox-to-markdown-images.
    e.stopPropagation();
    e.preventDefault();
    setLightboxSrc({ src: lbSrc, alt: altText });
  };

  // pi-asset:<hash> path — resolve to data: URL or render placeholder.
  if (typeof src === "string" && src.startsWith("pi-asset:")) {
    const hash = src.slice("pi-asset:".length);
    const asset = assets[hash];
    if (asset) {
      const dataUrl = `data:${asset.mimeType};base64,${asset.data}`;
      return (
        <>
          <img
            {...rest}
            src={dataUrl}
            alt={alt}
            className={baseClass}
            style={reserveStyle}
            onLoad={releaseReserved}
            onClick={(e) => openLightbox(e, dataUrl)}
          />
          {lightboxSrc && (
            <ImageLightbox
              src={lightboxSrc.src}
              alt={lightboxSrc.alt}
              onClose={() => setLightboxSrc(null)}
            />
          )}
        </>
      );
    }
    // Unresolved hash — placeholder span is intentionally non-interactive.
    return (
      <span
        className="inline-block px-2 py-1 my-1 text-xs italic text-[var(--text-muted)] bg-[var(--bg-surface)] rounded border border-dashed border-[var(--border-secondary)]"
        title={`Asset ${hash} not yet loaded`}
      >
        ⦿ {alt || "image"} (loading…)
      </span>
    );
  }

  // Fall-through: external URL, blob, inline data:, fragment, etc. Render
  // a default <img> with click-to-open lightbox affordance using the
  // original src verbatim (the lightbox just renders <img src> — whatever
  // the page-level <img> can load, the modal can load).
  if (typeof src !== "string") {
    return <img {...rest} src={src} alt={alt} />;
  }
  return (
    <>
      <img
        {...rest}
        src={src}
        alt={alt}
        className={baseClass}
        style={reserveStyle}
        onLoad={releaseReserved}
        onClick={(e) => openLightbox(e, src)}
      />
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc.src}
          alt={lightboxSrc.alt}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}

export const MarkdownContent = React.memo(function MarkdownContent({ content, context, frontmatter = "hide" }: Props) {
  // ASCII table monospace fixer — disabled pending further refinement
  // const processedContent = useMemo(() => wrapAsciiTables(content), [content]);
  const processedContent = content;
  const containerRef = useRef<HTMLDivElement>(null);
  const onLoopbackClick = useLoopbackLinkOpen();
  const { resolved: theme, themeName } = useThemeContext();
  const syntaxStyle = getSyntaxTheme(theme, themeName);

  // Wide char width fixer — disabled pending further refinement
  // useEffect(() => {
  //   if (containerRef.current) {
  //     fixWideCharsInCodeBlocks(containerRef.current);
  //   }
  // });

  const fm = frontmatter === "properties" ? extractFrontmatter(processedContent) : null;

  return (
    <div ref={containerRef} className="markdown-content text-sm">
      {fm && <FrontmatterProperties raw={fm.raw} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkFrontmatter]}
        // Plugin order matters:
        //  - rehypeRaw FIRST so embedded HTML in markdown source is parsed
        //    before rehype-katex emits its own KaTeX HTML (KaTeX HTML must
        //    NOT be re-parsed by rehype-raw).
        //  - rehypeKatex with throwOnError:false so half-formed mid-stream
        //    expressions like `$x = 10 +` render as a fallback rather than
        //    crashing the markdown render.
        //  - stripReactRefAttributes LAST.
        // See change: chat-markdown-local-images-and-math.
        rehypePlugins={[rehypeRaw, [rehypeKatex, { throwOnError: false }], stripReactRefAttributes]}
        // ReactMarkdown's default urlTransform sanitizes unknown schemes
        // (e.g. `pi-asset:`, `data:`) to an empty string before our `img`
        // override sees them. Pass through every src verbatim and let the
        // PiAssetImg / a / etc. overrides do the gating.
        // See change: chat-markdown-local-images-and-math.
        urlTransform={(value) => value}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const codeString = String(children).replace(/\n$/, "");

            if (match && match[1] === "mermaid") {
              return (
                <MermaidBlock
                  code={codeString}
                  complete={isFencedBlockComplete(processedContent, codeString)}
                />
              );
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
                  {context ? renderInlineString(codeString, context, "code") : children}
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
          // Linkify inline prose. Only enabled when a `context` is supplied
          // (chat surfaces); fenced/multi-line code blocks render via the
          // `code` override above and are never linkified.
          // See change: unify-file-link-openability.
          ...(context
            ? {
                p({ node: _node, children }: any) {
                  return <p>{linkifyChildren(children, context)}</p>;
                },
                li({ node: _node, children }: any) {
                  return <li>{linkifyChildren(children, context)}</li>;
                },
              }
            : {}),
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
                // Loopback links route into the internal live-server split
                // viewer on a plain click; modifier/middle-click and the
                // no-context fallback keep the native target="_blank" tab.
                onClick={href ? (e) => onLoopbackClick(e, href) : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
          img: PiAssetImg,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
});
