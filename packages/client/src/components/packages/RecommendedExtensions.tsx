/**
 * Recommended Extensions panel — renders at the top of the Packages tab.
 *
 * Shows each entry from the RECOMMENDED_EXTENSIONS manifest as a card with
 * its display name, status pill, live description, unlocks, installed /
 * active state, and an install / activate / remove action.
 *
 * Button logic (mirrors existing PackageBrowser + adds the on-disk-but-
 * inactive state):
 *
 *   activeInPi === true                         → [Remove]  (also pill "Active")
 *   activeInPi === false, installed.scope !== null  → [Activate]  (cheap settings-only op)
 *   activeInPi === false, installed.scope === null  → [Install]
 */

import type {
  EnrichedRecommendedExtension,
  RecommendedExtensionStatus,
} from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import {
  mdiClockOutline,
  mdiDelete,
  mdiDownloadMultiple,
  mdiFlashAuto,
  mdiLoading,
  mdiPlusCircle,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback } from "react";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { useRecommendedExtensions } from "../../hooks/useRecommendedExtensions.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  scope: "global" | "local";
  cwd?: string;
}

function statusPillClass(status: RecommendedExtensionStatus, activeInPi: boolean): string {
  if (activeInPi) return "bg-green-500/20 text-green-400 border-green-500/40";
  switch (status) {
    case "required":
      return "bg-danger/20 text-danger border-danger/40";
    case "strongly-suggested":
      return "bg-warning/20 text-warning border-warning/40";
    default:
      return "bg-muted/30 text-muted border-muted/40";
  }
}

function statusLabel(status: RecommendedExtensionStatus, activeInPi: boolean): string {
  if (activeInPi) return "Active";
  switch (status) {
    case "required":
      return "Required";
    case "strongly-suggested":
      return "Suggested";
    case "optional":
      return "Optional";
  }
}

function scopePillLabel(scope: "global" | "local" | null): string | null {
  if (scope === "global") return "Global";
  if (scope === "local") return "Local";
  return null;
}

