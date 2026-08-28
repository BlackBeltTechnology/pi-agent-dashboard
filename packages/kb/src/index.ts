// Public API barrel for @blackbelt-technology/pi-dashboard-kb (Phase 1 slice).

export type { ChunkInput, ParseResult } from "./chunker.js";
export { chunkMarkdown } from "./chunker.js";
export type { FrontmatterConfig, GuardMode, KbConfig, RankingConfig, ReadDisciplineConfig, ResolvedConfig, SourceConfig } from "./config.js";
export { DEFAULTS, frontmatterConfigHash, loadConfig, validateConfig } from "./config.js";
export type { AgentsEntry, DoxInitPlan, DoxIssue, DoxLintResult } from "./dox.js";
export { agentsChain, doxInit, doxLint, fallbackManifest, parseRowPaths, resolveRowPath } from "./dox.js";
export type { AckRecord, StalenessFile } from "./dox-triage.js";
export { ackTargets, applyDecisions, buildWorkItems, parseRows, readStaleness, replaceRowPurpose, STALENESS_VERSION } from "./dox-triage.js";
export type { FacetKeyConfig, FmValue, ParsedFrontmatter, PropertyRow } from "./frontmatter.js";
export { buildMeta, buildProperties, DEFAULT_FACET_KEYS, DEFAULT_SEARCHABLE_KEYS, parseFrontmatter, strictDate, strictNumber } from "./frontmatter.js";
export type { IndexOptions, IndexSource, IndexStats } from "./indexer.js";
export { indexSource } from "./indexer.js";
export type { InitOptions, InitResult } from "./init.js";
export { kbInit } from "./init.js";
export type { RenderOpts } from "./render.js";
export { renderHits } from "./render.js";
export type { KbSourceKind, ResolveCtx, ResolvedSource, SourceResolver } from "./sources.js";
export { classifyRef, resolveAll, resolverFor, sourceIdentity } from "./sources.js";
export { SCHEMA_VERSION, SqliteFtsStore } from "./sqlite-store.js";
export { canonicalSource, isTrusted, recordTrust, sourceHash } from "./trust.js";
export type {
  Chunk,
  DocType,
  FileState,
  Filter,
  GraphEdge,
  GraphNode,HitVerdict, 
  KbHit,
  KbStore,
  SearchOpts,
  StorePropertyRow,VerdictCounts, VerdictLabel 
} from "./types.js";
export type { EnrichCtx, VerdictFs } from "./verdict.js";
export { COVERAGE_CAP_BYTES, enrichHits, HASH_CAP_BYTES, SUBJECT_CAP } from "./verdict.js";
