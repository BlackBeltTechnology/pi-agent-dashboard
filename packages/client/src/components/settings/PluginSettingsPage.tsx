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
 * A PROMOTED page (see `resolveSettingsPromotions`) gets a COMPACT host chrome
 * instead: `nav.label` title, `nav.description` lede, a "Provided by the <X>
 * plugin" provenance line carrying the toggle, a header pill ONLY when not
 * healthy, and id / dependsOn / dependents / slots behind a `<details>`
 * disclosure. Still host-owned — the plugin cannot opt out (design D5).
 *
 * Wave 2 (retro-ux-plugin-settings-wave-2, design D5): breadcrumb back link
 * above the card, `role="switch"` "Enabled" control, status pill ONLY when
 * unhealthy (words: Off / Not loaded / Failed to load / Needs setup / Status
 * unknown), `SettingsNotice` severity banners, `grid gap-3` body wrapper, and
 * slot claims shown only behind the per-browser "Show plugin internals"
 * Developer preference.
 *
 * See change: plugin-settings-pages, promote-model-roles-settings,
 * retro-ux-plugin-settings-wave-2.
 */

import {
  PluginSettingsPageProvider,
  SettingsFacts,
  SettingsNotice,
  SettingsSectionByPluginSlot,
  SettingsStatusPill,
  ToggleField,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiPackageVariantClosed } from "@mdi/js";
import Icon from "@mdi/react";
import type { PluginToggle } from "../../hooks/usePluginToggle.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import type { SettingsPromotion } from "../../lib/settings-promotions.js";
import { useShowPluginInternals } from "../../lib/state/plugin-internals-pref.js";
import { CopyableErrorBlock, MissingRequirementsBlock } from "../packages/plugin-row-parts.js";

/** Small secondary button recipe for notice actions (`ui-contract.md`). */
const NOTICE_BTN =
  "focus-ring inline-flex min-h-[32px] items-center rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Shown in place of a plugin page when the id in the URL names no installed
 * plugin, or an installed plugin with no `settings-section` contribution.
 * Rendered above the activation index by `SettingsPanel` (design D2).
 */
export function PluginNotFoundNotice({ pluginId }: { pluginId: string }) {
  return (
    <SettingsNotice tone="warning" testId="plugin-not-found-notice">
      {i18nT("packages.noSettingsPageFor", undefined, "No settings page for")}{" "}
      <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-primary)]">{pluginId}</code>
    </SettingsNotice>
  );
}

/** Unicode control (Cc) + format (Cf) characters: stripped from displayName at render. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/gu;

/**
 * Header pill: rendered only when the plugin is NOT healthy (a healthy, enabled,
 * loaded plugin with every requirement met shows none). Explicit health check —
 * the activation-index `StatusPill` alone reads "enabled" despite unmet
 * requirements. Precedence: unknown → error → off → not loaded → needs setup.
 * See change: promote-model-roles-settings (design D5), retro-ux-plugin-settings-wave-2 (A3).
 */
function PluginHealthPill({ row }: { row: PluginRow }) {
  const st = row.status;
  let pill: { tone: "neutral" | "warning" | "error"; word: string } | null = null;
  if (!st) pill = { tone: "neutral", word: i18nT("packages.pillStatusUnknown", undefined, "Status unknown") };
  else if (st.error) pill = { tone: "error", word: i18nT("packages.pillFailedToLoad", undefined, "Failed to load") };
  else if (!st.enabled) pill = { tone: "neutral", word: i18nT("packages.pillOff", undefined, "Off") };
  else if (!st.loaded) pill = { tone: "warning", word: i18nT("packages.pillNotLoaded", undefined, "Not loaded") };
  else if ((st.missingRequirements?.length ?? 0) > 0) {
    pill = { tone: "warning", word: i18nT("packages.pillNeedsSetup", undefined, "Needs setup") };
  }
  if (!pill) return null;
  return (
    <span data-testid="plugin-page-pill">
      <SettingsStatusPill tone={pill.tone}>{pill.word}</SettingsStatusPill>
    </span>
  );
}

function Chip({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px]" data-testid={testId}>
      <span className="text-[var(--text-secondary)]">{label}</span>
      <code className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]">
        {value}
      </code>
    </span>
  );
}

/** "Needs …" / "Used by …" dependency chips, shown whenever the plugin declares any. */
function DependencyChips({ row }: { row: PluginRow }) {
  return (
    <>
      {(row.dependsOn?.length ?? 0) > 0 && (
        <Chip
          label={i18nT("packages.pluginNeeds", undefined, "Needs")}
          value={row.dependsOn!.join(", ")}
          testId="plugin-page-depends-on"
        />
      )}
      {(row.dependents?.length ?? 0) > 0 && (
        <Chip
          label={i18nT("packages.pluginUsedBy", undefined, "Used by")}
          value={row.dependents!.join(", ")}
          testId="plugin-page-dependents"
        />
      )}
    </>
  );
}

