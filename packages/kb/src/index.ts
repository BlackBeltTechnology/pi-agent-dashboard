// Public API barrel for @blackbelt-technology/pi-dashboard-kb (Phase 1 slice).
export type {
  Chunk,
  DocType,
  FileState,
  GraphEdge,
  GraphNode,
  KbHit,
  KbStore,
  SearchOpts,
} from "./types.js";
export { renderHits } from "./render.js";
export type { RenderOpts } from "./render.js";
export { chunkMarkdown } from "./chunker.js";
export type { ChunkInput, ParseResult } from "./chunker.js";
export { SqliteFtsStore } from "./sqlite-store.js";
export { indexSource } from "./indexer.js";
export type { IndexSource, IndexOptions, IndexStats } from "./indexer.js";
export { kbInit } from "./init.js";
export type { InitOptions, InitResult } from "./init.js";
export { loadConfig, validateConfig, DEFAULTS } from "./config.js";
export type { KbConfig, SourceConfig, RankingConfig, ResolvedConfig } from "./config.js";
export { resolveAll, classifyRef, sourceIdentity, resolverFor } from "./sources.js";
export type { KbSourceKind, ResolvedSource, ResolveCtx, SourceResolver } from "./sources.js";
export { isTrusted, recordTrust, canonicalSource, sourceHash } from "./trust.js";
export { agentsChain, doxInit, doxLint, fallbackManifest, parseRowPaths, resolveRowPath } from "./dox.js";
export type { AgentsEntry, DoxInitPlan, DoxIssue, DoxLintResult } from "./dox.js";
