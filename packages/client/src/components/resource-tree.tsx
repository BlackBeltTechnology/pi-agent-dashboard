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
import { mdiBookOpenPageVariant, mdiChevronDown, mdiChevronRight, mdiPuzzleOutline, mdiTextBoxOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { t as i18nT } from "../lib/i18n";

function ResourceIcon({ type }: { type: PiResource["type"] }) {
  const iconPath =
    type === "skill" ? mdiBookOpenPageVariant :
    type === "extension" ? mdiPuzzleOutline :
    mdiTextBoxOutline;
  return <Icon path={iconPath} size={0.5} className="shrink-0 text-[var(--text-muted)]" />;
}

function ResourceItem({ resource, onView, depth = 0 }: { resource: PiResource; onView: () => void; depth?: number }) {
  return (
    <div
      className="flex items-start gap-2 py-1 px-2 rounded hover:bg-[var(--bg-hover)] group cursor-pointer"
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
    </div>
  );
}

function ResourceGroup({ kind, label, resources, onView, depth = 1 }: { kind: PiResource["type"]; label: string; resources: PiResource[]; onView: (r: PiResource) => void; depth?: number }) {
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
            <ResourceItem key={r.filePath} resource={r} onView={() => onView(r)} depth={depth} />
          ))}
        </div>
      )}
    </div>
  );
}

function PackageItem({ pkg, onView }: { pkg: PiPackageInfo; onView: (r: PiResource) => void }) {
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
              <ResourceGroup kind="skill" label={i18nT("auto.skills", undefined, "Skills")} resources={pkg.resources.skills} onView={onView} depth={2} />
              <ResourceGroup kind="extension" label={i18nT("auto.extensions", undefined, "Extensions")} resources={pkg.resources.extensions} onView={onView} depth={2} />
              <ResourceGroup kind="prompt" label={i18nT("auto.prompts", undefined, "Prompts")} resources={pkg.resources.prompts} onView={onView} depth={2} />
            </>
          ) : (
            <p className="text-[10px] text-[var(--text-muted)] italic" style={{ paddingLeft: "40px" }}>{i18nT("auto.no_resources", undefined, "(no resources)")}</p>
          )}
        </>
      )}
    </div>
  );
}

export function MergedScopeSection({ title, scope, packages, onView }: {
  title: string;
  scope: PiResourceScope;
  packages: PiPackageInfo[];
  onView: (r: PiResource) => void;
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
                <ResourceGroup kind="skill" label={i18nT("auto.skills", undefined, "Skills")} resources={scope.skills} onView={onView} depth={1} />
                <ResourceGroup kind="extension" label={i18nT("auto.extensions", undefined, "Extensions")} resources={scope.extensions} onView={onView} depth={1} />
                <ResourceGroup kind="prompt" label={i18nT("auto.prompts", undefined, "Prompts")} resources={scope.prompts} onView={onView} depth={1} />
              </>
            )}
            {contributingPackages.map((pkg) => (
              <PackageItem key={pkg.source} pkg={pkg} onView={onView} />
            ))}
          </>
        )
      )}
    </div>
  );
}
