/**
 * Folder project identity: declared `.pi/dashboard/project.json` + bounded,
 * symlink-free marker-rule detection. Pure functions over an injectable fs.
 *
 * Callers MUST have admitted `cwd` first (the route does) — nothing here
 * authorises a path. The declaration is read through `lstat` (no symlinked
 * `.pi`, `.pi/dashboard` or file) → `open(O_NOFOLLOW|O_NONBLOCK)` → `fstat`
 * regular-file + size cap → bounded read → parent `dev`/`ino` re-check. The
 * marker walk visits only real directories (symlinks are neither matched nor
 * followed; `.git`/`node_modules` never visited), shares a 2000-entry budget,
 * a 256-pattern budget, a 2 s deadline and a process-wide 4-walk semaphore.
 *
 * Budget semantics: a `read()` is never issued once the entry budget is spent
 * (so at most 2000 entries are ever returned). Reaching that point with the
 * walk still unfinished reports `truncated`; the walk finishes silently when
 * every declared type has matched first.
 *
 * See change: add-project-scoped-apps.
 */
import { type Dirent, constants as fsConstants, type Stats } from "node:fs";
import * as fsp from "node:fs/promises";
import { join } from "node:path";
import type { FolderProject, PluginManifest, ProjectTypeRule } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import {
  type DeclaredIdentity,
  IDENTITY_MAX_BYTES,
  parseDeclaration,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-identity.js";
import {
  EXCLUDED_WALK_NAMES,
  matchSegment,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/project-markers.js";

const WALK_ENTRY_BUDGET = 2000;
const WALK_PATTERN_BUDGET = 256;
const WALK_DEADLINE_MS = 2000;
const WALK_CONCURRENCY = 4;

// ── injectable fs ────────────────────────────────────────────────────────────

interface FolderProjectFileHandle {
  stat(): Promise<Pick<Stats, "isFile" | "size" | "dev" | "ino">>;
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

interface FolderProjectDir {
  read(): Promise<Dirent | null>;
  close(): Promise<void>;
}

export interface FolderProjectFs {
  lstat(path: string): Promise<Pick<Stats, "isFile" | "isDirectory" | "isSymbolicLink" | "dev" | "ino">>;
  open(path: string, flags: number): Promise<FolderProjectFileHandle>;
  opendir(path: string): Promise<FolderProjectDir>;
}

export const realFolderProjectFs: FolderProjectFs = {
  lstat: (p) => fsp.lstat(p),
  open: (p, flags) => fsp.open(p, flags) as Promise<FolderProjectFileHandle>,
  opendir: (p) => fsp.opendir(p) as Promise<FolderProjectDir>,
};

// ── declared identity ────────────────────────────────────────────────────────

type StatLike = Pick<Stats, "dev" | "ino">;
const sameNode = (a: StatLike, b: StatLike): boolean => a.dev === b.dev && a.ino === b.ino;

/** lstat that maps any failure to `null` (absent). */
async function lstatOrNull(fs: FolderProjectFs, p: string) {
  try {
    return await fs.lstat(p);
  } catch {
    return null;
  }
}

async function lstatRealDir(fs: FolderProjectFs, p: string) {
  const st = await lstatOrNull(fs, p);
  return st && !st.isSymbolicLink() && st.isDirectory() ? st : null;
}

/** Read at most `IDENTITY_MAX_BYTES + 1` bytes; `null` when the file exceeds the cap. */
async function readBounded(handle: FolderProjectFileHandle): Promise<string | null> {
  const cap = IDENTITY_MAX_BYTES + 1;
  const buf = Buffer.alloc(cap);
  let total = 0;
  while (total < cap) {
    const { bytesRead } = await handle.read(buf, total, cap - total, total);
    if (bytesRead === 0) break;
    total += bytesRead;
  }
  return total > IDENTITY_MAX_BYTES ? null : buf.subarray(0, total).toString("utf8");
}

interface IdentityPath {
  piDir: string;
  dashDir: string;
  file: string;
}

/** The directories must still be the ones `lstat`'d before the open (parent-swap check). */
async function parentsUnchanged(fs: FolderProjectFs, p: IdentityPath, pi1: StatLike, dash1: StatLike): Promise<boolean> {
  const pi2 = await lstatRealDir(fs, p.piDir);
  const dash2 = await lstatRealDir(fs, p.dashDir);
  return !!pi2 && !!dash2 && sameNode(pi1, pi2) && sameNode(dash1, dash2);
}

/**
 * Read `<cwd>/.pi/dashboard/project.json`. Any refusal (symlink, non-regular,
 * oversized, bad JSON/shape/schemaVersion, parent swapped after open) → `null`.
 */
export async function readDeclaredIdentity(cwd: string, fs: FolderProjectFs = realFolderProjectFs): Promise<DeclaredIdentity | null> {
  const piDir = join(cwd, ".pi");
  const dashDir = join(piDir, "dashboard");
  const path: IdentityPath = { piDir, dashDir, file: join(dashDir, "project.json") };

  const pi1 = await lstatRealDir(fs, piDir);
  const dash1 = pi1 && (await lstatRealDir(fs, dashDir));
  const file1 = dash1 && (await lstatOrNull(fs, path.file));
  if (!pi1 || !dash1 || !file1 || file1.isSymbolicLink() || !file1.isFile()) return null;

  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  const handle = await fs.open(path.file, flags).catch(() => null);
  if (!handle) return null;
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > IDENTITY_MAX_BYTES || !sameNode(st, file1)) return null;
    if (!(await parentsUnchanged(fs, path, pi1, dash1))) return null;
    const text = await readBounded(handle);
    return text === null ? null : parseDeclaration(text);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

// ── marker patterns ──────────────────────────────────────────────────────────

/** One plugin's rules as the server hands them to the resolver. */
export interface ProjectRuleSource {
  pluginId: string;
  priority: number;
  projectTypes: ProjectTypeRule[];
}

/**
 * Rule sources from discovered plugins: only plugins that declare
 * `projectTypes` AND are fixture-allowed, loaded and enabled right now.
 */
export function collectRuleSources(
  plugins: ReadonlyArray<{ manifest: PluginManifest }>,
  gates: {
    fixtureAllowed: (manifest: PluginManifest) => boolean;
    isLoaded: (pluginId: string) => boolean;
    isEnabled: (manifest: PluginManifest) => boolean;
  },
): ProjectRuleSource[] {
  const out: ProjectRuleSource[] = [];
  for (const { manifest } of plugins) {
    if (!manifest.projectTypes?.length) continue;
    if (!gates.fixtureAllowed(manifest) || !gates.isLoaded(manifest.id) || !gates.isEnabled(manifest)) continue;
    out.push({ pluginId: manifest.id, priority: manifest.priority ?? 1000, projectTypes: manifest.projectTypes });
  }
  return out;
}

interface TrieNode {
  /** segment pattern → child */
  children: Map<string, TrieNode>;
  /** types whose pattern ends at this node */
  types: Set<string>;
}

const newNode = (): TrieNode => ({ children: new Map(), types: new Set() });

const byPriorityThenId = (a: ProjectRuleSource, b: ProjectRuleSource): number =>
  a.priority - b.priority || (a.pluginId < b.pluginId ? -1 : a.pluginId > b.pluginId ? 1 : 0);

function addRules(root: TrieNode, types: Set<string>, rules: readonly ProjectTypeRule[]): void {
  for (const rule of rules) {
    types.add(rule.type);
    for (const marker of rule.markers) {
      let node = root;
      for (const seg of marker.split("/")) {
        let child = node.children.get(seg);
        if (!child) {
          child = newNode();
          node.children.set(seg, child);
        }
        node = child;
      }
      node.types.add(rule.type);
    }
  }
}

/**
 * Take plugins in (priority, id) order; skip a whole plugin whose patterns do
 * not fit the remaining budget. Returns the trie and whether any plugin was skipped.
 */
function buildMarkerTrie(
  sources: readonly ProjectRuleSource[],
  maxPatterns: number = WALK_PATTERN_BUDGET,
): { root: TrieNode; types: Set<string>; skipped: boolean; patterns: number } {
  const root = newNode();
  const types = new Set<string>();
  let used = 0;
  let skipped = false;
  for (const src of [...sources].sort(byPriorityThenId)) {
    const cost = src.projectTypes.reduce((n, r) => n + r.markers.length, 0);
    if (cost === 0) continue;
    if (used + cost > maxPatterns) {
      skipped = true;
      continue;
    }
    used += cost;
    addRules(root, types, src.projectTypes);
  }
  return { root, types, skipped, patterns: used };
}

// ── walk semaphore ───────────────────────────────────────────────────────────

export interface WalkLimiter {
  acquire(): Promise<() => void>;
}

export function createWalkLimiter(max: number = WALK_CONCURRENCY): WalkLimiter {
  let active = 0;
  const waiters: Array<() => void> = [];
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };
  return {
    acquire: () =>
      new Promise<() => void>((resolve) => {
        const grant = () => {
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            release();
          });
        };
        if (active < max) {
          active += 1;
          grant();
        } else waiters.push(grant);
      }),
  };
}

