// Structural (heading) chunker — fence-safe, breadcrumb-aware (design §3).
// Line-based with a fenced-code state machine; validated in the prototype
// (research §2.5). mdast (unified/remark) is the documented refinement.
import { createHash } from "node:crypto";
import { type FmValue, parseFrontmatter } from "./frontmatter.js";
import type { Chunk, DocType } from "./types.js";

// Shared with the AsciiDoc chunker (adoc-chunker.ts) so both normalize with the
// SAME thresholds and id/hash scheme (chunk-contract parity, design D3).
export const MIN_CHUNK_CHARS = 100;
export const MAX_CHUNK_CHARS = 4000;

export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ChunkInput {
  root: string;
  path: string; // relative
  text: string;
  docType?: DocType;
}

export interface ParseResult {
  chunks: Chunk[];
  frontmatter: Record<string, FmValue> | null;
  wikilinks: string[]; // [[name]] targets found anywhere in the file
  mdLinks: string[]; // [text](path.md) relative targets
  parseFailed: boolean; // frontmatter block present but a line did not parse
}

/**
 * `[[x]]` scanner. Linear: `close` (next `]`) only moves forward, so unclosed
 * openers never rescan (the old `/\[\[([^\]]+)\]\]/g` was quadratic).
 */
function scanWikilinks(text: string): string[] {
  const out: string[] = [];
  let close = -1;
  let i = text.indexOf("[[");
  while (i !== -1) {
    if (close < i + 2) {
      close = text.indexOf("]", i + 2);
      if (close === -1) break;
    }
    if (close > i + 2 && text[close + 1] === "]") {
      out.push(text.slice(i + 2, close).trim());
      i = text.indexOf("[[", close + 2);
    } else {
      i = text.indexOf("[[", i + 1);
    }
  }
  return out;
}

/** `](x.md)` / `](x.mdx)` scanner; same forward-only `close` pointer (next `)`). */
function scanMdLinks(text: string): string[] {
  const out: string[] = [];
  let close = -1;
  let i = text.indexOf("](");
  while (i !== -1) {
    if (close < i + 2) {
      close = text.indexOf(")", i + 2);
      if (close === -1) break;
    }
    const len = close - (i + 2);
    if ((len >= 4 && text.endsWith(".md", close)) || (len >= 5 && text.endsWith(".mdx", close))) {
      out.push(text.slice(i + 2, close).trim());
      i = text.indexOf("](", close + 1);
    } else {
      i = text.indexOf("](", i + 1);
    }
  }
  return out;
}

export function chunkMarkdown(input: ChunkInput): ParseResult {
  const docType: DocType = input.docType ?? "doc";
  const { body: text, fm, parseFailed } = parseFrontmatter(input.text);
  const lines = text.split("\n");
  const fileTitle = input.path.split("/").pop()!.replace(/\.(md|mdx|markdown)$/i, "");

  const raw: Array<{ headingPath: string; heading: string; level: number; parentChunkId: string | null; body: string }> = [];
  const stack: { level: number; title: string; chunkOrdinal: number }[] = [];
  let cur: (typeof raw)[number] | null = null;
  let inFence = false;
  let fenceCh = "";
  let ordinal = 0;

  const flush = () => {
    if (cur && cur.body.trim()) raw.push(cur);
  };

  for (const line of lines) {
    const t = line.trimStart();
    const fm2 = t.match(/^(```+|~~~+)/);
    if (fm2) {
      if (!inFence) {
        inFence = true;
        fenceCh = fm2[1][0];
      } else if (t.startsWith(fenceCh)) {
        inFence = false;
      }
      if (cur) cur.body += line + "\n";
      continue;
    }
    const hm = !inFence && line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      flush();
      const level = hm[1].length;
      const title = hm[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parentOrdinal = stack.length ? stack[stack.length - 1].chunkOrdinal : -1;
      stack.push({ level, title, chunkOrdinal: ordinal });
      cur = {
        headingPath: stack.map((s) => s.title).join(" > "),
        heading: title,
        level,
        parentChunkId: parentOrdinal >= 0 ? String(parentOrdinal) : null,
        body: "",
      };
      ordinal++;
    } else {
      if (!cur) {
        cur = { headingPath: fileTitle, heading: fileTitle, level: 0, parentChunkId: null, body: "" };
        ordinal++;
      }
      cur.body += line + "\n";
    }
  }
  flush();

  // merge tiny chunks up into the previous (design §3 step 5)
  const merged: typeof raw = [];
  for (const c of raw) {
    if (c.body.trim().length < MIN_CHUNK_CHARS && merged.length) {
      merged[merged.length - 1].body += "\n" + c.heading + "\n" + c.body;
    } else merged.push(c);
  }

  // split oversized leaf sections by paragraph (design §3 step 6)
  const sized: typeof raw = [];
  for (const c of merged) {
    if (c.body.length <= MAX_CHUNK_CHARS) {
      sized.push(c);
      continue;
    }
    const paras = c.body.split(/\n\s*\n/);
    let buf = "";
    for (const p of paras) {
      if ((buf + p).length > MAX_CHUNK_CHARS && buf) {
        sized.push({ ...c, body: buf });
        buf = "";
      }
      buf += p + "\n\n";
    }
    if (buf.trim()) sized.push({ ...c, body: buf });
  }

  const fileSha = sha(input.path);
  const chunks: Chunk[] = sized.map((c, i) => ({
    root: input.root,
    path: input.path,
    chunkId: `${fileSha.slice(0, 8)}:${i}`,
    headingPath: c.headingPath,
    heading: c.heading,
    level: c.level,
    parentChunkId: c.parentChunkId ? `${fileSha.slice(0, 8)}:${c.parentChunkId}` : null,
    docType,
    body: c.body.trimEnd(),
    bodyHash: sha(c.body.trim()),
  }));

  const wikilinks = scanWikilinks(input.text);
  const mdLinks = scanMdLinks(input.text);

  return { chunks, frontmatter: fm, wikilinks, mdLinks, parseFailed };
}
