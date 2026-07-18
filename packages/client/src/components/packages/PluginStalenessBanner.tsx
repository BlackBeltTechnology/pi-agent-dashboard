import type React from "react";
import { useEffect, useState } from "react";
import { PLUGIN_REGISTRY_HASH } from "../../generated/plugin-registry.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

const SESSION_DISMISS_KEY = "pi-plugin-staleness-dismissed";

/**
 * PluginStalenessBanner
 *
 * Compares the client's build-time `PLUGIN_REGISTRY_HASH` against the
 * server's `/api/health.bundleHash`. When they differ, the running client
 * bundle was built against an older plugin set than the server now serves
 * (or the server was updated since this tab opened) — refreshing will pull
 * the new bundle.
 *
 * Per-session dismiss (sessionStorage); banner re-appears on next tab.
 *
 * See change: fix-pi-flows-end-to-end (Group 6).
 */
export function PluginStalenessBanner(): React.ReactElement | null {
  const [stale, setStale] = useState(false);
  const [serverHash, setServerHash] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const res = await fetch("/api/health");
        if (!res.ok) return;
        const json = (await res.json()) as { bundleHash?: string };
        if (cancelled) return;
        if (typeof json.bundleHash === "string") {
          setServerHash(json.bundleHash);
          setStale(json.bundleHash !== PLUGIN_REGISTRY_HASH);
        }
      } catch {
        /* offline / network — ignore, try again on next mount */
      }
    }
    void probe();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div
      data-testid="plugin-staleness-banner"
      className="flex items-center justify-between gap-2 px-3 py-1 text-xs bg-amber-500/15 text-amber-300 border-b border-amber-500/30"
    >
      <span>
        {i18nT("packages.dashboardPluginsWereUpdatedRefreshTo", undefined, "Dashboard plugins were updated. Refresh to load the latest contributions.")}
        {serverHash && (
          <span className="ml-2 opacity-60 font-mono">
            (server {serverHash.slice(0, 7)} {i18nT("common.client", undefined, "≠ client")} {PLUGIN_REGISTRY_HASH.slice(0, 7)})
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <button
          data-testid="plugin-staleness-reload"
          onClick={() => window.location.reload()}
          className="px-2 py-0.5 text-[11px] rounded bg-amber-500/30 hover:bg-amber-500/50 text-amber-100"
        >
          {i18nT("common.refresh", undefined, "Refresh")}
        </button>
        <button
          data-testid="plugin-staleness-dismiss"
          onClick={() => {
            try {
              sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
            } catch {
              /* sessionStorage unavailable — dismiss is in-memory only */
            }
            setDismissed(true);
          }}
          className="text-[11px] text-amber-200/70 hover:text-amber-100"
          aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
        >
          ×
        </button>
      </span>
    </div>
  );
}
