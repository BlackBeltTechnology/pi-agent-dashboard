/**
 * Browse-only resource tree primitives shared by the legacy PiResourcesView
 * and the Directory Settings "resources" page.
 *
 * Extracted verbatim from PiResourcesView so both surfaces render an identical
 * skills/extensions/prompts tree. Browse-only: clicking a leaf calls `onView`
 * (which opens the file preview). Package management lives elsewhere.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */

import type { PiPackageInfo, PiResource, PiResourceScope } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiBookOpenPageVariant, mdiChevronDown, mdiChevronRight, mdiPuzzleOutline, mdiRefresh, mdiTextBoxOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import type { ResourceActivationController } from "../hooks/useResourceActivation.js";
import { t as i18nT } from "../lib/i18n";
import type { ResourceScope } from "../lib/resources-api.js";

/**
 * Per-resource enable/disable switch, bound to `PiResource.enabled` (via the
 * activation controller's optimistic override). Flips activation only — never
 * installs/uninstalls. See change: folder-resource-activation-toggle.
 */
function ActivationToggle({ resource, enabled, onToggle }: { resource: PiResource; enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      data-testid="resource-activation-toggle"
      title={enabled ? i18nT("auto.disable", undefined, "Disable") : i18nT("auto.enable", undefined, "Enable")}
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
        {i18nT("auto.reload_n_sessions", { n: String(pending.count) }, `Reload ${pending.count} session${pending.count === 1 ? "" : "s"}`)}
      </button>
      <button
        type="button"
        onClick={activation.clearPending}
        className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        {i18nT("auto.dismiss", undefined, "Dismiss")}
      </button>
    </div>
  );
}

function ResourceIcon({ type }: { type: PiResource["type"] }) {
  const iconPath =
    type === "skill" ? mdiBookOpenPageVariant :
    type === "extension" ? mdiPuzzleOutline :
    mdiTextBoxOutline;
  return <Icon path={iconPath} size={0.5} className="shrink-0 text-[var(--text-muted)]" />;
}

function ResourceItem({ resource, onView, depth = 0, activation, scope, packageSource }: { resource: PiResource; onView: () => void; depth?: number; activation?: ResourceActivationController; scope?: ResourceScope; packageSource?: string }) {
  const enabled = activation ? activation.isEnabled(resource) : resource.enabled;
  return (
    <div
      className={`flex items-start gap-2 py-1 px-2 rounded hover:bg-[var(--bg-hover)] group cursor-pointer ${activation && !enabled ? "opacity-50" : ""}`}
      style={{ paddingLeft: `${(depth + 1) * 16}px` }}
      data-testid="resource-item"
      onClick={onView}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onView(); } }}
    >
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-[var(--text-primary)]">{resource.name}</span>
        {resource.description && (
          <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{resource.description}</p>
        )}
      </div>
      <ResourceIcon type={resource.type} />
      {activation && scope && (
        <ActivationToggle
          resource={resource}
          enabled={enabled}
          onToggle={() => activation.toggle(resource, scope, packageSource)}
        />
      )}
    </div>
  );
}

function ResourceGroup({ kind, label, resources, onView, depth = 1, activation, scope, packageSource }: { kind: PiResource["type"]; label: string; resources: PiResource[]; onView: (r: PiResource) => void; depth?: number; activation?: ResourceActivationController; scope?: ResourceScope; packageSource?: string }) {
  const [collapsed, setCollapsed] = useState(true);
  if (resources.length === 0) return null;
  // Icon derives from the stable resource type, not the localized label.
  const icon = kind === "skill" ? mdiBookOpenPageVariant : kind === "extension" ? mdiPuzzleOutline : mdiTextBoxOutline;
  return (
    <div className="mb-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full text-left py-0.5 hover:bg-[var(--bg-hover)] rounded"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.4} className="text-[var(--text-tertiary)]" />
        <Icon path={icon} size={0.45} className="text-[var(--text-tertiary)]" />
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          ({resources.length})
        </span>
      </button>
      {!collapsed && (
        <div>
          {resources.map((r) => (
            <ResourceItem key={r.filePath} resource={r} onView={() => onView(r)} depth={depth} activation={activation} scope={scope} packageSource={packageSource} />
          ))}
        </div>
      )}
    </div>
  );
}