/** Developer-only disclosure: plugin id + contributed slots (full chrome, A1). */
function PluginInternalsDisclosure({ row, slotIds }: { row: PluginRow; slotIds: string[] }) {
  return (
    <details data-testid="plugin-page-internals" className="px-3 pb-2.5 text-[12px]">
      <summary className="cursor-pointer py-1 font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        {i18nT("packages.pluginInternals", undefined, "Plugin internals")}
      </summary>
      <div className="pt-1.5">
        <SettingsFacts
          rows={[
            [
              i18nT("packages.pluginInternalsId", undefined, "Plugin id"),
              <code key="id" className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]">
                {row.id}
              </code>,
            ],
            [
              i18nT("packages.pluginInternalsContributes", undefined, "Contributes"),
              <span key="slots" className="flex flex-wrap gap-1" data-testid="plugin-page-slots">
                {slotIds.map((slot) => (
                  <code key={slot} className="px-1 py-0.5 rounded bg-[var(--bg-tertiary)]">
                    {slot}
                  </code>
                ))}
              </span>,
            ],
          ]}
        />
      </div>
    </details>
  );
}

/** Error / load-failure / missing-requirement banners inside the chrome card. */
function ChromeBanners({ row, toggleError }: { row: PluginRow; toggleError: string | undefined }) {
  const statusError = row.status?.error;
  const hasMissing = (row.status?.missingRequirements?.length ?? 0) > 0;
  return (
    <>
    {toggleError && (
      <div className="px-3 pb-2.5">
        <CopyableErrorBlock text={toggleError} testId={`plugin-toggle-error-${row.id}`} />
      </div>
    )}
    {statusError && (
      <div className="px-3 pb-2.5">
        {/* A load error is diagnostic output: one sentence + the full copyable text. */}
        <SettingsNotice tone="error" testId={`plugin-page-load-error-${row.id}`}>
          <p className="font-semibold">
            {i18nT("packages.pluginFailedToLoad", undefined, "This plugin failed to load.")}
          </p>
          <div className="mt-1.5">
            <CopyableErrorBlock text={statusError} testId={`plugin-status-error-${row.id}`} />
          </div>
        </SettingsNotice>
      </div>
    )}
    {hasMissing && (
      <div className="px-3 pb-2.5">
        <SettingsNotice tone="warning" testId="plugin-page-missing-requirements">
          <p className="mb-1.5 font-semibold">
            {i18nT("packages.pluginNeedsSetup", undefined, "This plugin needs setup before it can work.")}
          </p>
          <MissingRequirementsBlock row={row} inNotice />
        </SettingsNotice>
      </div>
    )}
    </>
  );
}

