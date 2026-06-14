import React, { useState, useMemo } from "react";
import { Icon } from "@mdi/react";
import { mdiArrowLeft, mdiLoading, mdiRefresh, mdiPuzzleOutline, mdiBookOpenPageVariant, mdiTextBoxOutline, mdiChevronRight, mdiChevronDown } from "@mdi/js";
import { usePiResources } from "../hooks/usePiResources.js";
import { PackageBrowser } from "./PackageBrowser.js";
import { PackageInstallConfirmDialog } from "./PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";
import { useInstalledPackages } from "../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../hooks/usePackageOperations.js";
import { InstalledPackagesList } from "./InstalledPackagesList.js";
import type { PiResource, PiResourceScope, PiPackageInfo, NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
  cwd: string;
  onBack: () => void;
  onViewFile: (filePath: string, title: string) => void;
}

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

function ResourceGroup({ label, resources, onView, depth = 1 }: { label: string; resources: PiResource[]; onView: (r: PiResource) => void; depth?: number }) {
  const [collapsed, setCollapsed] = useState(true);
  if (resources.length === 0) return null;
  const icon = label === "Skills" ? mdiBookOpenPageVariant : label === "Extensions" ? mdiPuzzleOutline : mdiTextBoxOutline;
  return (
    <div className="mb-1">
      <button
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

function MergedScopeSection({ title, scope, packages, onView }: {
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
                <ResourceGroup label={i18nT("auto.skills", undefined, "Skills")} resources={scope.skills} onView={onView} depth={1} />
                <ResourceGroup label={i18nT("auto.extensions", undefined, "Extensions")} resources={scope.extensions} onView={onView} depth={1} />
                <ResourceGroup label={i18nT("auto.prompts", undefined, "Prompts")} resources={scope.prompts} onView={onView} depth={1} />
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
              <ResourceGroup label={i18nT("auto.skills", undefined, "Skills")} resources={pkg.resources.skills} onView={onView} depth={2} />
              <ResourceGroup label={i18nT("auto.extensions", undefined, "Extensions")} resources={pkg.resources.extensions} onView={onView} depth={2} />
              <ResourceGroup label={i18nT("auto.prompts", undefined, "Prompts")} resources={pkg.resources.prompts} onView={onView} depth={2} />
            </>
          ) : (
            <p className="text-[10px] text-[var(--text-muted)] italic" style={{ paddingLeft: "40px" }}>{i18nT("auto.no_resources", undefined, "(no resources)")}</p>
          )}
        </>
      )}
    </div>
  );
}

