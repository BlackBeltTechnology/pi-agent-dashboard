import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiLink, mdiLoading, mdiMagnify, mdiPackageVariantClosed } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useMemo, useState } from "react";
import { useInstalledPackages } from "../../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { usePackageSearch } from "../../hooks/usePackageSearch.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { classifySource } from "../../lib/package/package-classifier.js";
import { PackageCard } from "./PackageCard.js";
import { PackageRow } from "./PackageRow.js";
import { RecommendedExtensions } from "./RecommendedExtensions.js";

const TYPE_PILLS = ["extension", "skill", "theme", "prompt"] as const;

interface PackageBrowserProps {
  scope: "global" | "local";
  cwd?: string;
  onViewReadme?: (pkg: NpmPackageResult) => void;
  onConfirmInstall?: (source: string, pkg?: NpmPackageResult) => void;
  /**
   * Render the "Installed Packages" section above search.
   *
   * Defaults to `true` for the workspace surface (Pi Resources → Packages
   * tab), where this is the only manage UI. Settings → Packages should
   * pass `false` because `UnifiedPackagesSection` (Pi Ecosystem) is already
   * the global-scope manage surface, and rendering both would duplicate
   * every installed row.
   *
   * See change: unify-workspace-package-management.
   */
  showInstalledSection?: boolean;
}