export function PluginSettingsPage({
  row,
  toggle,
  onLeaveGuard,
  onNavigate,
  promotion,
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
  /**
   * Honoured nav promotion for this plugin, when any. Selects the compact
   * host chrome variant. See change: promote-model-roles-settings.
   */
  promotion?: SettingsPromotion;
}) {
  const [showInternals] = useShowPluginInternals();
  const isEnabled = row.status?.enabled !== false;
  const toggleError = toggle.toggleErrorFor(row.id);
  const slotIds = Array.from(new Set(row.claims.map((c) => c.slot))).sort();
  const showSlots = showInternals && slotIds.length > 0;

  async function requestToggle(next: boolean) {
    if (!next && onLeaveGuard && !(await onLeaveGuard())) return;
    await toggle.handleToggle(row, next);
  }

  const enabledSwitch = (
    <ToggleField
      label={i18nT("packages.pluginEnabledLabel", undefined, "Enabled")}
      hint={null}
      value={isEnabled}
      disabled={toggle.isToggling(row.id)}
      onChange={(next) => requestToggle(next)}
      testIds={{ control: `plugin-page-toggle-${row.id}` }}
    />
  );

  return (
    <div className="space-y-4" data-testid={`plugin-settings-page-${row.id}`}>
      {/* The toggle above can require a dependency cascade; without this mount
          the confirm never appears and the toggle silently no-ops, because the
          activation index (which also renders it) is not on this route. */}
      {toggle.cascadeDialog}

      <div className="space-y-1">
        {/* Breadcrumb above the card (A2). Routes through the guarded navigate. */}
        <button
          type="button"
          onClick={() => onNavigate("/settings/plugins")}
          className="tap-target focus-ring inline-flex items-center rounded text-[12px] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          data-testid="plugin-page-back-to-index"
        >
          ← {i18nT("settings.plugins", undefined, "Plugins")}
        </button>

        {/* ── Host chrome (constructed unconditionally) ── */}
        <div
          className="border border-[var(--border-secondary)] rounded-xl bg-[var(--bg-secondary)]"
          data-testid="plugin-page-chrome"
        >
          {promotion ? (
            <div className="px-3 py-2.5 space-y-1.5" data-testid="plugin-page-compact-header">
              <div className="flex items-center gap-2">
                <h2
                  className="flex-1 min-w-0 text-lg font-semibold text-[var(--text-primary)] truncate"
                  data-testid="plugin-page-title"
                >
                  {promotion.label}
                </h2>
                <PluginHealthPill row={row} />
              </div>
              {promotion.description && (
                <p className="text-xs text-[var(--text-secondary)]" data-testid="plugin-page-lede">
                  {promotion.description}
                </p>
              )}
              <div
                className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]"
                data-testid="plugin-page-provenance"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Icon path={mdiPackageVariantClosed} size={0.55} />
                  <span className="min-w-0 truncate">
                    {i18nT(
                      "packages.providedByPlugin",
                      { name: row.displayName.replace(CONTROL_OR_FORMAT, "") },
                      "Provided by the {name} plugin",
                    )}
                  </span>
                </span>
                {enabledSwitch}
              </div>
              <details data-testid="plugin-page-details" className="text-[11px]">
                <summary className="cursor-pointer py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  {i18nT("packages.pluginDetails", undefined, "Plugin details")}
                </summary>
                <div className="pt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Chip label={i18nT("packages.pluginIdLabel", undefined, "id:")} value={row.id} testId="plugin-page-id" />
                  <DependencyChips row={row} />
                  {showSlots && (
                    <Chip
                      label={i18nT("packages.claimsSlots", undefined, "claims:")}
                      value={slotIds.join(", ")}
                      testId="plugin-page-slots"
                    />
                  )}
                </div>
              </details>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2.5">
                <Icon path={mdiPackageVariantClosed} size={0.8} className="text-[var(--text-secondary)]" />
                <div className="flex-1 min-w-0">
                  <h2
                    className="text-lg font-semibold text-[var(--text-primary)] truncate"
                    data-testid="plugin-page-title"
                  >
                    {row.displayName}
                  </h2>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate" data-testid="plugin-page-id">
                    {row.id}
                  </div>
                </div>
                <PluginHealthPill row={row} />
                {enabledSwitch}
              </div>

              {((row.dependsOn?.length ?? 0) > 0 || (row.dependents?.length ?? 0) > 0) && (
                <div className="px-3 pb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <DependencyChips row={row} />
                </div>
              )}
            </>
          )}

          <ChromeBanners row={row} toggleError={toggleError} />

          {/* Developer-only: slot claims behind the per-browser "Show plugin
              internals" preference (A1). Compact chrome lists them in "Plugin details". */}
          {!promotion && showSlots && <PluginInternalsDisclosure row={row} slotIds={slotIds} />}
        </div>
      </div>

      {/* Enable-state is desired state; the slot registry's enabled set follows
          the SERVER's runtime snapshot, which only catches up on restart. So a
          just-enabled plugin renders chrome with an empty body until then — say
          so, rather than leaving the user staring at nothing. */}
      {toggle.restartRequired && (
        <SettingsNotice
          tone="warning"
          testId="plugin-page-restart-required"
          actions={
            <button
              type="button"
              onClick={toggle.handleRestart}
              disabled={toggle.restarting}
              className={NOTICE_BTN}
              data-testid="plugin-page-restart-now-btn"
            >
              {toggle.restarting ? "Restarting…" : "Restart now"}
            </button>
          }
        >
          {i18nT(
            "packages.pluginChangesTakeEffectAfterA",
            undefined,
            "Plugin changes take effect after a server restart.",
          )}
        </SettingsNotice>
      )}

      {/* ── Plugin body, or the disabled notice that replaces it ── */}
      {isEnabled ? (
        <div className="grid grid-cols-1 gap-3" data-testid={`plugin-page-body-${row.id}`}>
          <PluginSettingsPageProvider pluginId={row.id}>
            <SettingsSectionByPluginSlot pluginId={row.id} />
          </PluginSettingsPageProvider>
        </div>
      ) : (
        <SettingsNotice
          tone="info"
          testId="plugin-page-disabled-notice"
          actions={
            <button
              type="button"
              onClick={() => requestToggle(true)}
              disabled={toggle.isToggling(row.id)}
              className={NOTICE_BTN}
              data-testid="plugin-page-reenable-btn"
            >
              {i18nT("common.enable", undefined, "Enable")}
            </button>
          }
        >
          {i18nT(
            "packages.pluginDisabledNoSettings",
            undefined,
            "This plugin is disabled. Its settings are not available until you enable it.",
          )}
        </SettingsNotice>
      )}
    </div>
  );
}