export function RecommendedExtensions({ scope, cwd }: Props) {
  const { recommended, isLoading, error, refresh } = useRecommendedExtensions();
  const ops = usePackageOperations(scope, cwd, refresh);

  // Entries that need installing in the user's eyes ("missing").
  const missingEntries = recommended.filter((e) => !e.activeInPi);
  // "All missing already enqueued/running?" — disables the bulk button.
  const allMissingScheduled =
    missingEntries.length > 0 &&
    missingEntries.every((e) => {
      const s = ops.statusFor(e.source);
      return s === "queued" || s === "running";
    });

  const onInstallAllMissing = useCallback(() => {
    for (const entry of recommended.filter((e) => !e.activeInPi)) {
      const target =
        entry.installed.scope === "global" || entry.installed.scope === "local"
          ? entry.installed.scope
          : undefined;
      ops.install(entry.source, target);
    }
  }, [recommended, ops]);

  const onInstall = useCallback(
    (entry: EnrichedRecommendedExtension) => {
      // Fresh install: use the current browser scope.
      ops.install(entry.source);
    },
    [ops],
  );

  const onActivate = useCallback(
    (entry: EnrichedRecommendedExtension) => {
      // Package already on disk but not listed in settings.json. Re-running
      // install is idempotent: pi skips the download / clone and just
      // registers the source. Use the scope it's already installed under.
      const target =
        entry.installed.scope === "global" || entry.installed.scope === "local"
          ? entry.installed.scope
          : undefined;
      ops.install(entry.source, target);
    },
    [ops],
  );

  const onRemove = useCallback(
    (entry: EnrichedRecommendedExtension) => {
      // Remove from whichever scope it's installed in (if any); otherwise
      // the browser's current scope.
      const target =
        entry.installed.scope === "global" || entry.installed.scope === "local"
          ? entry.installed.scope
          : undefined;
      ops.remove(entry.source, target);
    },
    [ops],
  );

  if (isLoading && recommended.length === 0) {
    return (
      <div className="mb-4 p-4 bg-surface border border-border rounded-lg flex items-center gap-2 text-muted">
        <Icon path={mdiLoading} size={0.8} spin className="inline" />
        {i18nT("packages.loadingRecommendedExtensions", undefined, "Loading recommended extensions…")}
      </div>
    );
  }

  if (error && recommended.length === 0) {
    return (
      <div className="mb-4 p-4 bg-danger/10 border border-danger/40 rounded-lg text-danger text-sm">
        {i18nT("packages.failedToLoadRecommendedExtensions", undefined, "Failed to load recommended extensions:")} {error}
      </div>
    );
  }

  if (recommended.length === 0) return null;

  const missingRequired = recommended.filter(
    (e) => e.status === "required" && !e.activeInPi,
  ).length;
  const missingSuggested = recommended.filter(
    (e) => e.status === "strongly-suggested" && !e.activeInPi,
  ).length;

  return (
    <section className="mb-6">
      <header className="flex items-center justify-between mb-3 gap-3">
        <h2 className="text-lg font-semibold">{i18nT("common.recommendedForThisDashboard", undefined, "Recommended for this dashboard")}</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {missingRequired > 0 && (
              <span className="text-danger mr-3">
                ● {missingRequired} {i18nT("common.requiredMissing", undefined, "required missing")}
              </span>
            )}
            {missingSuggested > 0 && (
              <span className="text-warning">
                ★ {missingSuggested} {i18nT("common.suggestedMissing", undefined, "suggested missing")}
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={onInstallAllMissing}
            disabled={missingEntries.length === 0 || allMissingScheduled}
            title={
              missingEntries.length === 0
                ? "Nothing to install — every recommended extension is active."
                : allMissingScheduled
                  ? "All missing extensions are queued or running."
                  : `Install ${missingEntries.length} missing extension${missingEntries.length === 1 ? "" : "s"}`
            }
            className="text-xs px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            data-testid="rec-install-all-missing"
          >
            <Icon path={mdiDownloadMultiple} size={0.6} />
            {i18nT("packages.installAllMissing", undefined, "Install all missing")}
            {missingEntries.length > 0 && !allMissingScheduled && (
              <span className="ml-1 text-[10px] opacity-80">({missingEntries.length})</span>
            )}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {recommended.map((entry) => {
          const sourceStatus = ops.statusFor(entry.source);
          const isRunning = sourceStatus === "running";
          const isQueued = sourceStatus === "queued";
          const isBusy = isRunning || isQueued;
          const isActive = entry.activeInPi;
          const onDisk = entry.installed.scope !== null;
          const scopeLabel = scopePillLabel(entry.installed.scope);
          // "Activate" state: package is on disk but not registered in pi.
          const showActivate = !isActive && onDisk;
          const sourceMessage = ops.messageFor(entry.source);

          return (
            <div
              key={entry.id}
              className="border border-[var(--border-secondary)] rounded-lg p-3 hover:border-[var(--border-primary)] transition-colors flex flex-col gap-2 h-full"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-xs font-semibold text-[var(--text-primary)] truncate">
                    {entry.displayName}
                  </h4>
                  {entry.version && (
                    <div className="text-[10px] text-[var(--text-muted)]">v{entry.version}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isQueued && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded border border-blue-400/40 bg-blue-400/10 text-blue-400 whitespace-nowrap flex items-center gap-1"
                      title={i18nT("packages.waitingForAnEarlierPackageOperation", undefined, "Waiting for an earlier package operation to finish")}
                    >
                      <Icon path={mdiClockOutline} size={0.5} />
                      {i18nT("status.queued", undefined, "Queued")}
                    </span>
                  )}
                  {scopeLabel && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/40 bg-green-500/10 text-green-400 whitespace-nowrap"
                      title={`Installed in ${scopeLabel} scope`}
                    >
                      {scopeLabel}
                    </span>
                  )}
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${statusPillClass(entry.status, entry.activeInPi)}`}
                  >
                    {statusLabel(entry.status, entry.activeInPi)}
                  </span>
                  {entry.dashboardPlugin && (
                    // Companion-plugin badge. See change: add-plugin-activation-ui.
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                        entry.dashboardPluginInstalled
                          ? "bg-blue-500/15 text-blue-300 border-blue-500/40"
                          : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] border-[var(--border-secondary)]"
                      }`}
                      title={
                        entry.dashboardPluginInstalled
                          ? `Companion dashboard plugin "${entry.dashboardPlugin}" is installed`
                          : `Companion dashboard plugin "${entry.dashboardPlugin}" — not installed`
                      }
                      data-testid={`recommended-companion-plugin-${entry.id}`}
                    >
                      +plugin: {entry.dashboardPlugin}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-muted leading-snug line-clamp-2 min-h-[2lh]">{entry.description}</p>

              <div className="flex flex-nowrap gap-1 overflow-hidden min-h-[1.5rem]">
                {entry.unlocks.map((u) => (
                  <span
                    key={u}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted whitespace-nowrap flex-shrink-0"
                  >
                    {u}
                  </span>
                ))}
              </div>

              {/* Skills the package ships, DERIVED from its pi.skills manifest
                  (EnrichedRecommendedExtension.skillsRegistered). Absent when
                  the package ships no resolvable skills. See change:
                  recommend-monorepo-extensions. */}
              {entry.skillsRegistered && entry.skillsRegistered.length > 0 && (
                <div
                  className="flex flex-wrap gap-1"
                  data-testid={`recommended-skills-${entry.id}`}
                >
                  {entry.skillsRegistered.map((s) => (
                    <span
                      key={s}
                      title={`Ships the "${s}" skill`}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-500/40 bg-indigo-500/15 text-indigo-400 whitespace-nowrap"
                    >
                      skill: {s}
                    </span>
                  ))}
                </div>
              )}

              {entry.requirements && (
                // Declarative external requirements + live probe (Piece A).
                // See change: align-pi-080-and-publish-baseline-packages.
                <div
                  className="flex flex-wrap gap-1"
                  data-testid={`recommended-requires-${entry.id}`}
                >
                  {[
                    ...entry.requirements.piExtensions,
                    ...entry.requirements.binaries,
                    ...entry.requirements.services,
                  ].map((r) => (
                    <span
                      key={r.name}
                      className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${
                        r.satisfied
                          ? "bg-green-500/15 text-green-400 border-green-500/40"
                          : "bg-amber-500/15 text-amber-400 border-amber-500/40"
                      }`}
                      title={
                        r.satisfied
                          ? `Requirement "${r.name}" satisfied`
                          : `Requirement "${r.name}" missing`
                      }
                    >
                      {r.satisfied ? "\u2713" : "\u26a0"} {r.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 mt-auto">
                <code className="text-[10px] text-muted truncate" title={entry.source}>
                  {entry.source}
                </code>
                <div className="flex gap-1">
                  {isActive ? (
                    <button
                      onClick={() => onRemove(entry)}
                      disabled={isBusy}
                      className="text-xs px-2 py-1 rounded border border-border hover:bg-danger/10 hover:text-danger flex items-center gap-1 disabled:opacity-50"
                      data-testid={`rec-remove-${entry.id}`}
                    >
                      {isRunning ? (
                        <Icon path={mdiLoading} size={0.6} spin />
                      ) : isQueued ? (
                        <Icon path={mdiClockOutline} size={0.6} />
                      ) : (
                        <Icon path={mdiDelete} size={0.6} />
                      )}
                      {i18nT("common.remove2", undefined, "Remove")}
                    </button>
                  ) : showActivate ? (
                    <button
                      onClick={() => onActivate(entry)}
                      disabled={isBusy}
                      className="text-xs px-2 py-1 rounded border border-success/40 bg-success/10 text-success hover:bg-success/20 flex items-center gap-1 disabled:opacity-50"
                      data-testid={`rec-activate-${entry.id}`}
                      title={
                        scopeLabel
                          ? `Already installed ${scopeLabel.toLowerCase()}ly — register it with pi.`
                          : "Register already-installed package with pi."
                      }
                    >
                      {isRunning ? (
                        <Icon path={mdiLoading} size={0.6} spin />
                      ) : isQueued ? (
                        <Icon path={mdiClockOutline} size={0.6} />
                      ) : (
                        <Icon path={mdiFlashAuto} size={0.6} />
                      )}
                      {i18nT("common.activate", undefined, "Activate")}
                    </button>
                  ) : (
                    <button
                      onClick={() => onInstall(entry)}
                      disabled={isBusy}
                      className="text-xs px-2 py-1 rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 disabled:opacity-50"
                      data-testid={`rec-install-${entry.id}`}
                    >
                      {isRunning ? (
                        <Icon path={mdiLoading} size={0.6} spin />
                      ) : isQueued ? (
                        <Icon path={mdiClockOutline} size={0.6} />
                      ) : (
                        <Icon path={mdiPlusCircle} size={0.6} />
                      )}
                      {i18nT("common.install2", undefined, "Install")}
                    </button>
                  )}
                </div>
              </div>

              {isRunning && sourceMessage && (
                <div className="text-[11px] text-muted">{sourceMessage}</div>
              )}
              {sourceStatus === "error" && (
                <div className="text-[11px] text-danger">
                  {sourceMessage}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
