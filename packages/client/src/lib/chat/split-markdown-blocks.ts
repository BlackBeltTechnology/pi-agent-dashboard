/**
 * Parser-based top-level block split for the streaming tail (design D4, step 2).
 *
 * Paced reveal re-renders the tail on (up to) every reveal step, and
 * `MarkdownContent` is one remark → rehype → React pass over the WHOLE text. Only
 * the LAST block changes while text streams, so the completed blocks can be
 * rendered as separate memoized `MarkdownContent` instances that skip re-render.
 *
 * Boundaries come from the markdown PARSER (the same grammar `MarkdownContent`
 * uses: GFM, math, frontmatter), never from a regex over blank lines, so indented
 * code, tables, blockquotes, HTML blocks and loose lists are never mis-split —
 * each is one top-level mdast node. Block `k` is `text.slice(start_k, start_{k+1})`
 * (a block carries its trailing blank lines), so a completed block's string is
 * identical across steps and its memo holds.
 *
 * Mermaid ordinals (`remarkMermaidOrdinal`) are only consumed for file previews
 * (`mermaidSource`), never for the chat tail, so no per-block ordinal offset is
 * needed here.
 *
 * See change: add-fluid-chat-motion.
 */
import remarkParse from "remark-parse";
import { unified } from "unified";
import { MARKDOWN_REMARK_PLUGINS } from "../preview/markdown-remark-plugins.js";

const processor = unified().use(remarkParse).use(MARKDOWN_REMARK_PLUGINS);

interface MdBlock {
  position?: { start: { offset?: number } };
}

/** Split `text` into top-level markdown blocks; `[text]` when it is one block (or unparseable). */
export function splitTopLevelBlocks(text: string): string[] {
  if (!text) return [];
  try {
    const tree = processor.parse(text) as { children?: MdBlock[] };
    const starts: number[] = [];
    for (const child of tree.children ?? []) {
      const offset = child.position?.start.offset;
      if (typeof offset === "number") starts.push(offset);
    }
    if (starts.length <= 1) return [text];
    // Anything before the first node (leading blank lines) belongs to block 0.
    starts[0] = 0;
    return starts.map((start, i) => text.slice(start, i + 1 < starts.length ? starts[i + 1] : text.length));
  } catch {
    return [text];
  }
}
