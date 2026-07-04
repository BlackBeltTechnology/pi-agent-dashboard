import type { NpmPackageResult, PiPackageInfo, PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiArrowLeft, mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useMemo, useState } from "react";
import { useInstalledPackages } from "../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../hooks/usePackageOperations.js";
import { usePiResources } from "../hooks/usePiResources.js";
import { useResourceActivation } from "../hooks/useResourceActivation.js";
import { t as i18nT } from "../lib/i18n";
import { InstalledPackagesList } from "./InstalledPackagesList.js";
import { PackageBrowser } from "./PackageBrowser.js";
import { PackageInstallConfirmDialog } from "./PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";
import { MergedScopeSection, ResourceReloadBanner } from "./resource-tree.js";

interface Props {
  cwd: string;
  onBack: () => void;
  onViewFile: (filePath: string, title: string) => void;
}

export function PiResourcesView({ cwd, onBack, onViewFile }: Props) {
  const [activeTab, setActiveTab] = useState<"installed" | "packages">("installed");
  const { data, isLoading, error, refresh } = usePiResources(cwd);
  const activation = useResourceActivation(cwd);
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
                <ResourceReloadBanner activation={activation} />
                <MergedScopeSection
                  title={i18nT("auto.local", undefined, "Local")}
                  scope={data.local}
                  packages={data.packages.filter((p) => p.scope === "local" || !p.scope)}
                  onView={handleView}
                  activation={activation}
                  activationScope="local"
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
                  activation={activation}
                  activationScope="global"
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
