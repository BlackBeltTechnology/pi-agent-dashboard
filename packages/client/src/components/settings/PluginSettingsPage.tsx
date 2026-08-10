/**
 * Settings ▸ Plugins ▸ <plugin> — one addressable page per plugin.
 *
 * The host owns the chrome unconditionally: identity, status pill, enable
 * toggle, metadata chips, error and missing-requirement banners. The plugin
 * supplies only the body, through `SettingsSectionByPluginSlot`. There is no
 * opt-out prop — a plugin component that renders `null` still yields a full
 * header (design D1).
 *
 * A disabled plugin renders chrome + a disabled notice + a re-enable
 * affordance, and NO body: the slot registry's enabled-set filter drops its
 * claims and the consumer drops its intents, so its React component is never
 * mounted (design D6).
 *
 * Chrome shows only fields `GET /api/plugins` actually returns — `PluginRow`
 * carries no `version`, `description`, `source`, or `icon`, so none are
 * rendered (design D1).
 *
 * See change: plugin-settings-pages.
 */

import {
  PluginSettingsPageProvider,
  SettingsSectionByPluginSlot,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiPackageVariantClosed, mdiRestart } from "@mdi/js";
import Icon from "@mdi/react";
import type { PluginToggle } from "../../hooks/usePluginToggle.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import {
  CopyableErrorBlock,
  MissingRequirementsBlock,
  StatusPill,
  WARN_BG,
  WARN_BORDER,
  WARN_FG,
} from "../packages/plugin-row-parts.js";

/**
 * Shown in place of a plugin page when the id in the URL names no installed
 * plugin, or an installed plugin with no `settings-section` contribution.
 * Rendered above the activation index by `SettingsPanel` (design D2).
 */