export function PackageBrowser({
  scope,
  cwd,
  onViewReadme,
  onConfirmInstall,
  showInstalledSection = true,
}: PackageBrowserProps) {
  const { t } = useI18n();
  const search = usePackageSearch();
  const installedOwn = useInstalledPackages(scope, cwd);
  // Also fetch the other scope to show cross-scope badges
  const otherScope = scope === "global" ? "local" : "global";
  const installedOther = useInstalledPackages(otherScope, scope === "local" ? cwd : undefined);
  const operations = usePackageOperations(scope, cwd, installedOwn.refresh);
  const [urlInput, setUrlInput] = useState("");
  const [updatesAvailable, setUpdatesAvailable] = useState<Set<string>>(new Set());
  const [checkingUpdateFor, setCheckingUpdateFor] = useState<Set<string>>(new Set());

  /**
   * Map `pkg.source` (canonical id from server) → which scope(s) it's installed in.
   *
   * Source-keyed instead of npm-name-keyed so cross-scope detection works for
   * every source shape (`npm:`, absolute path, git URL). Search-result lookups
   * for `NpmPackageResult` rows synthesize `npm:${pkg.name}` at lookup time
   * (see `isInstalled` / `getInstalledScope` below). See change:
   * unify-workspace-package-management.
   */
  const installedInfo = useMemo(() => {
    const map = new Map<string, { own: boolean; other: boolean }>();
    for (const p of installedOwn.packages) {
      map.set(p.source, { own: true, other: false });
    }
    for (const p of installedOther.packages) {
      const e = map.get(p.source) ?? { own: false, other: false };
      e.other = true;
      map.set(p.source, e);
    }
    return map;
  }, [installedOwn.packages, installedOther.packages]);

  // Search-results rows (NpmPackageResult) have only `pkg.name`; reconstruct
  // their canonical source as `npm:${name}` for the source-keyed lookup.
  const lookupBySearchName = (name: string) => installedInfo.get(`npm:${name}`);

  const isInstalled = (name: string) => {
    const info = lookupBySearchName(name);
    return !!(info && (info.own || info.other));
  };

  const getInstalledScope = (name: string): "global" | "local" | "both" | undefined => {
    const info = lookupBySearchName(name);
    if (!info) return undefined;
    const ownScope = scope;
    const otherScopeLabel = otherScope;
    const inOwn = info.own;
    const inOther = info.other;
    if (inOwn && inOther) return "both";
    if (inOwn) return ownScope;
    if (inOther) return otherScopeLabel;
    return undefined;
  };

  /**
   * Non-recommended installed packages — shown as `PackageRow` entries above
   * search. Recommended ones live in the dedicated `RecommendedExtensions`
   * panel and are intentionally excluded here to avoid double-listing.
   */
  const installedNonRecommended = useMemo(
    () => installedOwn.packages.filter((p) => !p.isRecommended),
    [installedOwn.packages],
  );

  /** Sanitize a source string for use in a stable `data-testid`. */
  const sourceTestId = (source: string) =>
    source.replace(/[^a-z0-9]/gi, "-");

  const handleCheckUpdate = useCallback(async (pkgName: string) => {
    setCheckingUpdateFor((prev) => new Set(prev).add(pkgName));
    try {
      const res = await fetch(`${getApiBase()}/api/packages/check-updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const body = await res.json();
      if (body.success) {
        const sources = new Set(body.data.map((u: any) => u.source));
        setUpdatesAvailable((prev) => {
          const next = new Set(prev);
          // Check if this package has an update
          if (sources.has(`npm:${pkgName}`)) next.add(pkgName);
          return next;
        });
      }
    } catch { /* ignore */ }
    setCheckingUpdateFor((prev) => { const next = new Set(prev); next.delete(pkgName); return next; });
  }, [cwd]);

  // Display packages = search results, full stop. Installed packages live in
  // their own dedicated section (see InstalledPackagesSection JSX below) so
  // the synthetic-card-from-installed code path is gone. See change:
  // unify-workspace-package-management.
  const displayPackages = search.packages;

  const handleInstall = (pkg: NpmPackageResult) => {
    const source = `npm:${pkg.name}`;
    if (onConfirmInstall) {
      onConfirmInstall(source, pkg);
    } else {
      operations.install(source);
    }
  };

  const handleUrlInstall = () => {
    const source = urlInput.trim();
    if (!source) return;
    if (onConfirmInstall) {
      onConfirmInstall(source);
    } else {
      operations.install(source);
    }
    setUrlInput("");
  };

  return (
    <div className="flex flex-col gap-3" data-testid="package-browser">
      {/* Recommended extensions (curated by the dashboard) — shown above search */}
      <RecommendedExtensions scope={scope} cwd={cwd} />

      {/* Installed Packages — every source shape, uniform PackageRow.
          Hidden in Settings → Packages where UnifiedPackagesSection already
          renders these rows; shown in the workspace Pi Resources → Packages
          tab where this is the only manage surface. See change:
          unify-workspace-package-management. */}
      {showInstalledSection && installedNonRecommended.length > 0 && (
        <div data-testid="installed-packages-section">
          <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">
            {t("packages.installed", undefined, "Installed Packages")}
          </h3>
          <div className="space-y-1">
            {installedNonRecommended.map((pkg) => {
              // These rows are non-recommended by construction, so
              // isSourceOverride(pkg) is always false — no `override` pill
              // ever applies here. See change: flag-package-source-overrides.
              const tid = `installed-row-${sourceTestId(pkg.source)}`;
              const opSource = pkg.source;
              const busy = operations.runningSource === opSource;
              const opStatus = operations.statusFor(opSource);
              const opMessage = operations.messageFor(opSource);
              return (
                <PackageRow
                  key={pkg.source}
                  displayName={pkg.displayName ?? pkg.source}
                  source={pkg.source}
                  sourceType={classifySource(pkg.source)}
                  isBundled={!!pkg.isBundled}
                  currentVersion={pkg.version}
                  updateAvailable={updatesAvailable.has(pkg.source)}
                  busy={busy}
                  progress={busy ? opMessage : undefined}
                  error={opStatus === "error" ? opMessage : undefined}
                  canUpdate={true}
                  canUninstall={true}
                  onUpdate={() => operations.update(pkg.source)}
                  onUninstall={() => operations.remove(pkg.source)}
                  testId={tid}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* URL input for manual install */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Icon
            path={mdiLink}
            size={0.45}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleUrlInstall(); }}
            placeholder={i18nT("git.npmScopePkgOrGitGithub", undefined, "npm:@scope/pkg or git:github.com/user/repo")}
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            data-testid="package-url-input"
          />
        </div>
        <button
          onClick={handleUrlInstall}
          disabled={!urlInput.trim()}
          className="px-3 py-1.5 text-xs bg-[var(--accent-primary)] text-white rounded hover:bg-[var(--accent-primary)]/80 disabled:opacity-50 font-medium"
        >
          {t("common.install", undefined, "Install")}
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Icon
          path={mdiMagnify}
          size={0.45}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
        />
        <input
          type="text"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          placeholder={t("packages.searchPlaceholder", undefined, "Search pi packages on npm...")}
          className="w-full pl-7 pr-2 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          data-testid="package-search-input"
        />
      </div>

      {/* Type filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {TYPE_PILLS.map((type) => (
          <button
            key={type}
            onClick={() => search.setTypeFilter(search.typeFilter === type ? null : type)}
            className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
              search.typeFilter === type
                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/20 text-[var(--accent-primary)]"
                : "border-[var(--border-secondary)] text-[var(--text-muted)] hover:border-[var(--text-tertiary)]"
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Operation status — reflects queue (running + N queued). */}
      {operations.operation.status !== "idle" && (
        <div
          className={`text-xs px-2 py-1.5 rounded ${
            operations.operation.status === "running"
              ? "bg-blue-500/10 text-blue-400"
              : operations.operation.status === "success"
                ? "bg-green-500/10 text-green-400"
                : "bg-red-500/10 text-red-400"
          }`}
          data-testid="package-op-banner"
        >
          {operations.operation.status === "running" && (
            <Icon path={mdiLoading} size={0.4} className="inline animate-spin mr-1" />
          )}
          {operations.operation.status === "running"
            ? t("packages.installing", { source: operations.operation.source }, `Installing ${operations.operation.source}...`)
            : operations.operation.message}
          {operations.queueDepth > 0 && operations.operation.status === "running" && (
            <span className="ml-2 opacity-80">({t("common.queuedCount", { count: operations.queueDepth }, `${operations.queueDepth} queued`)})</span>
          )}
        </div>
      )}

      {/* Results */}
      {search.isLoading && search.packages.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <Icon path={mdiLoading} size={0.8} className="text-[var(--text-muted)] animate-spin" />
        </div>
      )}

      {search.error && (
        <div className="text-xs text-red-400 px-2">{search.error}</div>
      )}

      {!search.isLoading && displayPackages.length === 0 && !search.error && (
        <div className="text-center py-6 text-[var(--text-muted)]">
          <Icon path={mdiPackageVariantClosed} size={1.2} className="mx-auto mb-2 opacity-30" />
          <p className="text-xs">{t("packages.noPackages", undefined, "No packages found")}</p>
        </div>
      )}

      {displayPackages.length > 0 && (
        <>
          <div className="text-[10px] text-[var(--text-muted)]">
            {t("packages.packageCount", { count: displayPackages.length }, `${displayPackages.length} package${displayPackages.length !== 1 ? "s" : ""}`)}
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {displayPackages.map((pkg) => {
              const pkgInstalled = isInstalled(pkg.name);
              return (
                <PackageCard
                  key={pkg.name}
                  pkg={pkg}
                  installed={pkgInstalled}
                  installedScope={getInstalledScope(pkg.name)}
                  updateAvailable={updatesAvailable.has(pkg.name)}
                  checkingUpdate={checkingUpdateFor.has(pkg.name)}
                  operationStatus={(() => {
                    const s = operations.statusFor(`npm:${pkg.name}`);
                    if (s === "queued") return "running"; // visually busy but use the dedicated message
                    if (s === "idle") return undefined;
                    return s;
                  })()}
                  operationMessage={(() => {
                    const s = operations.statusFor(`npm:${pkg.name}`);
                    if (s === "queued") return t("common.queued", undefined, "Queued...");
                    if (s === "idle") return undefined;
                    return operations.messageFor(`npm:${pkg.name}`);
                  })()}
                  onInstall={() => handleInstall(pkg)}
                  onUninstall={() => operations.remove(`npm:${pkg.name}`)}
                  onUpdate={() => operations.update(`npm:${pkg.name}`)}
                  onCheckUpdate={pkgInstalled ? () => handleCheckUpdate(pkg.name) : undefined}
                  onClick={() => onViewReadme?.(pkg)}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
