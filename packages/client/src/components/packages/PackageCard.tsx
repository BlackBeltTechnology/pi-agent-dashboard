import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiBookOpenPageVariant,
  mdiCheck,
  mdiDelete,
  mdiDownload,
  mdiLoading,
  mdiPaletteOutline,
  mdiPuzzleOutline,
  mdiTextBoxOutline,
  mdiUpdate,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import type { PackageOperationStatus } from "../../hooks/usePackageOperations.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

const typeIcons: Record<string, string> = {
  extension: mdiPuzzleOutline,
  skill: mdiBookOpenPageVariant,
  theme: mdiPaletteOutline,
  prompt: mdiTextBoxOutline,
};

const typeColors: Record<string, string> = {
  extension: "bg-blue-500/20 text-blue-400",
  skill: "bg-green-500/20 text-green-400",
  theme: "bg-purple-500/20 text-purple-400",
  prompt: "bg-amber-500/20 text-amber-400",
};

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface PackageCardProps {
  pkg: NpmPackageResult;
  installed: boolean;
  /** Which scope(s) the package is installed in */
  installedScope?: "global" | "local" | "both";
  updateAvailable?: boolean;
  checkingUpdate?: boolean;
  operationStatus?: PackageOperationStatus;
  operationMessage?: string;
  onInstall: () => void;
  onUninstall: () => void;
  onUpdate: () => void;
  onCheckUpdate?: () => void;
  onClick: () => void;
}

export function PackageCard({
  pkg,
  installed,
  installedScope,
  updateAvailable,
  checkingUpdate,
  operationStatus,
  operationMessage,
  onInstall,
  onUninstall,
  onUpdate,
  onCheckUpdate,
  onClick,
}: PackageCardProps) {
  const isRunning = operationStatus === "running";

  return (
    <div
      className="border border-[var(--border-secondary)] rounded-lg p-3 hover:border-[var(--border-primary)] transition-colors cursor-pointer h-full flex flex-col"
      onClick={onClick}
      data-testid="package-card"
    >
      {/* Header: name + scope + downloads */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate">{pkg.name}</h4>
        <div className="flex items-center gap-1 flex-shrink-0">
          {installed && installedScope && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/40 bg-green-500/10 text-green-400 whitespace-nowrap"
              title={`Installed in ${installedScope === "both" ? "Global + Local" : installedScope} scope`}
            >
              {installedScope === "both" ? "Global + Local"
                : installedScope === "global" ? "Global"
                : "Local"}
            </span>
          )}
          {pkg.downloads && (
            <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap flex items-center gap-0.5">
              <Icon path={mdiDownload} size={0.4} />
              {formatDownloads(pkg.downloads.weekly)}/wk
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {pkg.description ? (
        <p className="text-[11px] leading-snug text-[var(--text-secondary)] line-clamp-2 min-h-[2lh] mb-2">{pkg.description}</p>
      ) : (
        <p aria-hidden="true" className="text-[11px] leading-snug line-clamp-2 min-h-[2lh] mb-2" />
      )}

      {/* Type badges */}
      {pkg.types.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {pkg.types.map((t) => (
            <span
              key={t}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[t] ?? "bg-gray-500/20 text-gray-400"}`}
            >
              {typeIcons[t] && <Icon path={typeIcons[t]} size={0.35} />}
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Progress message */}
      {isRunning && operationMessage && (
        <div className="flex items-center gap-1 mb-2 text-[10px] text-[var(--accent-primary)]">
          <Icon path={mdiLoading} size={0.4} className="animate-spin" />
          <span className="truncate">{operationMessage}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap mt-auto" onClick={(e) => e.stopPropagation()}>
        {installed ? (
          <>
            <span className="inline-flex items-center gap-0.5 text-[10px] text-green-400 font-medium">
              <Icon path={mdiCheck} size={0.35} />
              {installedScope === "both" ? "Global + Local"
                : installedScope === "global" ? "Global"
                : installedScope === "local" ? "Local"
                : "Installed"}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {updateAvailable ? (
                <button
                  onClick={onUpdate}
                  disabled={isRunning}
                  className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50"
                >
                  <Icon path={mdiUpdate} size={0.35} className="inline mr-0.5" />
                  {i18nT("common.update", undefined, "Update")}
                </button>
              ) : onCheckUpdate ? (
                <button
                  onClick={onCheckUpdate}
                  disabled={isRunning || checkingUpdate}
                  className="text-[10px] px-2 py-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
                  title={i18nT("common.checkForUpdate", undefined, "Check for update")}
                >
                  {checkingUpdate
                    ? <Icon path={mdiLoading} size={0.35} className="animate-spin" />
                    : <Icon path={mdiUpdate} size={0.35} />}
                </button>
              ) : null}
              <button
                onClick={onUninstall}
                disabled={isRunning}
                className="text-[10px] px-2 py-0.5 rounded text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                title={i18nT("packages.uninstall", undefined, "Uninstall")}
              >
                <Icon path={mdiDelete} size={0.35} />
              </button>
            </div>
          </>
        ) : (
          <button
            onClick={onInstall}
            disabled={isRunning}
            className="w-full text-xs px-3 py-1.5 rounded bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary)]/80 disabled:opacity-50 font-medium"
          >
            {i18nT("common.install2", undefined, "Install")}
          </button>
        )}
      </div>
    </div>
  );
}
