/**
 * Skill-atlas service: fingerprint-gated memo + live-update push.
 *
 * GET path (design D3): resolve skills from the host cache (SWR), `stat` every
 * SKILL.md, hash `id|origin|pkg|description|filePath|mtime|ctime|size` +
 * scope + degraded. Unchanged fingerprint → memo, no body read. Otherwise read
 * bodies (first 256 KiB) and rebuild with the pure `buildSkillGraph`.
 *
 * Push path (design D5): host invalidation (`cwd` | undefined) → affected memo
 * keys (segment-wise ancestor/equal/descendant + `global`) → 500 ms debounce →
 * FRESH rescan → rebuild → broadcast only when the graph content hash differs
 * from the last one announced for that key.
 *
 * Memo: LRU of 32, key `global` | `project:<normalized abs cwd>`.
 * See change: add-skill-atlas-screen.
 */
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { buildSkillGraph } from "../shared/build-skill-graph.js";
import {
  BODY_BYTE_LIMIT,
  SKILL_ATLAS_CHANGED,
  type SkillAtlasChangedMessage,
  type SkillAtlasScope,
  type SkillGraphInput,
  type SkillGraphResponse,
} from "../shared/types.js";
import { type SkillEntry, skillEntries } from "./inputs.js";

export const MEMO_CAPACITY = 32;
export const DEBOUNCE_MS = 500;

/** Minimal fs surface (injectable for tests). */
export interface AtlasFs {
  stat(p: string): Promise<{ mtimeMs: number; ctimeMs: number; size: number }>;
  /** Read at most `limit` bytes; resolves the bytes read as utf8 text. */
  readHead(p: string, limit: number): Promise<string>;
}

export const nodeFs: AtlasFs = {
  stat: async (p) => {
    const s = await stat(p);
    return { mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, size: s.size };
  },
  readHead: async (p, limit) => {
    const fh = await open(p, "r");
    try {
      const buf = Buffer.alloc(limit);
      const { bytesRead } = await fh.read(buf, 0, limit, 0);
      return buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await fh.close();
    }
  },
};

export interface AtlasServiceDeps {
  getPiResources: (cwd?: string, opts?: { fresh?: boolean }) => Promise<PiResourcesResult>;
  broadcast: (msg: SkillAtlasChangedMessage) => void;
  fs?: AtlasFs;
  now?: () => number;
  log?: (msg: string) => void;
}

interface MemoEntry {
  scope: SkillAtlasScope;
  cwd?: string;
  fingerprint: string;
  graphHash: string;
  lastBroadcastHash: string;
  response: SkillGraphResponse;
}

/** Thrown for a bad request (→ HTTP 400). */
export class AtlasRequestError extends Error {}

/** Absolute, resolved, no trailing separator. Relative → AtlasRequestError. */
function normalizeCwd(cwd: string): string {
  if (!path.isAbsolute(cwd)) throw new AtlasRequestError("cwd_must_be_absolute");
  const resolved = path.resolve(cwd);
  return resolved.length > 1 && resolved.endsWith(path.sep) ? resolved.slice(0, -1) : resolved;
}

/** True when `a` equals, contains, or lies inside `b` (path-segment wise). */
function pathsRelated(a: string, b: string): boolean {
  if (a === b) return true;
  const within = (inner: string, outer: string) => inner.startsWith(outer.endsWith(path.sep) ? outer : outer + path.sep);
  return within(a, b) || within(b, a);
}

