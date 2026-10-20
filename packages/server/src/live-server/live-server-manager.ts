/**
 * Live-server-preview manager — the registry + SSRF gate for embedding a
 * running loopback dev server (or a static document root) in a dashboard tab.
 *
 * Three kinds of target:
 *  - **user** port targets (`addedBy:"user"`) and **legacy** ones (persisted
 *    before `addedBy` existed) — persisted via the preferences store;
 *  - **preset** port targets (`addedBy:"preset"`, agent-declared, registered
 *    after the operator taps the confirm chip) — in memory only, ≤16 per
 *    session, least-recently-used evicted;
 *  - **static** targets (a document root served from the raw file-read gate) —
 *    in memory only, ≤32 per cwd, least-recently-used evicted.
 *
 * `start()`/`startPreset()` validate through the shared `validateLiveTarget`
 * (loopback-only, port range) — the SSRF boundary — and refuse every port the
 * dashboard itself listens on (a loopback origin is trusted by the dashboard's
 * CORS and mutation gates). The reverse proxy only ever forwards to a
 * registered, already-validated target. An evicted/removed target's tokens die
 * through the eviction listener and the capability store's liveness re-check.
 *
 * See change: improve-content-editor (live-server-preview §6),
 * improve-canvas-html-and-url-ux (design D1).
 */
import { randomUUID } from "node:crypto";
import {
  type LiveServerTarget,
  liveServerPath,
  type StaticTarget,
  validateLiveTarget,
} from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";

/** Presets kept per session / static targets kept per cwd. */
export const MAX_PRESETS_PER_SESSION = 16;
export const MAX_STATIC_PER_CWD = 32;

type StartInput = { host?: unknown; port?: unknown; label?: unknown; addedBy?: unknown; sessionId?: unknown };
type StartResult =
  | { ok: true; target: LiveServerTarget; path: string }
  | { ok: false; error: string };

export interface LiveServerManager {
  /**
   * Validate + register (idempotent by host:port). `addedBy:"preset"` delegates to
   * {@link startPreset} (in memory); anything else is a user add and is persisted.
   */
  start(input: StartInput): StartResult;
  /** Register an agent-declared loopback target in memory only (≤16 per session, LRU). */
  startPreset(input: StartInput): StartResult;
  /** Register (or reuse) the static target for `(cwd, root)` (≤32 per cwd, LRU). */
  startStatic(input: { cwd: string; root: string }): { ok: true; target: StaticTarget } | { ok: false; error: string };
  /** A registered PORT target. */
  get(id: string): LiveServerTarget | undefined;
  /** A registered STATIC target. */
  getStatic(id: string): StaticTarget | undefined;
  /** Is `id` a live target of either kind? */
  has(id: string): boolean;
  /** Every port target (persisted and preset), each with `addedBy`. Static targets are not listed. */
  list(): LiveServerTarget[];
  remove(id: string): void;
  /** Mark `id` as used (registration or an accepted request): LRU order for presets and static targets. */
  use(id: string): void;
  /** Called with the id of every preset / static target evicted by a cap. */
  setEvictionListener(listener: (id: string) => void): void;
}

export interface LiveServerManagerOptions {
  /** Ports the dashboard itself listens on; no port target may point at them. */
  ownPorts?: () => readonly number[];
}

