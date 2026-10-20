/**
 * Fetch /api/health and call `registry.setEnabledSet(...)` with the set of
 * plugin ids whose `enabled !== false`. Re-fetches on every
 * `plugin_config_update` broadcast (dispatched as a DOM CustomEvent by
 * useMessageHandler).
 *
 * Also exposes `startedAt` so the Plugins tab can detect a server restart
 * (to clear its Restart-required banner).
 *
 * See change: add-plugin-activation-ui.
 */

import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  clearFolderProjects,
  type SlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { useEffect, useRef, useState } from "react";
import { applyPluginStatuses, type PluginStatusLike } from "../lib/plugins/plugin-availability.js";
import { logRejection } from "../lib/report-error.js";

export interface PluginEnabledSetState {
  /** ISO timestamp of the server's process start (from /api/health.startedAt). */
  startedAt: string | null;
}

export function usePluginEnabledSet(registry: SlotRegistry): PluginEnabledSetState {
  const [startedAt, setStartedAt] = useState<string | null>(null);
  // Signature of the last applied enabled set (null until the first refresh).
  const lastEnabledSig = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const body = (await res.json()) as {
          plugins?: Array<PluginStatusLike>;
          startedAt?: string;
        };
        if (cancelled) return;
        // Default-allow semantics: the enabled set is
        //   (every build-time-known plugin id) MINUS (explicitly disabled ids).
        // This prevents a misconfigured / incomplete server-side discovery
        // (e.g. plugins not bundled into ~/.pi-dashboard/) from hiding every
        // claim the build-time PLUGIN_REGISTRY embedded into the client.
        // Plugins server explicitly reports as `enabled: false` are still
        // filtered. See change: add-plugin-activation-ui.
        const buildTimeIds = new Set(
          registry.getAllPluginsForActivationUi().map((p) => p.id),
        );
        const explicitlyDisabled = new Set(
          (body.plugins ?? [])
            .filter((p) => p.enabled === false)
            .map((p) => p.id),
        );
        const enabled = new Set<string>();
        for (const id of buildTimeIds) {
          if (!explicitlyDisabled.has(id)) enabled.add(id);
        }
        // Also include server-known plugins not in build-time registry,
        // unless explicitly disabled (handles future external plugins).
        for (const p of body.plugins ?? []) {
          if (p.enabled !== false) enabled.add(p.id);
        }
        registry.setEnabledSet(enabled);
        // Owned-event group rows decide at render time from this table
        // (the reducer never reads it). See change: decouple-plugins-from-core.
        applyPluginStatuses(body.plugins ?? []);
        // A changed set means a plugin's `projectTypes` rules joined/left, so every
        // cached folder project is suspect. An unchanged refresh keeps the cache.
        // See change: add-project-scoped-apps.
        const sig = Array.from(enabled).sort().join("\n");
        if (lastEnabledSig.current !== null && lastEnabledSig.current !== sig) clearFolderProjects();
        lastEnabledSig.current = sig;
        // `setEnabledSet` mutates the EXISTING registry — `getClaims` now
        // filters disabled plugins without the registry reference changing.
        // Memos keyed on that reference (claim lookups, the burst-transparency
        // predicate) would otherwise stay stale, so publish the invalidation
        // signal to force one re-read. See change: add-custom-entry-renderer-slot.
        bumpSlotClaimsVersion();
        if (typeof body.startedAt === "string") setStartedAt(body.startedAt);
      } catch {
        /* network failure — keep current state */
      }
    }

    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void refresh().catch(logRejection("usePluginEnabledSet.refresh"));

    // useMessageHandler re-emits plugin_config_update as a DOM event so this
    // hook can stay independent of the WS plumbing.
    const onPluginConfigUpdate = () => {
      void refresh();
    };
    window.addEventListener("plugin-config-update", onPluginConfigUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener("plugin-config-update", onPluginConfigUpdate);
    };
  }, [registry]);

  return { startedAt };
}
