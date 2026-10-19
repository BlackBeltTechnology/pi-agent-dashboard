// Public API barrel for @blackbelt-technology/pi-dashboard-kb (Phase 1 slice).

export type { AdocChunkInput, AdocParseResult } from "./adoc-chunker.js";
export { chunkAsciiDoc, extractXrefs, NEGATED } from "./adoc-chunker.js";
export type { ChunkInput, ParseResult } from "./chunker.js";
export { chunkMarkdown } from "./chunker.js";
export type { DoctrineConfig, ForgeKind, FrontmatterConfig, GitConfig, GuardMode, IndexGateConfig, KbConfig, RankingConfig, ReadDisciplineConfig, ResolvedConfig, SourceConfig } from "./config.js";
export { DEFAULTS, frontmatterConfigHash, indexOptionsFromConfig, indexOptionsHash, loadConfig, validateConfig } from "./config.js";
export type { AgentsEntry, DoxInitPlan, DoxIssue, DoxLintResult } from "./dox.js";
export { agentsChain, doxInit, doxLint, fallbackManifest, parseRowPaths, resolveRowPath } from "./dox.js";
export { ackTargets, applyDecisions, buildWorkItems, parseRows, replaceRowPurpose } from "./dox-triage.js";
export type { FacetKeyConfig, FmValue, ParsedFrontmatter, PropertyRow } from "./frontmatter.js";
export { buildMeta, buildProperties, DEFAULT_FACET_KEYS, DEFAULT_SEARCHABLE_KEYS, parseFrontmatter, strictDate, strictNumber } from "./frontmatter.js";
export type { ForgeAdapter, ForgeItem, ForgePage, GitKind, GitResult, GitScopeDeps, GitScopeOptions } from "./git-scope/index.js";
export { createGitScope, GitScope } from "./git-scope/index.js";
export { beginForcedSource, runningEngine, sourceGateIsStale, stampPass, stampSource } from "./index-gate.js";
export type { AtomicIndexSource, InstallDeps, InstallResult, RunIndexAtomicOpts } from "./index-run.js";
export { BUILDING_LINE, installIndex, isFirstIndexLive, makeHeartbeat, runIndexAtomic, sweepOrphanTemps } from "./index-run.js";
export type { IndexOptions, IndexSource, IndexStats } from "./indexer.js";
export { headingNodeName, indexSource } from "./indexer.js";
export type { InitOptions, InitResult } from "./init.js";
export { kbInit } from "./init.js";
export type { RenderOpts } from "./render.js";
export { renderHits } from "./render.js";
export type { SearchOptsOverrides } from "./search-opts.js";
export { searchOptsFromConfig } from "./search-opts.js";
export type { MainCheckout, SeedOptions, SeedSkipReason } from "./seed.js";
export { findMainCheckout, seedOptionsFromConfig } from "./seed.js";
export type { KbSourceKind, ResolveCtx, ResolvedSource, SourceResolver } from "./sources.js";
export { classifyRef, KbUntrustedSourceError, resolveAll, resolverFor, sourceIdentity } from "./sources.js";
export { SCHEMA_VERSION, SqliteFtsStore } from "./sqlite-store.js";
export type { AckRecord, StalenessFile } from "./staleness.js";
export { readStaleness, STALENESS_VERSION, stalenessVersionOnDisk } from "./staleness.js";
// The Access review surface (change: add-access-grants-and-review) needs the
// trust store's revoke + displayable listing. Exported from the package ROOT
// because kb's `exports` map exposes only "." — a `/trust.js` subpath import
// does not resolve.
export {
  canonicalSource,
  isTrusted,
  listTrustedSources,
  recordTrust,
  revokeTrust,
  revokeTrustByHash,
  sourceHash,
  sourceSubject,
} from "./trust.js";
export type {
  Chunk,
  DocType,
  FileState,
  Filter,
  GraphEdge,
  GraphNode,
  HitVerdict,
  KbHit,
  KbStore,
  SearchOpts,
  StorePropertyRow,
  VerdictCounts,
  VerdictLabel,
} from "./types.js";
export type { EnrichCtx, VerdictFs } from "./verdict.js";
export { COVERAGE_CAP_BYTES, enrichHits, HASH_CAP_BYTES, SUBJECT_CAP } from "./verdict.js";
