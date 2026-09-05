// Indexer: walk a filesystem source, layered mtime→sha256 change detection,
// structural chunking, Tier-1 graph extraction, transactional upsert (design §5).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { chunkMarkdown } from "./chunker.js";
import { buildMeta, buildProperties, DEFAULT_FACET_KEYS, DEFAULT_SEARCHABLE_KEYS, type FacetKeyConfig } from "./frontmatter.js";
import { type GitignoreMatcher, loadGitignoreMatcher } from "./gitignore.js";
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
  frontmatter?: { searchableKeys: string[]; facetKeys: FacetKeyConfig[] }; // structural indexing routing
  /** Honour `.gitignore` in the walk (design D3, fix-dox-lint-blind-rows).
   *  Default true — makes the long-declared `respectGitignore` config real.
   *  A source dir absent from a fresh clone must not be indexed. */
  respectGitignore?: boolean;
  /** Project boundary for the gitignore up-walk (usually the resolved cwd).
   *  Omit to seed the pattern stack from the `.git` root discovered upward. */
  cwd?: string;
}
export interface IndexStats {
  scanned: number;
  changed: number;
  deleted: number;
  chunks: number;
  parseFailures?: number; // files whose frontmatter block was present but did not parse
  missing?: boolean; // source dir did not exist → skipped (degrade, not abort)
}

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const DEFAULT_EXCLUDE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage|\.kb)(\/|$)/;

/** Files processed between event-loop yields + batch commits. A long synchronous
 *  walk would otherwise pin the single Node thread for its whole duration, so a
 *  concurrent `/stats` reader could never observe `indexing:true` (no spinner)
 *  and would see no live progress. Committing per batch also releases the WAL
 *  write lock so the reader is served. See change: fix-kb-index-feedback. */
const YIELD_EVERY = 100;
const yieldToEventLoop = (): Promise<void> => new Promise<void>((r) => setImmediate(r));

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

function walk(dir: string, base: string, out: string[] = [], ignore?: GitignoreMatcher): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    const rel = relative(base, abs);
    if (DEFAULT_EXCLUDE.test(rel)) continue;
    if (e.isDirectory()) {
      // Conservative dir-pruning (design D3): descend unless the dir matches
      // AND no deeper .gitignore could negate the match.
      if (ignore?.isIgnoredDir(rel) && !ignore.hasDeeperGitignore(rel)) continue;
      walk(abs, base, out, ignore);
    } else if (/\.(md|mdx|markdown)$/i.test(e.name) && !ignore?.isIgnored(rel)) out.push(abs);
  }
  return out;
}

export function docTypeOf(rel: string, includeSourceMarkdown: boolean): DocType {
  const base = rel.split("/").pop() ?? "";
  // `<File>.AGENTS.md` = per-file index sidecar (large-row promotion). Classified
  // `agents` so it is searchable, but its name != "AGENTS.md" so pi's native
  // up-walk never auto-injects it (pull-only via kb search).
  if (base === "AGENTS.override.md" || base === "AGENTS.md" || base === "CLAUDE.md" || base.endsWith(".AGENTS.md")) return "agents";
  if (includeSourceMarkdown && /(^|\/)(src|lib|app|packages)\//.test(rel)) return "source-md";
  return "doc";
}

export async function indexSource(store: KbStore, src: IndexSource, opts: IndexOptions = {}): Promise<IndexStats> {
  // A configured source whose dir is absent degrades to skip-with-warning rather
  // than throwing ENOENT mid-walk. A partial source set still indexes what exists.
  // See change: harden-kb-index-failure-atomicity.
  if (!existsSync(src.dir)) {
    console.warn(`kb index: source directory does not exist, skipping: ${src.dir}`);
    return { scanned: 0, changed: 0, deleted: 0, chunks: 0, missing: true };
  }
  const extRe = opts.extensions?.length ? new RegExp("(" + opts.extensions.map((e) => e.replace(/\./g, "\\.")).join("|") + ")$", "i") : /\.(md|mdx|markdown)$/i;
  const inc = opts.include?.map(globToRe);
  const exc = opts.exclude?.map(globToRe);
  const includeSourceMd = opts.includeSourceMarkdown !== false;
  const gi = opts.respectGitignore === false ? undefined : loadGitignoreMatcher(src.dir, { cwd: opts.cwd, prune: (rel) => DEFAULT_EXCLUDE.test(rel) });
  const files = walk(src.dir, src.dir, [], gi).filter((abs) => {
    const rel = relative(src.dir, abs);
    if (src.include && !src.include(rel)) return false;
    if (inc && !matchAny(inc, rel)) return false;
    if (exc && matchAny(exc, rel)) return false;
    if (docTypeOf(rel, includeSourceMd) === "agents" && opts.indexAgentsFiles === false) return false;
    return true;
  });

  const stats: IndexStats = { scanned: files.length, changed: 0, deleted: 0, chunks: 0 };
  const live = new Set<string>();

  // Batched transaction: commit + yield every YIELD_EVERY files so the walk does
  // not block the event loop and a concurrent `/stats` read sees live progress.
  // NOTE: this trades whole-walk atomicity for responsiveness — a mid-walk throw
  // leaves earlier batches committed; a reindex is idempotent so a re-run
  // completes it. See change: fix-kb-index-feedback.
  let sinceYield = 0;
  store.begin();
  try {
    for (const abs of files) {
      if (sinceYield >= YIELD_EVERY) {
        store.commit();
        await yieldToEventLoop();
        store.begin();
        sinceYield = 0;
      }
      sinceYield++;
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
      const dt = docTypeOf(rel, includeSourceMd);
      const { chunks, wikilinks, mdLinks, frontmatter, parseFailed } = chunkMarkdown({ root: src.root, path: rel, text: buf.toString("utf8"), docType: dt });
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
      // frontmatter structural indexing: synthetic meta chunk + property rows
      if (frontmatter) {
        const fmCfg = opts.frontmatter ?? { searchableKeys: DEFAULT_SEARCHABLE_KEYS, facetKeys: DEFAULT_FACET_KEYS };
        const { title, body: metaBody } = buildMeta(frontmatter, fmCfg.searchableKeys);
        const metaText = [title ?? "", metaBody].join("\n").trim();
        if (metaText) {
          // Searchable meta needs only insertChunk (required); it must NOT be
          // gated on the optional insertProperty, or a chunk-capable store would
          // silently lose title/description search.
          const heading = title ?? (rel.split("/").pop() ?? rel).replace(/\.(md|mdx|markdown)$/i, "");
          store.insertChunk({ root: src.root, path: rel, chunkId: `${sha(rel).slice(0, 8)}:meta`, headingPath: heading, heading, level: 0, parentChunkId: null, docType: dt, body: metaBody, bodyHash: sha(metaText) });
          stats.chunks++;
        }
        if (store.insertProperty) for (const row of buildProperties(frontmatter, fmCfg.facetKeys)) store.insertProperty({ root: src.root, path: rel, ...row });
      }
      // Mirror docType for EVERY file (facetable regardless of frontmatter presence).
      store.insertProperty?.({ root: src.root, path: rel, key: "docType", value: dt, valueNum: null, valueDate: null, valueRaw: dt });
      if (parseFailed) stats.parseFailures = (stats.parseFailures ?? 0) + 1;
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
