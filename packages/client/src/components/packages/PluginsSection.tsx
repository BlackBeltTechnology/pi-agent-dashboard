/**
 * Settings ▸ Plugins tab — activation list.
 *
 * Renders every discovered plugin with: status pill, toggle, and a settings-cog
 * affordance that navigates to the plugin's own page at
 * `/settings/plugins/<id>`. Settings are never rendered inline here.
 *
 * Surfaces `missingRequirements` from PluginStatus with a one-click
 * `[Install]` button that reuses the existing package-operations install
 * pipeline when the missing requirement matches a `RECOMMENDED_EXTENSIONS.id`.
 *
 * Errors (e.g. failed-to-load plugins, id conflicts, bridge probe failures)
 * render their full message inline in a copy-on-click block beneath the row.
 *
 * Shows a Restart-required banner whenever a toggle has been issued since the
 * server's last `startedAt` (ISO timestamp from `/api/health`).
 *
 * Presentational internals live in `plugin-row-parts.tsx`; the toggle path
 * lives in `usePluginToggle`, both shared with `PluginSettingsPage`.
 *
 * See change: add-plugin-activation-ui, plugin-settings-pages.
 */

import { mdiCogOutline, mdiPackageVariantClosed, mdiRestart } from "@mdi/js";
import Icon from "@mdi/react";
import { useLocation } from "wouter";
import type { PluginList, PluginToggle } from "../../hooks/usePluginToggle.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import {
  CopyableErrorBlock,
  MissingRequirementsBlock,
  StatusPill,
  WARN_BG,
  WARN_BORDER,
  WARN_FG,
} from "./plugin-row-parts.js";

/**
 * `list`/`toggle` come from `SettingsPanel`, which already mounts them for the
 * nav rail. Owning a second instance here would duplicate the `/api/plugins`,
 * `/api/config`, and `/api/health` fetches plus the `plugin-config-update`
 * listener, and — worse — would hold a desired-state overlay SEPARATE from the
 * rail's, so the index and the rail could disagree about what is enabled.
 */
