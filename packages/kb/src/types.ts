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
  /** Further sections of this file NOT returned by this fetch. Set by a
   *  path-only `getChunk` so it can never silently truncate a multi-chunk file
   *  (design D7). Absent/0 = this is the whole story. */
  suppressedSections?: number;
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

/** Trust label over a hit's DOX-row subject set (verdict.ts, arm A of
 *  add-kb-trust-verdicts-and-search-guard). A trust LABEL, never a relevance
 *  signal — verdicts SHALL NOT reorder results. */
export type VerdictLabel = "FRESH" | "STALE" | "MOVED" | "GONE" | "UNVERIFIED";

/** Per-label subject counts over the CHECKED set, plus the total number of
 *  resolvable subjects the section documents — a capped check (SUBJECT_CAP 8)
 *  is never indistinguishable from a full one. */
export interface VerdictCounts {
  fresh: number;
  stale: number;
  moved: number;
  gone: number;
  unverified: number;
  checked: number;
  total: number;
}

export interface HitVerdict {
  label: VerdictLabel; // worst-of the checked subjects
  counts: VerdictCounts;
  /** Successor paths (cwd-relative) for MOVED subjects, when any. */
  movedTo?: string[];
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
  /** Further matching sections of this same source collapsed by source-level
   *  dedup (design D1). 0 = this source matched exactly once. */
  suppressedSections?: number;
  parent?: { headingPath: string } | null; // small-to-big parent context (expand.parent); display-only, NOT a refetch key; non-recursive
  /** Trust verdict over the hit's resolvable DOX-row subjects (verdict.ts).
   *  null = the hit documents no resolvable subject; absent = enrichment
   *  disabled. Label-only — ordering is byte-identical with it on or off. */
  verdict?: HitVerdict | null;
  /** Opt-in content-coverage score (0..1): share of query terms present in the
   *  subject files. Default OFF (uncalibrated); separate from the verdict. */
  coverage?: number;
}

/** A pluggable reranker: rescoring BM25 top-k. Default = none (no-op). */
export type Reranker = (query: string, candidates: KbHit[]) => Promise<KbHit[]> | KbHit[];

/** Structured frontmatter facet filter (add-kb-frontmatter-structural-indexing).
 *  Values are always parameter-bound. `type` selects the range column for
 *  gte/lte: number → value_num, date → value_date, string/omitted → value. */
export interface Filter {
  key: string;
  op: "eq" | "in" | "gte" | "lte";
  value?: string | number;
  values?: Array<string | number>;
  type?: "string" | "number" | "date";
}

/** A property row persisted for a file's facet frontmatter. */
export interface StorePropertyRow {
  root: string;
  path: string;
  key: string;
  value: string; // normalized (lowercased/trimmed)
  valueNum: number | null;
  valueDate: string | null;
  valueRaw: string;
}

export interface SearchOpts {
  limit?: number;
  root?: string;
  docType?: DocType;
  dedup?: boolean; // exact-content collapse (default true)
  sourceDedup?: boolean; // collapse to one hit per (root, path) (default true; design D1)
  /** Share of the result page reserved for `doc_type='agents'` (0..1). 0 disables
   *  the lane quota. Ignored when the caller passes an explicit `docType`. */
  laneQuota?: number;
  /** Relative score margin (0..1) letting the reserved `agents` lane take slot 1
   *  when `r0 - m0 <= margin * |m0|` on raw BM25(+proximity) scores. `0` = off
   *  and byte-identical to the pre-change interleave. Inert without a reserved
   *  lane (explicit `docType`, or `laneQuota: 0`).
   *  See change: fix-kb-search-lane-composition. */
  laneLeadMargin?: number;
  /** IDF-weighted coverage rerank (design D4). Opt-IN: default OFF, because it
   *  measured a net regression on the bundled fixtures. Gates PRF expansion. */
  coverageRerank?: boolean;
  prf?: { terms?: number; topK?: number; dfCeiling?: number }; // PRF tuning (design D4)
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
  filters?: Filter[]; // structured frontmatter facet filters (opt-in; no-op when absent)
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
  // frontmatter structural indexing (optional — additive backend capability)
  insertProperty?(row: StorePropertyRow): void;
  deletePropertiesByPath?(root: string, path: string): void;
  facets?(keys: string[], opts?: { root?: string; filters?: Filter[] }): Record<string, Record<string, number>>;
  getUserVersion?(): number;
  setUserVersion?(v: number): void;
  getMeta?(k: string): string | null;
  setMeta?(k: string, v: string): void;

  // query
  search(query: string, opts?: SearchOpts): KbHit[];
  neighbors(node: string, depth: number, rel?: GraphEdge["rel"]): GraphNode[];
  backlinks(node: string): GraphNode[];
  getChunk(root: string, path: string, headingPath?: string): Chunk | null;
  getChunkById(root: string, chunkId: string): Chunk | null;

  // stats
  counts(): { files: number; chunks: number; nodes: number; edges: number };
}
