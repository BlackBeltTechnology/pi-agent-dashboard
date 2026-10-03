/**
 * mcp-client-plugin · CORE live server state from `pi mcp list --json`.
 *
 * Connection state and tool counts come from pi, never re-implemented:
 *  - 30 s timeout — the runner's child is killed through the AbortSignal and
 *    the result is "state unknown" (`timeout`), never stale data;
 *  - 30 s cache per cwd (the command connects to every server, so it is slow
 *    and may have side effects);
 *  - stdout is parsed WHATEVER the exit code: pi exits 1 whenever an entry is
 *    invalid or an enabled server is not connected (normal, not a failure).
 *    Only a spawn failure, a timeout or unparseable stdout yield `ok: false`.
 *
 * The global settings view runs the command in an always-empty scratch dir so
 * only the Pi-global layer loads (a folder's trusted `.pi/mcp.json` must not
 * leak into the global list).
 *
 * See change: migrate-mcp-to-pi-builtin (D3 "Live state").
 */

import { isPlainObject } from "./path-utils.js";
import type { LiveServerState, LiveState, PiMcpListRunner } from "./types.js";

export const LIVE_STATE_TIMEOUT_MS = 30_000;
export const LIVE_STATE_CACHE_TTL_MS = 30_000;

export interface LiveStateReaderDeps {
  runner: PiMcpListRunner;
  timeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface LiveStateReader {
  /** Live state for `cwd`; `fresh` bypasses (and refills) the cache. */
  read(cwd: string, opts?: { fresh?: boolean }): Promise<LiveState>;
}

/** Parse `pi mcp list --json` stdout; `null` when it is not pi's shape. */
export function parseMcpListJson(stdout: string): Extract<LiveState, { ok: true }> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.servers)) return null;
  const servers: Record<string, LiveServerState> = Object.create(null);
  for (const s of parsed.servers) {
    if (!isPlainObject(s) || typeof s.name !== "string" || typeof s.state !== "string") continue;
    servers[s.name] = {
      state: s.state,
      tools: Array.isArray(s.tools) ? s.tools.length : 0,
      ...(typeof s.error === "string" ? { error: s.error } : {}),
    };
  }
  const errors = Array.isArray(parsed.errors) ? parsed.errors.filter((e): e is string => typeof e === "string") : [];
  return { ok: true, servers, errors, ...(typeof parsed.note === "string" ? { note: parsed.note } : {}) };
}

export function createLiveStateReader(deps: LiveStateReaderDeps): LiveStateReader {
  const timeoutMs = deps.timeoutMs ?? LIVE_STATE_TIMEOUT_MS;
  const ttl = deps.cacheTtlMs ?? LIVE_STATE_CACHE_TTL_MS;
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { at: number; value: Promise<LiveState>; settled: boolean }>();


  async function run(cwd: string): Promise<LiveState> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    try {
      const outcome = await Promise.race([deps.runner(cwd, controller.signal), timedOut]);
      if (outcome === "timeout") {
        controller.abort();
        return { ok: false, reason: "timeout", message: `pi mcp list did not finish within ${timeoutMs / 1000}s` };
      }
      const parsed = parseMcpListJson(outcome.stdout);
      if (!parsed) {
        return { ok: false, reason: "unparseable", message: `pi mcp list printed no JSON (exit ${outcome.code})` };
      }
      return parsed;
    } catch (e) {
      return { ok: false, reason: "spawn-failed", message: `could not run pi mcp list: ${(e as Error).message}` };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  interface Slot {
    at: number;
    value: Promise<LiveState>;
    settled: boolean;
  }
  /** One queued post-refresh run per cwd, coalescing every fresh request made meanwhile. */
  const queued = new Map<string, Promise<LiveState>>();

  function start(cwd: string): Promise<LiveState> {
    const value = run(cwd);
    const slot: Slot = { at: now(), value, settled: false };
    cache.set(cwd, slot);
    void value.then((r) => {
      slot.settled = true;
      // A failure is not cached: the next view retries instead of showing
      // "state unknown" for a whole TTL.
      if (!r.ok && cache.get(cwd) === slot) cache.delete(cwd);
    });
    return value;
  }

  return {
    read(cwd, opts) {
      const hit = cache.get(cwd);
      if (hit && !hit.settled) {
        // One `pi mcp list` (which connects to every server) per cwd at a
        // time. A plain read shares the in-flight run; a `fresh` read must see
        // a run that STARTS after it, so it queues one follow-up (≤ 1 running
        // + 1 queued per cwd; later fresh reads join the same follow-up).
        if (!opts?.fresh) return hit.value;
        const pending = queued.get(cwd);
        if (pending) return pending;
        const next = hit.value.then(() => {
          queued.delete(cwd);
          return start(cwd);
        });
        queued.set(cwd, next);
        return next;
      }
      if (!opts?.fresh && hit && now() - hit.at < ttl) return hit.value;
      return start(cwd);
    },
  };
}
