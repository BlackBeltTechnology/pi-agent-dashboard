// Core types + the KbStore abstraction (design §2.5).
// Storage engine is accessed ONLY through KbStore — never via direct SQL in
// the chunker/indexer/search/CLI — so a future Turso/Tantivy or better-sqlite3
// backend is a swap, not a rewrite.

export type DocType = "doc" | "agents" | "source-md";

/** A structural (heading) chunk of a markdown file (design §3). */
export interface Chunk {
  root: string; // configured source root id (relative or label)
  path: string; // relative path within the source, portable
  chunkId: string; // stable id within file (e.g. "<sha8>:<ordinal>")
  headingPath: string; // breadcrumb: "A > B > C"
  heading: string; // leaf heading
  level: number; // 0 = preamble/file, 1..6 = ATX depth
  parentChunkId: string | null;
  docType: DocType;
  body: string; // section text (breadcrumb is indexed via columns, not prepended)
  bodyHash: string; // sha256 of trimmed body (exact-content dedup)
}

export interface GraphNode {
  type: "file" | "heading" | "tag" | "entity";
  name: string; // canonical label (headingPath for headings, path for files)
  path: string | null;
}
export interface GraphEdge {
  src: string; // node name
  dst: string; // node name
  rel: "child_of" | "links_to" | "references" | "has_tag";
  weight?: number;
}

export interface KbHit {
  root: string;
  path: string;
  headingPath: string;
  chunkId: string;
  docType: DocType;
  score: number; // lower = more relevant (BM25 convention)
  snippet: string;
  akaPaths?: string[]; // duplicate copies collapsed by dedup
  parent?: { headingPath: string } | null; // small-to-big parent context (expand.parent); display-only, NOT a refetch key; non-recursive
}

/** A pluggable reranker: rescoring BM25 top-k. Default = none (no-op). */
export type Reranker = (query: string, candidates: KbHit[]) => Promise<KbHit[]> | KbHit[];

export interface SearchOpts {
  limit?: number;
  root?: string;
  docType?: DocType;
  dedup?: boolean; // exact-content collapse (default true)
  fieldWeights?: { headingPath: number; heading: number; body: number };
  rootPriority?: Record<string, number>; // root id → priority (higher = preferred on dedup)
  proximityBoost?: boolean; // Tier A: in-order/proximity aux ranker
  diversity?: { enabled: boolean; lambda: number }; // Tier A: lexical MMR
  expandParent?: boolean; // Tier B: attach parent section/file context
  expandGraph?: boolean; // Tier B: pull neighbors/backlinks (opt-in)
  rerank?: boolean; // Tier C: cross-encoder rerank (off by default; no-op without model)
  reranker?: Reranker; // injected reranker; if absent, --rerank is a clean no-op
  queryExpansion?: "off" | "prf" | "synonym" | "agent";
  synonyms?: Record<string, string[]>; // curated glossary for synonym expansion
}

export interface FileState {
  mtimeMs: number;
  sha256: string;
}

/** The storage seam. Default impl = SqliteFtsStore over node:sqlite. */
export interface KbStore {
  // schema lifecycle
  init(): void;
  begin(): void;
  commit(): void;
  rollback(): void;
  close(): void;

  // change detection
  getFileState(root: string, path: string): FileState | null;
  setFileState(root: string, path: string, state: FileState): void;
  listPaths(root: string): string[];
  deleteByPath(root: string, path: string): void; // chunks + outbound edges + file row

  // indexing
  insertChunk(c: Chunk): void;
  addNode(n: GraphNode): void;
  addEdge(e: GraphEdge): void;

  // query
  search(query: string, opts?: SearchOpts): KbHit[];
  neighbors(node: string, depth: number, rel?: GraphEdge["rel"]): GraphNode[];
  backlinks(node: string): GraphNode[];
  getChunk(root: string, path: string, headingPath?: string): Chunk | null;
  getChunkById(root: string, chunkId: string): Chunk | null;

  // stats
  counts(): { files: number; chunks: number; nodes: number; edges: number };
}
