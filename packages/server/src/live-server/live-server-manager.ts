/**
 * Live-server-preview manager — the allowlist registry + SSRF gate for
 * embedding a running loopback dev server in a dashboard tab.
 *
 * `start()` validates the target through the shared `validateLiveTarget`
 * (loopback-only, port range) — the SSRF boundary — then registers it and
 * persists the allowlist via the preferences store. The reverse proxy
 * (`live-server-proxy.ts`) only ever forwards to a registered, already-
 * validated target, so an attacker cannot smuggle a non-loopback host in
 * through the proxy path.
 *
 * See change: improve-content-editor (live-server-preview §6).
 */
import { randomUUID } from "node:crypto";
import {
  type LiveServerTarget,
  liveServerPath,
  validateLiveTarget,
} from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";

export interface LiveServerManager {
  /** Validate + register (idempotent by host:port) + persist. */
  start(input: { host?: unknown; port?: unknown; label?: unknown }):
    | { ok: true; target: LiveServerTarget; path: string }
    | { ok: false; error: string };
  get(id: string): LiveServerTarget | undefined;
  list(): LiveServerTarget[];
  remove(id: string): void;
}

export function createLiveServerManager(preferencesStore: PreferencesStore): LiveServerManager {
  // Seed from the persisted allowlist so previously-added targets survive
  // restart. Re-validate every entry through the SSRF gate: a hand-edited /
  // legacy `preferences.json` could otherwise reintroduce a non-loopback
  // target that never passed `start()`. Drop anything invalid, and canonicalize
  // the persisted store if we dropped or normalized entries.
  const targets = new Map<string, LiveServerTarget>();
  let seededDirty = false;
  const persisted = preferencesStore.getLiveServers();
  for (const t of persisted) {
    const v = validateLiveTarget(t);
    if (!v.ok || typeof t.id !== "string" || !t.id) {
      seededDirty = true; // dropping an invalid persisted entry
      continue;
    }
    targets.set(t.id, { id: t.id, label: v.label, host: v.host, port: v.port });
  }

  const persist = () => preferencesStore.setLiveServers([...targets.values()]);
  if (seededDirty) persist();

  return {
    start(input) {
      const v = validateLiveTarget(input);
      if (!v.ok) return { ok: false, error: v.error };
      // Idempotent by host:port — re-adding the same target reuses its id.
      const existing = [...targets.values()].find((t) => t.host === v.host && t.port === v.port);
      const target: LiveServerTarget =
        existing ?? { id: randomUUID().slice(0, 8), label: v.label, host: v.host, port: v.port };
      // Only overwrite the stored label when the caller EXPLICITLY supplied a
      // non-empty one; otherwise a bare re-`start()` (no label) would clobber a
      // previously-set custom label with the `host:port` default.
      const explicitLabel = typeof input.label === "string" && input.label.trim().length > 0;
      if (!existing) {
        targets.set(target.id, target);
        persist();
      } else if (explicitLabel && existing.label !== v.label) {
        existing.label = v.label;
        persist();
      }
      return { ok: true, target, path: liveServerPath(target.id) };
    },
    get(id) {
      return targets.get(id);
    },
    list() {
      return [...targets.values()];
    },
    remove(id) {
      if (targets.delete(id)) persist();
    },
  };
}
