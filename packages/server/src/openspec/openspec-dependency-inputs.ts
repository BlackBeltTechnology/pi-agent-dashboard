/**
 * Reads the files the dependency graph is computed from — per-change
 * `dependencies.yaml`, `proposal.md`, delta `spec.md` headers — plus the archive
 * listing and main-spec existence, behind a per-file parse cache keyed by
 * path + mtime + size. Runs wherever the poll build runs (worker thread or
 * in-process), so the cache is per thread. All I/O is async and bounded.
 *
 * See change: add-openspec-change-dependencies.
 */
import { constants as fsConstants } from "node:fs";
import fsp from "node:fs/promises";
import * as path from "node:path";
import {
  archivedChangeName,
  type ChangeInputs,
  computeDependencyGraph,
  DEPENDENCIES_FILE,
  type DeclaredState,
  type DeltaScan,
  type GraphInputs,
  type ProposalScan,
  readDependenciesFile,
  scanDelta,
  scanProposal,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";
import { mapLimit } from "@blackbelt-technology/pi-dashboard-shared/openspec-status-all.js";
import type { ChangeDependencies } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { MAX_SPEC_DEPTH } from "./openspec-poll-fs-helpers.js";

/** Markdown inputs larger than this are ignored (never read). */
const MAX_MARKDOWN_BYTES = 1024 * 1024;
const CHANGE_CONCURRENCY = 16;

interface CacheEntry<T> {
  mtimeMs: number;
  size: number;
  value: T;
}

/** Per-thread per-file parse cache. Keys are absolute paths. */
const fileCache = new Map<string, CacheEntry<unknown>>();

/**
 * Per-change assembly cache keyed by the gate probe's effective mtime (the max
 * over the change's tracked paths, which include every input read here). An
 * unchanged mtime means no input moved, so the change costs no syscalls at all.
 * The key is taken BEFORE the files are read, so a write in between only makes
 * the next build re-read (never serves stale content). Sits on top of the
 * per-file cache; entries remember the files they cover so pruning keeps them.
 */
interface ChangeCacheEntry {
  mtime: number;
  files: string[];
  inputs: Omit<ChangeInputs, "name">;
}
const changeCache = new Map<string, ChangeCacheEntry>();

/** Test seam: drop every cached parse. */
export function clearDependencyInputCache(): void {
  fileCache.clear();
  changeCache.clear();
}

async function cachedParse<T>(
  file: string,
  seen: Set<string>,
  parse: (text: string) => T,
): Promise<T | null> {
  let st: Awaited<ReturnType<typeof fsp.lstat>>;
  try {
    st = await fsp.lstat(file);
  } catch {
    return null;
  }
  // Regular files only: never read through a symlink or a device.
  if (!st.isFile() || st.size > MAX_MARKDOWN_BYTES) return null;
  seen.add(file);
  const hit = fileCache.get(file) as CacheEntry<T> | undefined;
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  const text = await readMarkdown(file);
  if (text === null) return null;
  const value = parse(text);
  fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

/**
 * Bounded read of a regular file that is re-checked on the OPEN handle: never through a symlink
 * (`O_NOFOLLOW`), never blocking on a FIFO swapped in after the caller's lstat (`O_NONBLOCK`), never more
 * than `MAX_MARKDOWN_BYTES`. `null` = unreadable or not a regular file.
 */
async function readMarkdown(file: string): Promise<string | null> {
  const noFollow = typeof fsConstants.O_NOFOLLOW === "number" ? fsConstants.O_NOFOLLOW : 0;
  const nonBlock = typeof fsConstants.O_NONBLOCK === "number" ? fsConstants.O_NONBLOCK : 0;
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    handle = await fsp.open(file, fsConstants.O_RDONLY | noFollow | nonBlock);
    const hs = await handle.stat();
    if (!hs.isFile() || hs.size > MAX_MARKDOWN_BYTES) return null;
    const buf = Buffer.alloc(hs.size + 1);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return bytesRead > hs.size ? null : buf.toString("utf8", 0, bytesRead); // grew while reading: skip
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readDeclared(file: string, seen: Set<string>): Promise<DeclaredState> {
  let st: Awaited<ReturnType<typeof fsp.lstat>>;
  try {
    st = await fsp.lstat(file);
  } catch {
    return { state: "absent" };
  }
  seen.add(file);
  const hit = fileCache.get(file) as CacheEntry<DeclaredState> | undefined;
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.value;
  const r = await readDependenciesFile(file);
  const value: DeclaredState =
    r.kind === "absent"
      ? { state: "absent" }
      : r.kind === "invalid"
        ? { state: "invalid", error: r.error }
        : { state: "ok", value: r.value };
  // A symlink / FIFO / oversize file is re-checked each build (cheap lstat), not cached.
  if (r.kind === "ok" || (r.kind === "invalid" && st.isFile() && st.size <= 64 * 1024)) {
    fileCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
  }
  return value;
}

/** Capability id → delta `spec.md` path, walking `specs/` (nested ids included). */
async function listDeltaFiles(specsDir: string): Promise<Array<{ cap: string; file: string }>> {
  const out: Array<{ cap: string; file: string }> = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (depth < MAX_SPEC_DEPTH) await walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
      } else if (e.isFile() && e.name === "spec.md" && rel) {
        out.push({ cap: rel, file: path.join(dir, e.name) });
      }
    }
  };
  await walk(specsDir, "", 0);
  return out;
}

