/**
 * FolderKbSection — `sidebar-folder-section` slot claim.
 *
 * Sibling of the Goals / Automations folder rows: shows the folder's KB entry
 * count + a reindex affordance, in one of five states derived from the KB
 * stats (design §5). The `→` opens the per-folder KB settings page. Plugin-
 * local navigation via wouter; no core/shell edit.
 *
 * State derivation is ORDERED — `error` (failed job) wins over `not-indexed`
 * (chunks:0, never run), so a failed first index shows `Retry`, not
 * `Index now`. `indexing` outranks the count states.
 *
 * The `KB ·` label opens the per-folder settings page in EVERY state (via the
 * `→`) — including `not-indexed` / `error` — so a fresh worktree can always
 * reach Create-config / Copy-from-parent to define `sources[]`; without that
 * path `Index now` over empty sources is a perpetual no-op. See change:
 * add-kb-folder-slot.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiArrowRight, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useLocation } from "wouter";
import type { KbStats } from "../shared/kb-plugin-types.js";
import { kbSettingsUrl } from "./kb-api.js";
import { useKbStats } from "./useKbStats.js";

type RowState = "error" | "indexing" | "not-indexed" | "stale" | "populated";

/** Ordered five-state derivation (design §5). */
export function deriveKbRowState(stats: KbStats | null): RowState | "loading" {
  if (!stats) return "loading";
  if (stats.jobStatus === "error") return "error";
  if (stats.indexing) return "indexing";
  if (!stats.indexed) return "not-indexed";
  if (stats.staleCount > 0) return "stale";
  return "populated";
}

export function FolderKbSection({ folder }: { folder: FolderDescriptor }): React.ReactElement | null {
  const t = useT();
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { stats, reindex, reindexError, error, pending } = useKbStats(cwd);

  if (!cwd) return null;

  // A rejected trigger (no job started) or a persistent stats-poll outage forces
  // the failed state — but a live `indexing` walk keeps its spinner because a
  // transient poll blip never sets `error` (bounded in useKbStats). See change:
  // fix-kb-index-feedback.
  //
  // `pending` renders the SAME `indexing` branch optimistically the instant the
  // action is clicked (before the server's 202 / first /stats). `error` still
  // outranks it so a trigger reject shows Retry, not a spinner. `busy` disables
  // the action controls for the whole pending+indexing window (no double-submit).
  // See change: add-kb-index-optimistic-pending.
  const clientError = reindexError ?? error ?? null;
  const state = clientError != null ? "error" : pending ? "indexing" : deriveKbRowState(stats);
  const busy = pending || stats?.indexing === true;
  const chunks = stats?.chunks ?? 0;
  const files = stats?.files ?? 0;
  const countTip = t("countTip", { files, chunks }, `${files} files · ${chunks} chunks`);
  const openSettings = (e: React.MouseEvent): void => {
    e.stopPropagation();
    navigate(kbSettingsUrl(cwd));
  };
  const doReindex = (e: React.MouseEvent): void => {
    e.stopPropagation();
    reindex();
  };

  // Label content per state; the label itself is ALWAYS the settings link.
  const labelTone =
    state === "error" ? "text-red-400"
    : state === "indexing" || state === "not-indexed" ? "text-teal-400"
    : "text-[var(--text-tertiary)]";
  const labelTitle =
    state === "error" ? (clientError ?? stats?.lastError ?? t("titleErrorFallback", undefined, "Reindex failed — open KB settings"))
    : state === "not-indexed" ? t("titleNotIndexed", undefined, "Not indexed — open KB settings to define sources")
    : t("titlePopulated", { tip: countTip }, `${countTip} — open KB settings`);

  return (
    <div
      data-testid="folder-kb-section"
      data-state={state}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 mt-1">
        <button
          onClick={openSettings}
          data-testid="folder-kb-open-settings"
          className={`flex items-center gap-1 text-[10px] font-semibold uppercase hover:text-indigo-400 ${labelTone}`}
          title={labelTitle}
        >
          <span data-testid="folder-kb-count">
            {state === "error" ? (
              t("labelIndexFailed", undefined, "KB · index failed")
            ) : state === "indexing" ? (
              <>{t("labelIndexing", undefined, "KB · indexing…")} <span className="tabular-nums">{files.toLocaleString()}</span> {t("labelFiles", undefined, "files")}</>
            ) : state === "not-indexed" ? (
              t("labelNotIndexed", undefined, "KB · not indexed")
            ) : (
              <>
                {t("labelKbPrefix", undefined, "KB ·")} <span className="text-[var(--text-secondary)] tabular-nums">{chunks.toLocaleString()}</span> {t("labelChunks", undefined, "chunks")}
                {state === "stale" && (
                  <>
                    {" · "}
                    <span className="text-amber-400 font-bold" data-testid="folder-kb-stale">
                      {t("labelStale", { count: stats?.staleCount ?? 0 }, `${stats?.staleCount} stale`)}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
          <Icon path={mdiArrowRight} size={0.45} />
        </button>
        <span className="flex-1" />
        {state === "error" ? (
          <button
            onClick={doReindex}
            data-testid="folder-kb-retry"
            className="text-[10px] px-1.5 py-0.5 rounded border text-red-400 border-red-500/40 bg-red-500/5 hover:border-red-500/70"
          >
            <Icon path={mdiRefresh} size={0.4} className="inline mr-0.5" />{t("retry", undefined, "Retry")}
          </button>
        ) : state === "indexing" ? (
          <Icon path={mdiRefresh} size={0.5} className="text-teal-400 animate-spin" />
        ) : state === "not-indexed" ? (
          <button
            onClick={doReindex}
            disabled={busy}
            data-testid="folder-kb-index-now"
            className="text-[10px] px-1.5 py-0.5 rounded border text-teal-300 border-teal-500/40 bg-teal-500/5 hover:border-teal-500/70 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("titleBuildKb", undefined, "Build the KB for this folder")}
          >
            {t("indexNow", undefined, "Index now")}
          </button>
        ) : (
          <button
            onClick={doReindex}
            disabled={busy}
            data-testid="folder-kb-reindex"
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
            title={state === "stale" ? t("titleReindexStale", { count: stats?.staleCount ?? 0 }, `Reindex ${stats?.staleCount} changed files`) : t("titleReindexNow", undefined, "Reindex now")}
          >
            <Icon path={mdiRefresh} size={0.5} />
          </button>
        )}
      </div>
    </div>
  );
}