/** Process-wide limiter: at most 4 walks at once across the server. */
const globalWalkLimiter: WalkLimiter = createWalkLimiter();

// ── walk ─────────────────────────────────────────────────────────────────────

interface WalkOptions {
  fs?: FolderProjectFs;
  entryBudget?: number;
  deadlineMs?: number;
}

interface WalkResult {
  matched: Set<string>;
  truncated: boolean;
}

interface Descent {
  name: string;
  nodes: TrieNode[];
}

/** One shared walk's mutable state + steps; split from `walkMarkers` to keep each step small. */
class MarkerWalk {
  readonly matched = new Set<string>();
  truncated = false;
  stopped = false;
  private budget: number;
  private readonly fs: FolderProjectFs;
  private readonly total: number;

  constructor(fs: FolderProjectFs, total: number, budget: number) {
    this.fs = fs;
    this.total = total;
    this.budget = budget;
  }

  private get done(): boolean {
    return this.stopped || this.matched.size >= this.total;
  }

  /** Stop; `truncated` when work was cut short (budget or deadline) rather than finished. */
  halt(truncated: boolean): void {
    this.stopped = true;
    if (truncated) this.truncated = true;
  }

  /** Record the entry's matches under `node` and collect child nodes to descend into. */
  private matchUnder(node: TrieNode, entry: Dirent, isDir: boolean, next: TrieNode[]): void {
    for (const [seg, child] of node.children) {
      if (!matchSegment(seg, entry.name)) continue;
      for (const t of child.types) this.matched.add(t);
      if (isDir && child.children.size > 0) next.push(child);
    }
  }

