/**
 * Pure fs/mtime helpers shared by `directory-service.ts` and
 * `openspec-poll-worker.ts`. Extracted so the worker can import these without
 * pulling all of `directory-service.ts` (which carries SessionManager /
 * PreferencesStore couplings) into its module graph.
 *
 * See change: offload-openspec-poll-to-worker.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { mapLimit, type TrackedExtras } from "@blackbelt-technology/pi-dashboard-shared/openspec-status-all.js";

export function statMtimeOr(p: string): number | undefined {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * Maximum mtime across a fixed list of paths. Missing paths (ENOENT) are
 * skipped — they don't poison the result. Returns `undefined` only when
 * every input is missing.
 *
 * Used by the change-detection gate to catch in-place file edits that don't
 * bump any parent directory's mtime on POSIX. See change:
 * fix-openspec-mtime-gate-blind-spots.
 */
export function effectiveMtimeOr(paths: string[]): number | undefined {
  let max: number | undefined;
  for (const p of paths) {
    const m = statMtimeOr(p);
    if (m === undefined) continue;
    if (max === undefined || m > max) max = m;
  }
  return max;
}

/**
 * File set tracked by the per-change effective-mtime computation.
 *
 * Base set: the change dir itself plus the three top-level artifact files.
 * The `specs/` fan-out catches multi-spec authoring:
 *   - `<change>/specs/`               — advances on capability dir create/remove
 *   - `<change>/specs/<cap>/`         — advances when `spec.md` is created inside
 *   - `<change>/specs/<cap>/spec.md`  — advances on in-place edits
 *
 * `readdirSync` is wrapped in try/catch so missing `specs/` (or any fs error)
 * yields an empty fan-out rather than throwing.
 *
 * See change: fix-openspec-specs-mtime-gate-blind-spot.
 */
export function perChangeArtifactPaths(changesRoot: string, name: string): string[] {
  const dir = path.join(changesRoot, name);
  const base = [
    dir,
    path.join(dir, "tasks.md"),
    path.join(dir, "proposal.md"),
    path.join(dir, "design.md"),
  ];
  const specsDir = path.join(dir, "specs");
  const specsExtras: string[] = [specsDir];
  try {
    const entries = fs.readdirSync(specsDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const capDir = path.join(specsDir, e.name);
        specsExtras.push(capDir);
        specsExtras.push(path.join(capDir, "spec.md"));
      }
    }
  } catch {
    // ENOENT, permission denied, etc. — leave specsExtras with just specsDir
    // (its own statMtimeOr will return undefined and be excluded from max).
  }
  return [...base, ...specsExtras];
}

// ── `status --all` tracked-path probe (async, bounded) ──────────────────────

export interface ProbeRequest {
  /** Server-canonical `<cwd>/openspec` directory (realpath). */
  openspecDir: string;
  /** Per-change extras from the last successful `--all` result; `null` before the first one (legacy set only). */
  extras: Record<string, TrackedExtras> | null;
  /**
   * Capability ids touched by an active delta in the previous build; the probe
   * stats `specs/<cap>/` and `specs/<cap>/spec.md` for each (L2 reads main-spec
   * existence). `null`/absent before the first build: the cwd-level stamp is
   * then incomplete and the gate does not skip. See change: add-openspec-change-dependencies.
   */
  capabilityIds?: readonly string[] | null;
}

export interface ProbeResponse {
  /**
   * Max mtime over the cwd-level set (`openspec/`, `changes/`, `changes/archive/`, `config.yaml`,
   * `specs/`, the main-spec paths of `capabilityIds`, everything under `schemas/`).
   */
  cwdMtime: number | undefined;
  /** Enumerated change directories (excludes `archive/` and dot-dirs), sorted by name. */
  names: string[];
  /** Per-change effective mtime (max over its tracked paths); `undefined` when none exist. */
  changes: Record<string, number | undefined>;
}

const STAT_CONCURRENCY = 64;
const MAX_WALK_DEPTH = 8;

