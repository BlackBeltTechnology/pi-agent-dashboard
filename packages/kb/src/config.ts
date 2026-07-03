// Config layering (design §7): project `.pi/dashboard/knowledge_base.json`
// → global `~/.pi/dashboard/knowledge_base.json` → built-in defaults.
// Project file is used whole; absent fields fall back to global, then defaults.
// No file-count cap by default (requirement #1).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function expandTilde(p: string): string {
  return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

export interface SourceConfig {
  kind?: "filesystem" | "npm" | "git" | "https"; // Phase 1 implements filesystem
  ref: string;
  priority?: number;
  subdir?: string;
  pin?: string;
  refresh?: "on-index" | "manual" | { ttlMs: number };
}
export interface RankingConfig {
  fieldWeights: { headingPath: number; heading: number; body: number };
  proximityBoost: boolean;
  diversity: { enabled: boolean; lambda: number };
}
export interface ExpandConfig {
  parent: boolean;
  graph: boolean;
}
export interface RerankConfig {
  enabled: boolean;
  model: string;
  candidateK: number;
}
export interface QueryExpansionConfig {
  mode: "off" | "prf" | "synonym" | "agent";
}
export interface DirectoryLevelAgentsConfig {
  enabled: boolean;
  claudeMd: boolean;
  mode: "pull" | "push";
  fallbackManifest: boolean;
}
export interface KbConfig {
  sources: SourceConfig[];
  roots?: Array<{ path: string; priority?: number }>; // legacy alias → filesystem sources
  sourceCacheDir: string;
  include: string[];
  exclude: string[];
  extensions: string[];
  maxFileCount: number | null;
  maxDepth: number | null;
  respectGitignore: boolean;
  tokenizer: string;
  trigram: boolean;
  indexAgentsFiles: boolean;
  includeSourceMarkdown: boolean;
  chunking: { minHeadingsForStructural: number; minChunkChars: number; maxChunkChars: number; breadcrumbInBody: boolean };
  dedup: { exactContentCollapse: boolean; preferHigherPriorityRoot: boolean };
  graph: { wikilinks: boolean; headingTree: boolean; frontmatter: boolean };
  directoryLevelAgents: DirectoryLevelAgentsConfig;
  doxEnforcement: boolean; // opt-in Phase-2 hook Job 2 (default OFF)
  ranking: RankingConfig;
  expand: ExpandConfig;
  rerank: RerankConfig;
  queryExpansion: QueryExpansionConfig;
  dbPath: string;
}

export interface ResolvedSource {
  id: string; // stored on chunks.root
  dir: string; // absolute
  priority: number;
}
export interface ResolvedConfig extends KbConfig {
  cwd: string;
  dbAbsPath: string;
  cacheDirAbs: string;
  allSourceSpecs: SourceConfig[]; // roots[] legacy + sources[] (for async resolveAll)
  resolvedSources: ResolvedSource[]; // filesystem-only, sync (remote need async resolveAll)
  origin: "project" | "global" | "defaults";
}

export const DEFAULTS: KbConfig = {
  sources: [],
  sourceCacheDir: "~/.pi/dashboard/kb/sources",
  include: ["**/*.md"],
  exclude: ["**/node_modules/**", "**/archive/**"],
  extensions: [".md"],
  maxFileCount: null, // no cap
  maxDepth: null,
  respectGitignore: true,
  tokenizer: "porter unicode61",
  trigram: false,
  indexAgentsFiles: true,
  includeSourceMarkdown: true,
  chunking: { minHeadingsForStructural: 1, minChunkChars: 120, maxChunkChars: 4000, breadcrumbInBody: true },
  dedup: { exactContentCollapse: true, preferHigherPriorityRoot: true },
  graph: { wikilinks: true, headingTree: true, frontmatter: true },
  // Pull mode: `kb agents <path>` walks root→nearest AGENTS.md on demand. Safe —
  // no per-turn injection. Push mode stays gated behind the context-cost spike
  // (see change migrate-file-index-to-agents-tree design §5).
  directoryLevelAgents: { enabled: true, claudeMd: true, mode: "pull", fallbackManifest: true },
  doxEnforcement: false,
  ranking: { fieldWeights: { headingPath: 10, heading: 3, body: 1 }, proximityBoost: true, diversity: { enabled: true, lambda: 0.7 } },
  expand: { parent: true, graph: false },
  rerank: { enabled: false, model: "ms-marco-MiniLM-L-6-v2", candidateK: 50 },
  queryExpansion: { mode: "off" },
  dbPath: ".pi/dashboard/kb/index.db",
};