const memoKey = (scope: SkillAtlasScope, cwd?: string) => (scope === "global" ? "global" : `project:${cwd}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export function createAtlasService(deps: AtlasServiceDeps) {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? Date.now;
  const memo = new Map<string, MemoEntry>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inFlight = new Set<Promise<void>>();

  function remember(key: string, e: MemoEntry): void {
    memo.delete(key);
    memo.set(key, e);
    while (memo.size > MEMO_CAPACITY) memo.delete(memo.keys().next().value as string);
  }

  async function compute(
    scope: SkillAtlasScope,
    cwd: string | undefined,
    fresh: boolean,
  ): Promise<{ key: string; fingerprint: string; build: () => Promise<SkillGraphResponse> }> {
    const key = memoKey(scope, cwd);
    const result = await deps.getPiResources(scope === "global" ? undefined : cwd, fresh ? { fresh: true } : undefined);
    const degraded = result.degraded === true;
    const warnings: string[] = [];
    const lines: string[] = [];
    const kept: Array<SkillEntry & { size: number; unreadable?: boolean }> = [];
    for (const e of skillEntries(result, scope)) {
      const meta = `${e.id}\0${e.origin}\0${e.pkg ?? ""}\0${e.description}\0${e.filePath}`;
      try {
        const st = await fs.stat(e.filePath);
        lines.push(`${meta}\0${st.mtimeMs}\0${st.ctimeMs}\0${st.size}`);
        kept.push({ ...e, size: st.size });
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
          lines.push(`missing:${e.filePath}`);
          warnings.push(`skill ${e.id}: file vanished (${e.filePath})`);
        } else {
          lines.push(`unreadable:${meta}`);
          warnings.push(`skill ${e.id}: cannot stat ${e.filePath}`);
          kept.push({ ...e, size: 0, unreadable: true });
        }
      }
    }
    lines.sort();
    const fingerprint = sha([scope, degraded ? "degraded" : "ok", ...lines].join("\n"));

    const build = async (): Promise<SkillGraphResponse> => {
      const started = now();
      const inputs: SkillGraphInput[] = [];
      for (const e of kept) {
        let body = "";
        if (!e.unreadable) {
          try {
            body = await fs.readHead(e.filePath, BODY_BYTE_LIMIT);
            if (e.size > BODY_BYTE_LIMIT) warnings.push(`skill ${e.id}: only the first 256 KiB of SKILL.md is considered`);
          } catch {
            warnings.push(`skill ${e.id}: cannot read ${e.filePath}`);
          }
        }
        const { size: _size, unreadable: _u, ...input } = e;
        inputs.push({ ...input, body });
      }
      const graph = buildSkillGraph(inputs);
      deps.log?.(`rebuilt ${key}: ${graph.skills.length} skills, ${graph.links.length} links in ${now() - started}ms`);
      return {
        scope,
        ...(scope === "project" ? { cwd } : {}),
        fingerprint,
        builtAt: now(),
        degraded,
        warnings: [...new Set(warnings)].sort(),
        ...graph,
      };
    };
    return { key, fingerprint, build };
  }

  /** Graph for a request; rebuilds only when the fingerprint moved. */
  async function getGraph(scope: SkillAtlasScope, rawCwd?: string): Promise<SkillGraphResponse> {
    if (scope !== "project" && scope !== "global") throw new AtlasRequestError("invalid_scope");
    let cwd: string | undefined;
    if (scope === "project") {
      if (!rawCwd) throw new AtlasRequestError("cwd_required");
      cwd = normalizeCwd(rawCwd);
    }
    const { key, fingerprint, build } = await compute(scope, cwd, false);
    const hit = memo.get(key);
    if (hit && hit.fingerprint === fingerprint) {
      remember(key, hit);
      return hit.response;
    }
    const response = await build();
    const graphHash = sha(JSON.stringify({ s: response.skills, l: response.links, d: response.degraded }));
    // A first build announces nothing, so its hash is the baseline.
    remember(key, { scope, cwd, fingerprint, graphHash, lastBroadcastHash: hit?.lastBroadcastHash ?? graphHash, response });
    return response;
  }

  async function recheck(key: string): Promise<void> {
    const e = memo.get(key);
    if (!e) return;
    try {
      const { fingerprint, build } = await compute(e.scope, e.cwd, true);
      let current = memo.get(key) ?? e;
      if (fingerprint !== current.fingerprint) {
        const response = await build();
        const graphHash = sha(JSON.stringify({ s: response.skills, l: response.links, d: response.degraded }));
        current = { ...current, fingerprint, graphHash, response };
        remember(key, current);
      }
      if (current.graphHash !== current.lastBroadcastHash) {
        remember(key, { ...current, lastBroadcastHash: current.graphHash });
        deps.broadcast({ type: SKILL_ATLAS_CHANGED, scope: current.scope, ...(current.cwd ? { cwd: current.cwd } : {}) });
      }
    } catch (err) {
      deps.log?.(`recheck ${key} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Host invalidation → debounced rechecks of the affected memo keys. */
  function onInvalidated(rawCwd: string | undefined): void {
    let cwd: string | undefined;
    try {
      cwd = rawCwd === undefined ? undefined : normalizeCwd(rawCwd);
    } catch {
      return;
    }
    for (const [key, e] of memo) {
      const affected = cwd === undefined || e.scope === "global" || (e.cwd !== undefined && pathsRelated(e.cwd, cwd));
      if (!affected) continue;
      clearTimeout(timers.get(key));
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          const run = recheck(key).finally(() => inFlight.delete(run));
          inFlight.add(run);
        }, DEBOUNCE_MS),
      );
    }
  }

  function dispose(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  }

  /** Resolves once every started recheck has settled (tests, shutdown). */
  async function whenIdle(): Promise<void> {
    while (inFlight.size) await Promise.allSettled([...inFlight]);
  }

  return { getGraph, onInvalidated, dispose, whenIdle, memoKeys: () => [...memo.keys()] };
}

export type AtlasService = ReturnType<typeof createAtlasService>;