async function statMtime(p: string): Promise<number | undefined> {
  try {
    return (await fs.promises.stat(p)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function maxMtime(paths: readonly string[]): Promise<number | undefined> {
  const mtimes = await mapLimit(paths, STAT_CONCURRENCY, statMtime);
  let max: number | undefined;
  for (const m of mtimes) if (m !== undefined && (max === undefined || m > max)) max = m;
  return max;
}

/**
 * Recursively list entries under `dir` (never follows symlinks; ENOENT yields
 * nothing). `filesToo=false` lists directories only.
 */
async function walk(dir: string, filesToo: boolean, depth = 0): Promise<string[]> {
  if (depth > MAX_WALK_DEPTH) return [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  const subdirs: string[] = [];
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(p);
      subdirs.push(p);
    } else if (filesToo) {
      out.push(p);
    }
  }
  for (const sub of subdirs) out.push(...(await walk(sub, filesToo, depth + 1)));
  return out;
}

async function listChangeNames(changesDir: string): Promise<string[]> {
  try {
    const entries = await fs.promises.readdir(changesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name !== "archive" && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Legacy fixed per-change set plus `.openspec.yaml`; `specs/<cap>` fan-out via readdir. */
async function legacyChangePaths(changeDir: string): Promise<string[]> {
  const base = [
    changeDir,
    path.join(changeDir, ".openspec.yaml"),
    path.join(changeDir, "dependencies.yaml"),
    path.join(changeDir, "tasks.md"),
    path.join(changeDir, "proposal.md"),
    path.join(changeDir, "design.md"),
  ];
  const specsDir = path.join(changeDir, "specs");
  const out = [...base, specsDir];
  try {
    for (const e of await fs.promises.readdir(specsDir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const capDir = path.join(specsDir, e.name);
        out.push(capDir, path.join(capDir, "spec.md"));
      }
    }
  } catch {
    // no specs/ yet — fan-out stays empty
  }
  return out;
}

/**
 * Cwd-level dependency inputs beyond the legacy set: `changes/archive/` (an
 * archive satisfies edges), `openspec/specs/` and, for each capability id,
 * every directory prefix plus `spec.md` (directory mtimes catch deletions).
 */
function dependencyCwdPaths(openspecDir: string, capabilityIds: readonly string[] | null | undefined): string[] {
  const out = [path.join(openspecDir, "changes", "archive"), path.join(openspecDir, "specs")];
  for (const cap of capabilityIds ?? []) {
    const parts = cap.split("/");
    for (let i = 1; i <= parts.length; i++) out.push(path.join(openspecDir, "specs", ...parts.slice(0, i)));
    out.push(path.join(openspecDir, "specs", ...parts, "spec.md"));
  }
  return out;
}

/**
 * Tracked-path probe for the `status --all` gate: cwd-level effective mtime
 * plus one effective mtime per enumerated change. Async and bounded so it can
 * run in-process without a long synchronous turn. Missing paths are skipped,
 * never treated as zero. See change: use-openspec-status-all.
 */
export async function probeTrackedPaths(req: ProbeRequest): Promise<ProbeResponse> {
  const { openspecDir, extras } = req;
  const changesDir = path.join(openspecDir, "changes");
  const names = await listChangeNames(changesDir);

  const cwdPaths = [openspecDir, changesDir, path.join(openspecDir, "config.yaml")];
  const schemaTree = await walk(path.join(openspecDir, "schemas"), true);
  const cwdMtime = await maxMtime([
    ...cwdPaths,
    ...dependencyCwdPaths(openspecDir, req.capabilityIds),
    path.join(openspecDir, "schemas"),
    ...schemaTree,
  ]);

  const mtimes = await mapLimit(names, 16, async (name) => {
    const changeDir = path.join(changesDir, name);
    const paths = await legacyChangePaths(changeDir);
    const extra = extras?.[name];
    if (extra) {
      paths.push(...extra.files);
      for (const prefix of extra.globPrefixes) paths.push(...(await walk(prefix, false)));
    }
    return maxMtime(paths);
  });
  const changes: Record<string, number | undefined> = {};
  names.forEach((n, i) => {
    changes[n] = mtimes[i];
  });
  return { cwdMtime, names, changes };
}