// Nested object keys that need one-level field fill-in (not wholesale replace),
// so a partial `{ranking:{proximityBoost:false}}` keeps default fieldWeights/diversity.
const NESTED_KEYS = ["chunking", "dedup", "graph", "directoryLevelAgents", "ranking", "expand", "rerank", "queryExpansion"] as const;

/** Layer configs left→right, deep-merging the known nested object keys. */
export function mergeConfig(...layers: Array<Partial<KbConfig> | null | undefined>): Partial<KbConfig> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if ((NESTED_KEYS as readonly string[]).includes(k) && v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object") {
        out[k] = { ...(out[k] as object), ...(v as object) };
      } else {
        out[k] = v;
      }
    }
  }
  return out as Partial<KbConfig>;
}

/** Validate a parsed config shape; throw with a precise message on violation. */
export function validateConfig(c: Partial<KbConfig>, origin = "config"): KbConfig {
  const merged: KbConfig = mergeConfig(DEFAULTS, c) as KbConfig;
  const err = (msg: string) => new Error(`invalid KB ${origin}: ${msg}`);
  if (!Array.isArray(merged.sources)) throw err("sources must be an array");
  for (const s of merged.sources) {
    if (typeof s !== "object" || s === null || typeof s.ref !== "string") throw err("each source needs a string `ref`");
    const k = s.kind ?? "filesystem";
    if (!/^(filesystem|npm|git|https)$/.test(k)) throw err(`source kind "${k}" unknown`);
  }
  if (typeof merged.maxFileCount !== "number" && merged.maxFileCount !== null) throw err("maxFileCount must be a number or null");
  if (typeof merged.dbPath !== "string" || !merged.dbPath) throw err("dbPath must be a non-empty string");
  if (!/^(off|prf|synonym|agent)$/.test(merged.queryExpansion.mode)) throw err(`queryExpansion.mode "${merged.queryExpansion.mode}" unknown`);
  return merged;
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, ".pi", "dashboard", "knowledge_base.json");
}
export function globalConfigPath(): string {
  return join(homedir(), ".pi", "dashboard", "knowledge_base.json");
}

function readJson(path: string): Partial<KbConfig> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<KbConfig>;
  } catch (e) {
    throw new Error(`invalid KB config at ${path}: ${(e as Error).message}`);
  }
}

/** Merge: defaults < global < project (field-level fill-in). */
export function loadConfig(cwd: string, opts: { configPath?: string } = {}): ResolvedConfig {
  const project = opts.configPath ? readJson(opts.configPath) : readJson(projectConfigPath(cwd));
  const global = readJson(globalConfigPath());
  const origin: ResolvedConfig["origin"] = project ? "project" : global ? "global" : "defaults";
  const merged = validateConfig(mergeConfig(DEFAULTS, global, project), origin);

  // legacy roots[] → filesystem sources
  const fromRoots: SourceConfig[] = (merged.roots ?? []).map((r) => ({ kind: "filesystem", ref: r.path, priority: r.priority }));
  const allSourceSpecs: SourceConfig[] = [...fromRoots, ...merged.sources];

  const resolvedSources: ResolvedSource[] = allSourceSpecs
    .filter((s) => (s.kind ?? "filesystem") === "filesystem")
    .map((s) => {
      const base = isAbsolute(s.ref) ? s.ref : resolve(cwd, s.ref);
      return { id: s.ref, dir: s.subdir ? join(base, s.subdir) : base, priority: s.priority ?? 0 };
    });

  const dbAbsPath = isAbsolute(merged.dbPath) ? merged.dbPath : resolve(cwd, merged.dbPath);
  const cacheDirAbs = expandTilde(merged.sourceCacheDir);
  return { ...merged, cwd, dbAbsPath, cacheDirAbs, allSourceSpecs, resolvedSources, origin };
}