async function archivedNames(archiveDir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(archiveDir, { withFileTypes: true });
    const names: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const n = archivedChangeName(e.name);
      if (n) names.push(n);
    }
    return names;
  } catch {
    return [];
  }
}

async function mainSpecExists(openspecDir: string, cap: string): Promise<boolean> {
  try {
    return (await fsp.stat(path.join(openspecDir, "specs", ...cap.split("/"), "spec.md"))).isFile();
  } catch {
    return false;
  }
}

interface CollectedInputs {
  inputs: GraphInputs;
  /** Every capability id touched by an active delta (sorted) — stored with the gate stamp. */
  capabilityIds: string[];
}

/**
 * Read the graph inputs for `names` (the active changes of this build).
 * `mtimes` = the probe's per-change effective mtime (optional): equal to the
 * previous build's value → the assembled inputs are reused without any I/O.
 */
const isSingleSegment = (name: string): boolean => name !== "" && name !== "." && name !== ".." && !/[\\/\0]/.test(name);

async function collectDependencyInputs(
  openspecDir: string,
  names: string[],
  mtimes?: Record<string, number | undefined>,
): Promise<CollectedInputs> {
  const changesDir = path.join(openspecDir, "changes");
  const seen = new Set<string>();
  const seenChanges = new Set<string>();
  const changes = await mapLimit(names, CHANGE_CONCURRENCY, async (name): Promise<ChangeInputs> => {
    // Names come from the CLI's listing; defence in depth: only a single path segment is ever joined onto
    // `changes/` (never `..`, a separator or NUL), so a hostile entry cannot reach files outside it.
    if (!isSingleSegment(name)) return { name, declared: { state: "absent" }, proposal: null, deltas: {} };
    const dir = path.join(changesDir, name);
    const mtime = mtimes?.[name];
    const hit = changeCache.get(dir);
    if (hit && mtime !== undefined && hit.mtime === mtime) {
      seenChanges.add(dir);
      for (const f of hit.files) seen.add(f);
      return { name, ...hit.inputs };
    }
    const before = new Set(seen);
    const [declared, proposal, deltaFiles] = await Promise.all([
      readDeclared(path.join(dir, DEPENDENCIES_FILE), seen),
      cachedParse<ProposalScan>(path.join(dir, "proposal.md"), seen, scanProposal),
      listDeltaFiles(path.join(dir, "specs")),
    ]);
    const deltas: Record<string, DeltaScan> = {};
    await Promise.all(
      deltaFiles.map(async ({ cap, file }) => {
        const scan = await cachedParse<DeltaScan>(file, seen, scanDelta);
        if (scan) deltas[cap] = scan;
      }),
    );
    if (mtime !== undefined) {
      // The files this change contributed (set difference is exact: paths are per change).
      const files = [...seen].filter((f) => !before.has(f) && f.startsWith(dir + path.sep));
      changeCache.set(dir, { mtime, files, inputs: { declared, proposal, deltas } });
      seenChanges.add(dir);
    }
    return { name, declared, proposal, deltas };
  });

  const capabilityIds = [...new Set(changes.flatMap((c) => Object.keys(c.deltas)))].sort();
  const [archived, mainFlags] = await Promise.all([
    archivedNames(path.join(changesDir, "archive")),
    mapLimit(capabilityIds, 32, (cap) => mainSpecExists(openspecDir, cap)),
  ]);
  const mainSpecs = capabilityIds.filter((_, i) => mainFlags[i]);

  // Prune entries of this tree that were not read this build (deleted files).
  const prefix = openspecDir + path.sep;
  for (const key of fileCache.keys()) if (key.startsWith(prefix) && !seen.has(key)) fileCache.delete(key);
  for (const key of changeCache.keys()) if (key.startsWith(prefix) && !seenChanges.has(key)) changeCache.delete(key);

  return { inputs: { changes, archived, mainSpecs }, capabilityIds };
}

export interface DependencyComputation {
  graph: Record<string, ChangeDependencies>;
  capabilityIds: string[];
  /** Compute time (reads + graph), ms. */
  ms: number;
}

/** Read inputs and compute the graph for the active `names`. */
export async function computeDependencies(
  openspecDir: string,
  names: string[],
  mtimes?: Record<string, number | undefined>,
): Promise<DependencyComputation> {
  const t0 = performance.now();
  const { inputs, capabilityIds } = await collectDependencyInputs(openspecDir, names, mtimes);
  const graph = computeDependencyGraph(inputs);
  return { graph, capabilityIds, ms: performance.now() - t0 };
}

/** One-line summary of a computed graph: edge counts by source, issue counts by severity, ms. */
export function summarizeDependencyGraph(graph: Record<string, ChangeDependencies>, ms: number): string {
  const edges = { declared: 0, "inferred-text": 0, "inferred-capability": 0 };
  const issues = { error: 0, warning: 0 };
  for (const d of Object.values(graph)) {
    for (const e of d.blockedBy) edges[e.source]++;
    for (const i of d.issues) issues[i.severity]++;
  }
  return (
    `[openspec-deps] changes=${Object.keys(graph).length} edges declared=${edges.declared} ` +
    `inferred-text=${edges["inferred-text"]} inferred-capability=${edges["inferred-capability"]} ` +
    `issues error=${issues.error} warning=${issues.warning} ms=${ms.toFixed(1)}`
  );
}