export function createLiveServerManager(
  preferencesStore: PreferencesStore,
  options: LiveServerManagerOptions = {},
): LiveServerManager {
  const ownPorts = (): ReadonlySet<number> => {
    try {
      return new Set(options.ownPorts?.() ?? []);
    } catch {
      return new Set();
    }
  };
  const refusesOwnPort = (port: number): string | null =>
    ownPorts().has(port) ? "that port is the dashboard's own; it cannot be previewed" : null;

  // Seed from the persisted allowlist so previously-added targets survive
  // restart. Re-validate every entry through the SSRF gate: a hand-edited /
  // legacy `preferences.json` could otherwise reintroduce a non-loopback
  // target that never passed `start()`. Drop anything invalid, and canonicalize
  // the persisted store if we dropped or normalized entries. `addedBy` is
  // preserved; an entry without it (or with an unknown value) seeds as `legacy`.
  const persisted = new Map<string, LiveServerTarget>();
  const presets = new Map<string, { target: LiveServerTarget; sessionId: string; seq: number }>();
  const statics = new Map<string, { target: StaticTarget; seq: number }>();
  let seq = 0;
  let onEvict: (id: string) => void = () => undefined;
  let seededDirty = false;
  for (const t of preferencesStore.getLiveServers()) {
    const v = validateLiveTarget(t);
    if (!v.ok || typeof t.id !== "string" || !t.id || refusesOwnPort(v.port)) {
      seededDirty = true; // dropping an invalid persisted entry
      continue;
    }
    persisted.set(t.id, {
      id: t.id,
      label: v.label,
      host: v.host,
      port: v.port,
      addedBy: t.addedBy === "user" ? "user" : "legacy",
    });
  }

  // A legacy entry is written back exactly as it was read (no `addedBy`), so a
  // downgrade/upgrade round trip never invents provenance.
  const persist = () =>
    preferencesStore.setLiveServers(
      [...persisted.values()].map((t) =>
        t.addedBy === "legacy" ? { id: t.id, label: t.label, host: t.host, port: t.port } : t,
      ),
    );
  if (seededDirty) persist();

  const findPort = (host: string, port: number): LiveServerTarget | undefined =>
    [...persisted.values(), ...[...presets.values()].map((p) => p.target)].find(
      (t) => t.host === host && t.port === port,
    );

  const sessionOf = (input: StartInput): string => (typeof input.sessionId === "string" ? input.sessionId : "");

  const startPreset = (input: StartInput): StartResult => {
    const v = validateLiveTarget(input);
    if (!v.ok) return { ok: false, error: v.error };
    const own = refusesOwnPort(v.port);
    if (own) return { ok: false, error: own };
    // Idempotent: an existing target (user, legacy or preset) is reused, never downgraded.
    const existing = findPort(v.host, v.port);
    if (existing) {
      manager.use(existing.id);
      return { ok: true, target: existing, path: liveServerPath(existing.id) };
    }
    const sessionId = sessionOf(input);
    const target: LiveServerTarget = {
      id: randomUUID().slice(0, 8),
      label: v.label,
      host: v.host,
      port: v.port,
      addedBy: "preset",
    };
    presets.set(target.id, { target, sessionId, seq: ++seq });
    const mine = [...presets.entries()].filter(([, p]) => p.sessionId === sessionId);
    while (mine.length > MAX_PRESETS_PER_SESSION) {
      mine.sort((a, b) => a[1].seq - b[1].seq);
      const [lruId] = mine.shift() as [string, unknown];
      presets.delete(lruId);
      onEvict(lruId);
    }
    return { ok: true, target, path: liveServerPath(target.id) };
  };

  /** An explicit user add promotes a preset / legacy entry: it joins the persisted allowlist. Returns whether it changed. */
  const promoteToUser = (t: LiveServerTarget): boolean => {
    if (t.addedBy === "user") return false;
    presets.delete(t.id);
    t.addedBy = "user";
    persisted.set(t.id, t);
    return true;
  };
  const relabel = (t: LiveServerTarget, label: string): boolean => {
    if (t.label === label) return false;
    t.label = label;
    return true;
  };

  const manager: LiveServerManager = {
    start(input) {
      if (input.addedBy === "preset") return startPreset(input);
      const v = validateLiveTarget(input);
      if (!v.ok) return { ok: false, error: v.error };
      const own = refusesOwnPort(v.port);
      if (own) return { ok: false, error: own };
      // Idempotent by host:port — re-adding the same target reuses its id.
      // An explicit user add promotes a preset or legacy entry to `user` (persisted).
      const existing = findPort(v.host, v.port);
      // Only overwrite the stored label when the caller EXPLICITLY supplied a
      // non-empty one; otherwise a bare re-`start()` (no label) would clobber a
      // previously-set custom label with the `host:port` default.
      const explicitLabel = typeof input.label === "string" && input.label.trim().length > 0;
      if (!existing) {
        const target: LiveServerTarget = {
          id: randomUUID().slice(0, 8),
          label: v.label,
          host: v.host,
          port: v.port,
          addedBy: "user",
        };
        persisted.set(target.id, target);
        persist();
        return { ok: true, target, path: liveServerPath(target.id) };
      }
      const promoted = promoteToUser(existing);
      const relabeled = explicitLabel && relabel(existing, v.label);
      if (promoted || relabeled) persist();
      return { ok: true, target: existing, path: liveServerPath(existing.id) };
    },
    startPreset,
    startStatic({ cwd, root }) {
      if (typeof cwd !== "string" || !cwd || typeof root !== "string" || !root) {
        return { ok: false, error: "cwd and root are required" };
      }
      for (const entry of statics.values()) {
        if (entry.target.cwd === cwd && entry.target.root === root) {
          entry.seq = ++seq;
          return { ok: true, target: entry.target };
        }
      }
      const target: StaticTarget = { id: `st-${randomUUID().slice(0, 8)}`, cwd, root };
      statics.set(target.id, { target, seq: ++seq });
      const mine = [...statics.entries()].filter(([, s]) => s.target.cwd === cwd);
      while (mine.length > MAX_STATIC_PER_CWD) {
        mine.sort((a, b) => a[1].seq - b[1].seq);
        const [lruId] = mine.shift() as [string, unknown];
        statics.delete(lruId);
        onEvict(lruId);
      }
      return { ok: true, target };
    },
    get(id) {
      return persisted.get(id) ?? presets.get(id)?.target;
    },
    getStatic(id) {
      return statics.get(id)?.target;
    },
    has(id) {
      return persisted.has(id) || presets.has(id) || statics.has(id);
    },
    list() {
      return [...persisted.values(), ...[...presets.values()].map((p) => p.target)];
    },
    remove(id) {
      if (persisted.delete(id)) persist();
      presets.delete(id);
      statics.delete(id);
    },
    use(id) {
      const p = presets.get(id);
      if (p) p.seq = ++seq;
      const s = statics.get(id);
      if (s) s.seq = ++seq;
    },
    setEvictionListener(listener) {
      onEvict = listener;
    },
  };
  return manager;
}