function PackageItem({ pkg, onView, activation, scope }: { pkg: PiPackageInfo; onView: (r: PiResource) => void; activation?: ResourceActivationController; scope?: ResourceScope }) {
  const [collapsed, setCollapsed] = useState(true);
  const hasResources =
    pkg.resources.extensions.length > 0 ||
    pkg.resources.skills.length > 0 ||
    pkg.resources.prompts.length > 0;
  const count = pkg.resources.extensions.length + pkg.resources.skills.length + pkg.resources.prompts.length;
  return (
    <div className="mb-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full text-left hover:bg-[var(--bg-hover)] rounded py-0.5"
        style={{ paddingLeft: "16px" }}
      >
        <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.4} className="text-[var(--text-tertiary)]" />
        <span className="text-xs font-medium text-[var(--text-primary)]">📦 {pkg.name}</span>
        <span className="text-[10px] text-[var(--text-muted)]">
          ({count})
        </span>
      </button>
      {!collapsed && (
        <>
          {pkg.description && (
            <p className="text-[10px] text-[var(--text-muted)] mb-1" style={{ paddingLeft: "40px" }}>{pkg.description}</p>
          )}
          {hasResources ? (
            <>
              <ResourceGroup kind="skill" label={i18nT("auto.skills", undefined, "Skills")} resources={pkg.resources.skills} onView={onView} depth={2} activation={activation} scope={scope} packageSource={pkg.source} />
              <ResourceGroup kind="extension" label={i18nT("auto.extensions", undefined, "Extensions")} resources={pkg.resources.extensions} onView={onView} depth={2} activation={activation} scope={scope} packageSource={pkg.source} />
              <ResourceGroup kind="prompt" label={i18nT("auto.prompts", undefined, "Prompts")} resources={pkg.resources.prompts} onView={onView} depth={2} activation={activation} scope={scope} packageSource={pkg.source} />
            </>
          ) : (
            <p className="text-[10px] text-[var(--text-muted)] italic" style={{ paddingLeft: "40px" }}>{i18nT("auto.no_resources", undefined, "(no resources)")}</p>
          )}
        </>
      )}
    </div>
  );
}

export function MergedScopeSection({ title, scope, packages, onView, activation, activationScope }: {
  title: string;
  scope: PiResourceScope;
  packages: PiPackageInfo[];
  onView: (r: PiResource) => void;
  activation?: ResourceActivationController;
  /** Which pi scope this section writes to when a row is toggled. */
  activationScope?: ResourceScope;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const looseCount = scope.extensions.length + scope.skills.length + scope.prompts.length;
  // Browse-only: skip packages that contribute zero resources. They're not
  // useful here — manage them in the Packages tab. See change:
  // unify-workspace-package-management.
  const contributingPackages = packages.filter(
    (p) => p.resources.extensions.length + p.resources.skills.length + p.resources.prompts.length > 0,
  );
  const pkgResourceCount = contributingPackages.reduce((sum, p) =>
    sum + p.resources.extensions.length + p.resources.skills.length + p.resources.prompts.length, 0);
  const totalCount = looseCount + pkgResourceCount;
  const hasLoose = looseCount > 0;
  const hasPkgs = contributingPackages.length > 0;
  const isEmpty = !hasLoose && !hasPkgs;

  return (
    <div className="mb-4" data-testid={`scope-${title.toLowerCase()}`}>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1 w-full text-left px-2 pb-1 mb-1 border-b border-[var(--border-secondary)] hover:bg-[var(--bg-hover)] rounded-t"
      >
        <Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.5} className="text-[var(--text-tertiary)]" />
        <h3 className="text-xs font-bold text-[var(--text-secondary)] uppercase tracking-wider">
          {title}
        </h3>
        <span className="text-[10px] text-[var(--text-muted)] ml-1">
          ({totalCount})
        </span>
      </button>
      {!collapsed && (
        isEmpty ? (
          <p className="text-[11px] text-[var(--text-muted)] pl-6 italic">(none)</p>
        ) : (
          <>
            {hasLoose && (
              <>
                <ResourceGroup kind="skill" label={i18nT("auto.skills", undefined, "Skills")} resources={scope.skills} onView={onView} depth={1} activation={activation} scope={activationScope} />
                <ResourceGroup kind="extension" label={i18nT("auto.extensions", undefined, "Extensions")} resources={scope.extensions} onView={onView} depth={1} activation={activation} scope={activationScope} />
                <ResourceGroup kind="prompt" label={i18nT("auto.prompts", undefined, "Prompts")} resources={scope.prompts} onView={onView} depth={1} activation={activation} scope={activationScope} />
              </>
            )}
            {contributingPackages.map((pkg) => (
              <PackageItem key={pkg.source} pkg={pkg} onView={onView} activation={activation} scope={activationScope} />
            ))}
          </>
        )
      )}
    </div>
  );
}
