/**
 * Managed-service state for a panel instance, read through
 * `pi-dashboard service status <id> --json` (design D4 step 1). That route is a
 * READ: it never ensures, starts or resolves secrets. Cached 5 s per id so a
 * polling panel costs one CLI spawn per window. See change: add-obs-studio-plugin.
 */
import type { DashboardCli } from "../core/dashboard-cli.js";

const STATE_CACHE_MS = 5000;

export interface ServiceState {
  id: string;
  state: string;
  mode?: string;
  reason?: string;
  hint?: string;
  exposure?: string;
  endpoints?: Record<string, string>;
  secrets?: Record<string, { configured: boolean }>;
}

export interface StateReader {
  read(id: string): Promise<ServiceState>;
  invalidate(id: string): void;
}

const PICK = ["state", "mode", "reason", "hint", "exposure", "endpoints", "secrets"] as const;

export function createStateReader(cli: DashboardCli, now: () => number = Date.now, ttlMs = STATE_CACHE_MS): StateReader {
  const cache = new Map<string, { at: number; value: Promise<ServiceState> }>();
  const load = async (id: string): Promise<ServiceState> => {
    const r = await cli.run(["service", "status", id, "--json"]);
    try {
      const j = JSON.parse(r.stdout.trim().split("\n").pop() ?? "{}") as { ok?: boolean; state?: string; data?: Record<string, unknown> };
      if (j.state === "no-server") return { id, state: "no-server" };
      if (!j.ok || !j.data || typeof j.data.state !== "string") return { id, state: "unknown" };
      const out: ServiceState = { id, state: String(j.data.state) };
      for (const k of PICK) if (j.data[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = j.data[k];
      return out;
    } catch {
      return { id, state: "unknown" };
    }
  };
  return {
    read(id) {
      const hit = cache.get(id);
      if (hit && now() - hit.at < ttlMs) return hit.value;
      const value = load(id);
      cache.set(id, { at: now(), value });
      // A failed read (CLI could not be spawned) is not cached for the window: retry on the next poll.
      value.catch(() => {
        if (cache.get(id)?.value === value) cache.delete(id);
      });
      return value;
    },
    invalidate: (id) => cache.delete(id),
  };
}