export function PluginNotFoundNotice({ pluginId }: { pluginId: string }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded ${WARN_BG} border ${WARN_BORDER} ${WARN_FG} text-sm`}
      data-testid="plugin-not-found-notice"
    >
      {i18nT("packages.noSettingsPageFor", undefined, "No settings page for")}{" "}
      <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]">{pluginId}</code>
    </div>
  );
}

function Chip({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px]" data-testid={testId}>
      <span className="text-[var(--text-muted)]">{label}</span>
      <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]">
        {value}
      </code>
    </span>
  );
}

export function PluginSettingsPage({
  row,
  toggle,
  onLeaveGuard,
  onNavigate,
}: {
  row: PluginRow;
  toggle: PluginToggle;
  /**
   * Called before the plugin is disabled from this page. Resolves `true` when
   * the toggle may proceed. Lets the host resolve unsaved edits BEFORE the rail
   * drops the nav child (design Open Question 3).
   */
  onLeaveGuard?: () => Promise<boolean>;
  /**
   * Leave this page. MUST route through the host's guarded navigation, not a
   * raw `navigate` — plugin draft state dies on unmount, so an unguarded exit
   * discards unsaved edits silently (design D5a).
   */
  onNavigate: (to: string) => void;
}) {
  const isEnabled = row.status?.enabled !== false;
  const statusError = row.status?.error;
  const toggleError = toggle.toggleErrorFor(row.id);
  const slotIds = Array.from(new Set(row.claims.map((c) => c.slot))).sort();

  async function requestToggle(next: boolean) {
    if (!next && onLeaveGuard && !(await onLeaveGuard())) return;
    await toggle.handleToggle(row, next);
  }

  return (
    <div className="space-y-4" data-testid={`plugin-settings-page-${row.id}`}>
      {/* The toggle above can require a dependency cascade; without this mount
          the confirm never appears and the toggle silently no-ops, because the
          activation index (which also renders it) is not on this route. */}
      {toggle.cascadeDialog}

      {/* ── Host chrome (constructed unconditionally) ── */}
      <div
        className="border border-[var(--border-secondary)] rounded bg-[var(--bg-secondary)]"
        data-testid="plugin-page-chrome"
      >
        <div className="flex items-center gap-2 px-3 py-2.5">
          <Icon path={mdiPackageVariantClosed} size={0.8} className="text-[var(--text-muted)]" />
          <div className="flex-1 min-w-0">
            <h2
              className="text-base font-semibold text-[var(--text-primary)] truncate"
              data-testid="plugin-page-title"
            >
              {row.displayName}
            </h2>
            <div className="text-[10px] text-[var(--text-muted)] truncate">{row.id}</div>
          </div>
          <StatusPill row={row} />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              disabled={toggle.isToggling(row.id)}
              onChange={(e) => requestToggle(e.target.checked)}
              data-testid={`plugin-page-toggle-${row.id}`}
              className="accent-blue-500"
            />
            <span className="text-[10px] text-[var(--text-secondary)]">enable</span>
          </label>
        </div>

        <div className="px-3 pb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {(row.dependsOn?.length ?? 0) > 0 && (
            <Chip
              label={i18nT("common.dependsOn", undefined, "depends on:")}
              value={row.dependsOn!.join(", ")}
              testId="plugin-page-depends-on"
            />
          )}
          {slotIds.length > 0 && (
            <Chip
              label={i18nT("packages.claimsSlots", undefined, "claims:")}
              value={slotIds.join(", ")}
              testId="plugin-page-slots"
            />
          )}
        </div>

        {toggleError && (
          <div className="px-3 pb-2.5">
            <CopyableErrorBlock text={toggleError} testId={`plugin-toggle-error-${row.id}`} />
          </div>
        )}
        {statusError && (
          <div className="px-3 pb-2.5">
            <CopyableErrorBlock text={statusError} testId={`plugin-status-error-${row.id}`} />
          </div>
        )}
        <div className="px-3 pb-2.5">
          <MissingRequirementsBlock row={row} />
        </div>
      </div>

      {/* Enable-state is desired state; the slot registry's enabled set follows
          the SERVER's runtime snapshot, which only catches up on restart. So a
          just-enabled plugin renders chrome with an empty body until then — say
          so, rather than leaving the user staring at nothing. */}
      {toggle.restartRequired && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded ${WARN_BG} border ${WARN_BORDER} ${WARN_FG} text-sm`}
          data-testid="plugin-page-restart-required"
        >
          <Icon path={mdiRestart} size={0.6} />
          <span className="flex-1">
            {i18nT(
              "packages.pluginChangesTakeEffectAfterA",
              undefined,
              "Plugin changes take effect after a server restart.",
            )}
          </span>
          <button
            type="button"
            onClick={toggle.handleRestart}
            disabled={toggle.restarting}
            className={`px-2 py-1 rounded text-xs ${WARN_BG} hover:opacity-80 ${WARN_FG} border ${WARN_BORDER} disabled:opacity-50`}
            data-testid="plugin-page-restart-now-btn"
          >
            {toggle.restarting ? "Restarting…" : "Restart now"}
          </button>
        </div>
      )}

      {/* ── Plugin body, or the disabled notice that replaces it ── */}
      {isEnabled ? (
        <PluginSettingsPageProvider pluginId={row.id}>
          <SettingsSectionByPluginSlot pluginId={row.id} />
        </PluginSettingsPageProvider>
      ) : (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded ${WARN_BG} border ${WARN_BORDER} ${WARN_FG} text-sm`}
          data-testid="plugin-page-disabled-notice"
        >
          <span className="flex-1">
            {i18nT(
              "packages.pluginDisabledNoSettings",
              undefined,
              "This plugin is disabled. Its settings are not available until you enable it.",
            )}
          </span>
          <button
            type="button"
            onClick={() => requestToggle(true)}
            disabled={toggle.isToggling(row.id)}
            className={`px-2 py-1 rounded text-xs ${WARN_BG} hover:opacity-80 ${WARN_FG} border ${WARN_BORDER} disabled:opacity-50`}
            data-testid="plugin-page-reenable-btn"
          >
            {i18nT("common.enable", undefined, "Enable")}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => onNavigate("/settings/plugins")}
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        data-testid="plugin-page-back-to-index"
      >
        ← {i18nT("settings.plugins", undefined, "Plugins")}
      </button>
    </div>
  );
}
