// Indexer: walk a filesystem source, layered mtime→sha256 change detection,
// structural chunking, Tier-1 graph extraction, transactional upsert (design §5).
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { chunkMarkdown } from "./chunker.js";
import type { DocType, KbStore } from "./types.js";

export interface IndexSource {
  root: string; // label/id stored on chunks
  dir: string; // absolute directory to walk
  include?: (rel: string) => boolean;
}
export interface IndexOptions {
  force?: boolean;
  indexAgentsFiles?: boolean; // AGENTS.md / CLAUDE.md
  includeSourceMarkdown?: boolean; // *.md in source dirs → doc_type 'source-md'
  include?: string[]; // glob patterns to include
  exclude?: string[]; // glob patterns to exclude
  extensions?: string[]; // e.g. [".md"]
}
export interface IndexStats {
  scanned: number;
  changed: number;
  deleted: number;
  chunks: number;
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const DEFAULT_EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|\.kb)(\/|$)/;

/** Minimal glob → RegExp (supports **, *, ?). Good enough for include/exclude. */
function globToRe(g: string): RegExp {
  const body = g
    .replace(/[.+^$(){}|\\]/g, "\\$&")
    .replace(/\*\*\//g, "«GS»")
    .replace(/\*\*/g, "«G»")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/«GS»/g, "(.*/)?")
    .replace(/«G»/g, ".*");
  return new RegExp("(^|/)" + body + "$");
}
function matchAny(pats: RegExp[], rel: string): boolean {
  return pats.some((re) => re.test(rel));
}

function walk(dir: string, base: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    const rel = relative(base, abs);
    if (DEFAULT_EXCLUDE.test(rel)) continue;
    if (e.isDirectory()) walk(abs, base, out);
    else if (/\.(md|mdx|markdown)$/i.test(e.name)) out.push(abs);
  }
  return out;
}

function docTypeOf(rel: string, includeSourceMarkdown: boolean): DocType {
  const base = rel.split("/").pop() ?? "";
  // `<File>.AGENTS.md` = per-file index sidecar (large-row promotion). Classified
  // `agents` so it is searchable, but its name != "AGENTS.md" so pi's native
  // up-walk never auto-injects it (pull-only via kb search).
  if (base === "AGENTS.md" || base === "CLAUDE.md" || base.endsWith(".AGENTS.md")) return "agents";
  if (includeSourceMarkdown && /(^|\/)(src|lib|app|packages)\//.test(rel)) return "source-md";
  return "doc";
}

export function indexSource(store: KbStore, src: IndexSource, opts: IndexOptions = {}): IndexStats {
  const extRe = opts.extensions?.length ? new RegExp("(" + opts.extensions.map((e) => e.replace(/\./g, "\\.")).join("|") + ")$", "i") : /\.(md|mdx|markdown)$/i;
  const inc = opts.include?.map(globToRe);
  const exc = opts.exclude?.map(globToRe);
  const includeSourceMd = opts.includeSourceMarkdown !== false;
  const files = walk(src.dir, src.dir).filter((abs) => {
    const rel = relative(src.dir, abs);
    if (src.include && !src.include(rel)) return false;
    if (inc && !matchAny(inc, rel)) return false;
    if (exc && matchAny(exc, rel)) return false;
    if (docTypeOf(rel, includeSourceMd) === "agents" && opts.indexAgentsFiles === false) return false;
    return true;
  });

  const stats: IndexStats = { scanned: files.length, changed: 0, deleted: 0, chunks: 0 };
  const live = new Set<string>();

  store.begin();
  try {
    for (const abs of files) {
      const rel = relative(src.dir, abs);
      live.add(rel);
      const st = statSync(abs);
      const prev = store.getFileState(src.root, rel);
      if (!opts.force && prev && prev.mtimeMs === st.mtimeMs) continue; // mtime cheap-check
      const buf = readFileSync(abs);
      const hash = sha(buf);
      if (!opts.force && prev && prev.sha256 === hash) {
        store.setFileState(src.root, rel, { mtimeMs: st.mtimeMs, sha256: hash });
        continue; // content unchanged
      }
      // changed → replace
      store.deleteByPath(src.root, rel);
      const { chunks, wikilinks, mdLinks, frontmatter } = chunkMarkdown({ root: src.root, path: rel, text: buf.toString("utf8"), docType: docTypeOf(rel, includeSourceMd) });
      // file node
      store.addNode({ type: "file", name: rel, path: rel });
      for (const c of chunks) {
        store.insertChunk(c);
        if (c.level > 0) {
          store.addNode({ type: "heading", name: c.headingPath, path: rel });
          const parentName = c.parentChunkId ? chunks.find((x) => x.chunkId === c.parentChunkId)?.headingPath : rel;
          store.addEdge({ src: c.headingPath, dst: parentName ?? rel, rel: "child_of" });
        }
      }
      // tier-1 graph: wikilinks + md links + frontmatter tags
      for (const w of wikilinks) {
        store.addNode({ type: "file", name: normalizeLink(w), path: null });
        store.addEdge({ src: rel, dst: normalizeLink(w), rel: "links_to" });
      }
      for (const l of mdLinks) {
        const target = normalizeRel(rel, l);
        store.addNode({ type: "file", name: target, path: null });
        store.addEdge({ src: rel, dst: target, rel: "references" });
      }
      const tags = frontmatter?.tags;
      if (Array.isArray(tags)) for (const tag of tags) {
        store.addNode({ type: "tag", name: `tag:${tag}`, path: null });
        store.addEdge({ src: rel, dst: `tag:${tag}`, rel: "has_tag" });
      }
      store.setFileState(src.root, rel, { mtimeMs: st.mtimeMs, sha256: hash }); // persist for incremental
      stats.changed++;
      stats.chunks += chunks.length;
    }
    // deletions: paths in store but not on disk
    for (const p of store.listPaths(src.root)) {
      if (!live.has(p)) {
        store.deleteByPath(src.root, p);
        stats.deleted++;
      }
    }
    store.commit();
  } catch (err) {
    store.rollback();
    throw err;
  }
  return stats;
}

// [[name]] → basename match (design §9.6 simplified): resolve to "<name>.md" leaf
function normalizeLink(w: string): string {
  const name = w.split("|")[0].split("#")[0].trim();
  return name.endsWith(".md") ? name : `${name}.md`;
}
function normalizeRel(from: string, link: string): string {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const parts = (dir ? dir + "/" : "") + link;
  const stack: string[] = [];
  for (const seg of parts.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") stack.pop();
    else stack.push(seg);
  }
  return stack.join("/");
}
