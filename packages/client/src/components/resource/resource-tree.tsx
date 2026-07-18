/**
 * Reusable activation primitives for the resource browse surface.
 *
 * Formerly this module also exported a nested `MergedScopeSection` tree
 * (`ResourceItem`/`ResourceGroup`/`PackageItem`); that tree was retired when
 * both surfaces moved to the flat `ResourceCard` grid. The two primitives the
 * card reuses live on here:
 *   - `ActivationToggle`    — the per-resource enable/disable switch.
 *   - `ResourceReloadBanner` — the one-click "Reload N sessions" banner.
 *
 * See change: folder-resource-activation-toggle, resources-card-tabs.
 */

import type { PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ResourceActivationController } from "../../hooks/useResourceActivation.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Per-resource enable/disable switch, bound to `PiResource.enabled` (via the
 * activation controller's optimistic override). Flips activation only — never
 * installs/uninstalls. See change: folder-resource-activation-toggle.
 */
export function ActivationToggle({ resource, enabled, onToggle }: { resource: PiResource; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      data-testid="resource-activation-toggle"
      title={enabled ? i18nT("common.disable", undefined, "Disable") : i18nT("common.enable2", undefined, "Enable")}
      aria-label={`${enabled ? "Disable" : "Enable"} ${resource.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        // Keep Enter/Space on the switch from bubbling to the row's
        // onKeyDown (which opens the file view). The native button still
        // fires onClick for these keys.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
      className={`shrink-0 relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors ${
        enabled ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-hover)]"
      }`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
          enabled ? "translate-x-2.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** One-click "Reload N sessions" banner shown after a toggle. Hidden when N=0. */
export function ResourceReloadBanner({ activation }: { activation: ResourceActivationController }) {
  const pending = activation.pending;
  if (!pending || pending.count <= 0) return null;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 mb-2 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)]" data-testid="resource-reload-banner">
      <button
        type="button"
        onClick={activation.reload}
        data-testid="resource-reload-button"
        className="flex items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
      >
        <Icon path={mdiRefresh} size={0.5} />
        {i18nT("session.reloadNSessions", { n: String(pending.count) }, `Reload ${pending.count} session${pending.count === 1 ? "" : "s"}`)}
      </button>
      <button
        type="button"
        onClick={activation.clearPending}
        className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        {i18nT("common.dismiss", undefined, "Dismiss")}
      </button>
    </div>
  );
}