  /** Record matches for one entry and return the trie nodes to descend into (if it is a directory). */
  private consume(entry: Dirent, nodes: TrieNode[]): TrieNode[] {
    if (entry.isSymbolicLink() || EXCLUDED_WALK_NAMES.has(entry.name)) return [];
    const isDir = entry.isDirectory();
    if (!isDir && !entry.isFile()) return [];
    const next: TrieNode[] = [];
    for (const node of nodes) this.matchUnder(node, entry, isDir, next);
    return next;
  }

  /** Read one directory under the budget; never issues a `read()` once the budget is spent. */
  private async scan(dir: FolderProjectDir, nodes: TrieNode[]): Promise<Descent[]> {
    const descend: Descent[] = [];
    while (!this.done) {
      if (this.budget <= 0) return this.cutShort(descend);
      const entry = await dir.read();
      if (this.stopped || entry === null) break;
      this.budget -= 1;
      const next = this.consume(entry, nodes);
      if (next.length > 0) descend.push({ name: entry.name, nodes: next });
    }
    return descend;
  }

  private cutShort(descend: Descent[]): Descent[] {
    this.halt(true);
    return descend;
  }

  /** The directory we meant to open must be the one we opened (swapped-for-symlink ⇒ skip). */
  private async sameDir(dirPath: string, expected: StatLike): Promise<boolean> {
    const after = await lstatRealDir(this.fs, dirPath);
    return !this.stopped && !!after && sameNode(expected, after);
  }

