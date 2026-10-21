import type React from "react";
import { useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useRuntimeLoaderState } from "../../lib/plugins/runtime-plugin-loader.js";

/**
 * Non-blocking "Plugin changes need a reload" notice: a loaded runtime plugin was removed, refused or
 * changed hash, but its module stays live until the page reloads (the shell never swaps a module in
 * place). Re-appears when a further change arrives after a dismiss.
 *
 * See change: decouple-plugins-from-core (task 6.17).
 */
export function RuntimePluginReloadNotice(): React.ReactElement | null {
  const { reloadNeeded } = useRuntimeLoaderState();
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!reloadNeeded) setDismissed(false);
  }, [reloadNeeded]);
  if (!reloadNeeded || dismissed) return null;
  return (
    <div
      role="status"
      data-testid="runtime-plugin-reload-notice"
      className="flex items-center justify-between gap-2 px-3 py-1 text-xs bg-amber-500/15 text-amber-300 border-b border-amber-500/30"
    >
      <span>{i18nT("packages.pluginChangesNeedReload", undefined, "Plugin changes need a reload")}</span>
      <span className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          data-testid="runtime-plugin-reload-btn"
          onClick={() => window.location.reload()}
          className="px-2 py-0.5 text-[11px] rounded bg-amber-500/30 hover:bg-amber-500/50 text-amber-100"
        >
          {i18nT("packages.pluginReloadNow", undefined, "Reload")}
        </button>
        <button
          type="button"
          data-testid="runtime-plugin-reload-dismiss"
          onClick={() => setDismissed(true)}
          className="text-[11px] text-amber-200/70 hover:text-amber-100"
          aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
        >
          ×
        </button>
      </span>
    </div>
  );
}
