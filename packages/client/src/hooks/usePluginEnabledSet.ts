/**
 * Fetch /api/health and call `registry.setEnabledSet(...)` with the set of
 * plugin ids whose `enabled !== false`. Re-fetches on every
 * `plugin_config_update` broadcast (dispatched as a DOM CustomEvent by
 * useMessageHandler). A `plugins_changed` broadcast (also a DOM event) carries
 * the full status snapshot: the enabled set AND `pluginAvailability` are
 * recomputed from that same snapshot, with no extra fetch.
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
  setSessionReducerEnabledSet,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { useEffect, useRef, useState } from "react";
import { applyPluginStatuses, type PluginStatusLike } from "../lib/plugins/plugin-availability.js";
import { RUNTIME_PLUGINS_REGISTERED_EVENT } from "../lib/plugins/runtime-plugin-loader.js";
import { logRejection } from "../lib/report-error.js";

export interface PluginEnabledSetState {
  /** ISO timestamp of the server's process start (from /api/health.startedAt). */
  startedAt: string | null;
}

export function usePluginEnabledSet(registry: SlotRegistry): PluginEnabledSetState {
  const [startedAt, setStartedAt] = useState<string | null>(null);
  // Signature of the last applied enabled set (null until the first refresh).
  const lastEnabledSig = useRef<string | null>(null);
  // Last status snapshot applied (null until the first read): re-applied when a runtime plugin registers.
  const lastPlugins = useRef<ReadonlyArray<PluginStatusLike> | null>(null);

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
        applySnapshot(body.plugins ?? []);
        if (typeof body.startedAt === "string") setStartedAt(body.startedAt);
      } catch {
        /* network failure — keep current state */
      }
    }

    /** Recompute the enabled set + plugin availability from one status snapshot. */
    function applySnapshot(plugins: ReadonlyArray<PluginStatusLike>) {
      lastPlugins.current = plugins;
      try {
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
          plugins
            .filter((p) => p.enabled === false)
            .map((p) => p.id),
        );
        const enabled = new Set<string>();
        for (const id of buildTimeIds) {
          if (!explicitlyDisabled.has(id)) enabled.add(id);
        }
        // Also include server-known plugins not in build-time registry,
        // unless explicitly disabled (handles future external plugins).
        for (const p of plugins) {
          if (p.enabled !== false) enabled.add(p.id);
        }
        registry.setEnabledSet(enabled);
        // Session reducer slices/finalizers follow the SAME enabled set as claims;
        // applies to later events only. See change: decouple-plugins-from-core.
        setSessionReducerEnabledSet(enabled);
        // Owned-event group rows decide at render time from this table
        // (the reducer never reads it). See change: decouple-plugins-from-core.
        applyPluginStatuses(plugins);
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
      } catch {
        /* malformed snapshot — keep current state */
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
    // `plugins_changed` carries the status snapshot itself: no refetch.
    const onPluginsChanged = (e: Event) => {
      const plugins = (e as CustomEvent<{ plugins?: PluginStatusLike[] }>).detail?.plugins;
      if (Array.isArray(plugins)) applySnapshot(plugins);
    };
    // A runtime plugin registered AFTER the status read: its id is now in the registry summaries, so
    // re-applying the last snapshot (default-allow) puts it in the enabled set. No refetch; before the
    // first read there is nothing to re-apply (the first read sees the registered plugin anyway).
    const onRuntimeRegistered = () => {
      if (lastPlugins.current) applySnapshot(lastPlugins.current);
    };
    window.addEventListener("plugin-config-update", onPluginConfigUpdate);
    window.addEventListener(RUNTIME_PLUGINS_REGISTERED_EVENT, onRuntimeRegistered);
    window.addEventListener("plugins-changed", onPluginsChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("plugin-config-update", onPluginConfigUpdate);
      window.removeEventListener(RUNTIME_PLUGINS_REGISTERED_EVENT, onRuntimeRegistered);
      window.removeEventListener("plugins-changed", onPluginsChanged);
    };
  }, [registry]);

  return { startedAt };
}