export function PiResourcesView({ cwd, onBack, onViewFile }: Props) {
  const [activeTab, setActiveTab] = useState<"installed" | "packages">("installed");
  const { data, isLoading, error, refresh } = usePiResources(cwd);
  const installed = useInstalledPackages("local", cwd);
  const installedGlobal = useInstalledPackages("global");
  const operations = usePackageOperations("local", cwd, installed.refresh);
  const [confirmInstall, setConfirmInstall] = useState<{ source: string; pkg?: NpmPackageResult; scope: "global" | "local" } | null>(null);
  const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);

  // Build maps from package source string → contained-resources data, sliced
  // by scope. The Pi Resources fetch already includes this; we just project
  // it for InstalledPackagesList's expand-tree.
  const localContainedMap = useMemo(() => {
    const m = new Map<string, PiPackageInfo>();
    for (const p of data?.packages ?? []) {
      if (p.scope === "local" || !p.scope) m.set(p.source, p);
    }
    return m;
  }, [data]);
  const globalContainedMap = useMemo(() => {
    const m = new Map<string, PiPackageInfo>();
    for (const p of data?.packages ?? []) {
      if (p.scope === "global") m.set(p.source, p);
    }
    return m;
  }, [data]);

  const handleView = (resource: PiResource) => {
    onViewFile(resource.filePath, resource.name);
  };

  const handleConfirmInstall = (source: string, pkg?: NpmPackageResult) => {
    // Default Pi Resources installs to LOCAL scope (matches the surface),
    // but the dialog exposes a radio so the user can choose.
    setConfirmInstall({ source, pkg, scope: "local" });
  };

  const doInstall = () => {
    if (!confirmInstall) return;
    operations.install(confirmInstall.source, confirmInstall.scope);
    setConfirmInstall(null);
  };

  const dirName = cwd.split("/").pop() ?? cwd;

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="pi-resources-view">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-secondary)]">
        <button
          onClick={onBack}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
          data-testid="pi-resources-back"
          title={i18nT("auto.back", undefined, "Back")}
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <span className="text-sm font-medium text-[var(--text-secondary)] truncate">
          {i18nT("auto.pi_resources_2", undefined, "Pi Resources:")} {dirName}
        </span>
        <button
          onClick={refresh}
          className="ml-auto text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
          title={i18nT("auto.refresh", undefined, "Refresh")}
          data-testid="pi-resources-refresh"
        >
          <Icon path={mdiRefresh} size={0.6} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[var(--border-secondary)] px-4" data-testid="resources-tab-bar">
        {(["installed", "packages"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors relative ${
              activeTab === tab
                ? "text-[var(--text-primary)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >
            {tab === "installed" ? "Resources" : "Packages"}
            {activeTab === tab && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-primary)]" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        {activeTab === "installed" && (
          <>
            {isLoading && !data && (
              <div className="flex items-center justify-center py-8">
                <Icon path={mdiLoading} size={1} className="text-[var(--text-muted)] animate-spin" />
              </div>
            )}

            {error && !data && (
              <div className="text-center py-8">
                <p className="text-sm text-red-400 mb-2">{error}</p>
                <button onClick={refresh} className="text-xs text-[var(--accent-primary)] hover:underline">
                  {i18nT("auto.retry", undefined, "Retry")}
                </button>
              </div>
            )}

            {data && (
              <>
                <MergedScopeSection
                  title={i18nT("auto.local", undefined, "Local")}
                  scope={data.local}
                  packages={data.packages.filter((p) => p.scope === "local" || !p.scope)}
                  onView={handleView}
                />
                <div className="mb-4" data-testid="installed-packages-local-section">
                  <h4 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide px-2 mb-1">
                    {i18nT("auto.local_packages", undefined, "Local Packages")}
                  </h4>
                  <InstalledPackagesList
                    scope="local"
                    cwd={cwd}
                    containedResources={localContainedMap}
                    otherScopePackages={installedGlobal.packages}
                    onViewReadme={setReadmePkg}
                    onViewResource={handleView}
                    testId="installed-packages-local"
                  />
                </div>
                <MergedScopeSection
                  title={i18nT("auto.global", undefined, "Global")}
                  scope={data.global}
                  packages={data.packages.filter((p) => p.scope === "global")}
                  onView={handleView}
                />
                <div className="mb-4" data-testid="installed-packages-global-section">
                  <h4 className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wide px-2 mb-1">
                    {i18nT("auto.global_packages", undefined, "Global Packages")}
                  </h4>
                  <InstalledPackagesList
                    scope="global"
                    containedResources={globalContainedMap}
                    otherScopePackages={installed.packages}
                    onViewReadme={setReadmePkg}
                    onViewResource={handleView}
                    testId="installed-packages-global"
                  />
                </div>
              </>
            )}
          </>
        )}

        {activeTab === "packages" && (
          <PackageBrowser
            scope="local"
            cwd={cwd}
            onViewReadme={setReadmePkg}
            onConfirmInstall={handleConfirmInstall}
          />
        )}
      </div>

      {/* Dialogs */}
      {confirmInstall && (
        <PackageInstallConfirmDialog
          source={confirmInstall.source}
          packageName={confirmInstall.pkg?.name}
          scope={confirmInstall.scope}
          onScopeChange={(s) => setConfirmInstall((prev) => prev ? { ...prev, scope: s } : prev)}
          onConfirm={doInstall}
          onCancel={() => setConfirmInstall(null)}
        />
      )}
      {readmePkg && (
        <PackageReadmeDialog
          pkg={readmePkg}
          installed={installed.packages.some((p) => p.source === `npm:${readmePkg.name}`)}
          onInstall={() => { handleConfirmInstall(`npm:${readmePkg.name}`, readmePkg); setReadmePkg(null); }}
          onUninstall={() => { operations.remove(`npm:${readmePkg.name}`); setReadmePkg(null); }}
          onClose={() => setReadmePkg(null)}
        />
      )}
    </div>
  );
}
