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
import { useEffect, useState } from "react";
import type { SlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime";
import { logRejection } from "../lib/report-error.js";

export interface PluginEnabledSetState {
  /** ISO timestamp of the server's process start (from /api/health.startedAt). */
  startedAt: string | null;
}

export function usePluginEnabledSet(registry: SlotRegistry): PluginEnabledSetState {
  const [startedAt, setStartedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const body = (await res.json()) as {
          plugins?: Array<{ id: string; enabled?: boolean }>;
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
          Array.from(registry.getAllPluginsForActivationUi().keys()),
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