  private async list(dirPath: string, nodes: TrieNode[], expected: StatLike | null): Promise<Descent[]> {
    const dir = await this.fs.opendir(dirPath).catch(() => null);
    if (!dir) return [];
    try {
      if (expected && !(await this.sameDir(dirPath, expected))) return [];
      return await this.scan(dir, nodes);
    } catch {
      return [];
    } finally {
      await dir.close().catch(() => {});
    }
  }

  async visit(dirPath: string, nodes: TrieNode[], expected: StatLike | null): Promise<void> {
    if (this.done) return;
    for (const d of await this.list(dirPath, nodes, expected)) {
      if (this.done) return;
      const child = join(dirPath, d.name);
      const before = await lstatRealDir(this.fs, child);
      if (this.stopped) return;
      if (before) await this.visit(child, d.nodes, before);
    }
  }
}

/**
 * Single shared walk over `cwd` driven by the marker trie. Resolves at the
 * deadline even if an fs call hangs (the stray call stops at its next await).
 */
async function walkMarkers(
  cwd: string,
  trie: { root: TrieNode; types: Set<string> },
  opts: WalkOptions = {},
): Promise<WalkResult> {
  const walk = new MarkerWalk(opts.fs ?? realFolderProjectFs, trie.types.size, opts.entryBudget ?? WALK_ENTRY_BUDGET);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      walk.halt(true);
      resolve();
    }, opts.deadlineMs ?? WALK_DEADLINE_MS);
  });
  try {
    await Promise.race([walk.visit(cwd, [trie.root], null), deadline]);
  } finally {
    clearTimeout(timer);
    walk.halt(false);
  }
  return { matched: walk.matched, truncated: walk.truncated };
}

// ── resolve ──────────────────────────────────────────────────────────────────

export interface ResolveOptions extends WalkOptions {
  maxPatterns?: number;
  limiter?: WalkLimiter;
}

/**
 * Resolve a folder's project identity. Declared `type` wins and skips
 * detection; otherwise the rules of the supplied (loaded + enabled) plugins
 * are matched in one walk. No rules → no filesystem walk.
 */
export async function resolveFolderProject(
  cwd: string,
  sources: readonly ProjectRuleSource[],
  opts: ResolveOptions = {},
): Promise<FolderProject> {
  const fs = opts.fs ?? realFolderProjectFs;
  const declared = await readDeclaredIdentity(cwd, fs);
  const id = declared?.id ?? null;
  if (declared?.type) return { id, types: [declared.type], source: "declared" };

  const trie = buildMarkerTrie(sources, opts.maxPatterns);
  let truncated = trie.skipped;
  let types: string[] = [];
  if (trie.patterns > 0) {
    const release = await (opts.limiter ?? globalWalkLimiter).acquire();
    try {
      const walked = await walkMarkers(cwd, trie, { fs, entryBudget: opts.entryBudget, deadlineMs: opts.deadlineMs });
      types = [...walked.matched].sort();
      truncated = truncated || walked.truncated;
    } finally {
      release();
    }
  }
  return {
    id,
    types,
    source: types.length > 0 ? "detected" : "none",
    ...(truncated ? { truncated: true as const } : {}),
  };
}