export function PluginsSection({
  list,
  toggle,
  contributesSettings,
}: {
  list: PluginList;
  toggle: PluginToggle;
  /**
   * Shared "does this plugin contribute settings" predicate. MUST be the same
   * one the nav rail and the route guard use: a claims-only test here would
   * give an intent-only plugin a disabled cog reading "No settings for this
   * plugin" while the nav lists it and its page renders.
   */
  contributesSettings: (row: PluginRow) => boolean;
}) {
  const [, navigate] = useLocation();
  const { rows, loading, error } = list;

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)]">{i18nT("packages.loadingPlugins", undefined, "Loading plugins…")}</div>;
  }
  if (error) {
    return (
      <div className="space-y-2" data-testid="plugins-section-error">
        <CopyableErrorBlock text={`Failed to load plugins: ${error}`} testId="plugins-load-error" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="plugins-section">
      {toggle.cascadeDialog}
      {toggle.restartRequired && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded ${WARN_BG} border ${WARN_BORDER} ${WARN_FG} text-sm`}
          data-testid="plugins-restart-required-banner"
        >
          <Icon path={mdiRestart} size={0.6} />
          <span className="flex-1">
            {i18nT("packages.pluginChangesTakeEffectAfterA", undefined, "Plugin changes take effect after a server restart.")}
          </span>
          <button
            type="button"
            onClick={toggle.handleRestart}
            disabled={toggle.restarting}
            className={`px-2 py-1 rounded text-xs ${WARN_BG} hover:opacity-80 ${WARN_FG} border ${WARN_BORDER} disabled:opacity-50`}
            data-testid="plugins-restart-now-btn"
          >
            {toggle.restarting ? "Restarting…" : "Restart now"}
          </button>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.length === 0 && (
          <div
            className="px-3 py-4 text-sm text-[var(--text-muted)] border border-dashed border-[var(--border-secondary)] rounded"
            data-testid="plugins-empty-state"
          >
            {i18nT("packages.noPluginsInstalled", undefined, "No plugins installed.")}
            <span className="block mt-1 text-[11px] text-[var(--text-tertiary)]">
              {i18nT("packages.pluginsAreDiscoveredFromTheMonorepo", undefined, "Plugins are discovered from the monorepo,")}{" "}
              <code>~/.pi/dashboard/plugins/</code>{i18nT("common.orTheBundledSet", undefined, ", or the bundled set.")}
            </span>
          </div>
        )}
        {rows.map((row) => {
          const hasSettings = contributesSettings(row);
          const isEnabled = row.status?.enabled !== false;
          const statusError = row.status?.error;
          const toggleError = toggle.toggleErrorFor(row.id);
          const cogTitle = hasSettings
            ? "Open plugin settings"
            : "No settings for this plugin";
          return (
            <div
              key={row.id}
              className="border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)]"
              data-testid={`plugin-row-${row.id}`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <Icon path={mdiPackageVariantClosed} size={0.6} className="text-[var(--text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] font-medium truncate">
                    {row.displayName}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate">{row.id}</div>
                </div>
                <StatusPill row={row} />
                {!isEnabled && (
                  // Explain the absence from the nav rail where the user looks
                  // for it (design D4).
                  <span
                    className="text-[10px] text-[var(--text-tertiary)]"
                    data-testid={`plugin-disabled-note-${row.id}`}
                  >
                    {i18nT("packages.notInSettingsNav", undefined, "not in Settings nav")}
                  </span>
                )}
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    disabled={toggle.isToggling(row.id)}
                    onChange={(e) => toggle.handleToggle(row, e.target.checked)}
                    data-testid={`plugin-toggle-${row.id}`}
                    className="accent-blue-500"
                  />
                  <span className="text-[10px] text-[var(--text-secondary)]">enable</span>
                </label>
                <button
                  type="button"
                  onClick={() => hasSettings && navigate(`/settings/plugins/${row.id}`)}
                  disabled={!hasSettings}
                  className={`p-1.5 rounded transition-colors ${
                    hasSettings
                      ? "hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
                      : "text-[var(--text-tertiary)] opacity-40 cursor-not-allowed"
                  }`}
                  title={cogTitle}
                  data-testid={`plugin-expand-${row.id}`}
                  aria-label={cogTitle}
                >
                  <Icon path={mdiCogOutline} size={0.65} />
                </button>
              </div>
              {(row.dependsOn?.length ?? 0) > 0 || (row.dependents?.length ?? 0) > 0 ? (
                <div className="px-3 pb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  {(row.dependsOn?.length ?? 0) > 0 && (
                    <>
                      <span className="text-[var(--text-muted)]">{i18nT("common.dependsOn", undefined, "depends on:")}</span>
                      {row.dependsOn!.map((d) => (
                        <code
                          key={`d-${d}`}
                          className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                          data-testid={`plugin-depends-on-${row.id}-${d}`}
                        >
                          {d}
                        </code>
                      ))}
                    </>
                  )}
                  {(row.dependents?.length ?? 0) > 0 && (
                    <>
                      <span className="text-[var(--text-muted)] ml-2">{i18nT("common.requiredBy", undefined, "required by:")}</span>
                      {row.dependents!.map((d) => (
                        <code
                          key={`r-${d}`}
                          className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
                          data-testid={`plugin-required-by-${row.id}-${d}`}
                        >
                          {d}
                        </code>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
              {toggleError && (
                <div className="px-3 pb-2">
                  <CopyableErrorBlock
                    text={toggleError}
                    testId={`plugin-toggle-error-${row.id}`}
                  />
                </div>
              )}
              {statusError && (
                <div className="px-3 pb-2">
                  <CopyableErrorBlock
                    text={statusError}
                    testId={`plugin-status-error-${row.id}`}
                  />
                </div>
              )}
              <div className="px-3 pb-2">
                <MissingRequirementsBlock row={row} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
