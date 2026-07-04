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
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { stats, reindex, reindexError, error } = useKbStats(cwd);

  if (!cwd) return null;

  // A rejected trigger (no job started) or a persistent stats-poll outage forces
  // the failed state — but a live `indexing` walk keeps its spinner because a
  // transient poll blip never sets `error` (bounded in useKbStats). See change:
  // fix-kb-index-feedback.
  const clientError = reindexError ?? error ?? null;
  const state = clientError != null ? "error" : deriveKbRowState(stats);
  const chunks = stats?.chunks ?? 0;
  const files = stats?.files ?? 0;
  const countTip = `${files} files · ${chunks} chunks`;
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
    state === "error" ? (clientError ?? stats?.lastError ?? "Reindex failed — open KB settings")
    : state === "not-indexed" ? "Not indexed — open KB settings to define sources"
    : `${countTip} — open KB settings`;

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
              "KB · index failed"
            ) : state === "indexing" ? (
              <>KB · indexing… <span className="tabular-nums">{files.toLocaleString()}</span> files</>
            ) : state === "not-indexed" ? (
              "KB · not indexed"
            ) : (
              <>
                KB · <span className="text-[var(--text-secondary)] tabular-nums">{chunks.toLocaleString()}</span> chunks
                {state === "stale" && (
                  <>
                    {" · "}
                    <span className="text-amber-400 font-bold" data-testid="folder-kb-stale">
                      {stats?.staleCount} stale
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
            <Icon path={mdiRefresh} size={0.4} className="inline mr-0.5" />Retry
          </button>
        ) : state === "indexing" ? (
          <Icon path={mdiRefresh} size={0.5} className="text-teal-400 animate-spin" />
        ) : state === "not-indexed" ? (
          <button
            onClick={doReindex}
            data-testid="folder-kb-index-now"
            className="text-[10px] px-1.5 py-0.5 rounded border text-teal-300 border-teal-500/40 bg-teal-500/5 hover:border-teal-500/70"
            title="Build the KB for this folder"
          >
            Index now
          </button>
        ) : (
          <button
            onClick={doReindex}
            data-testid="folder-kb-reindex"
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={state === "stale" ? `Reindex ${stats?.staleCount} changed files` : "Reindex now"}
          >
            <Icon path={mdiRefresh} size={0.5} />
          </button>
        )}
      </div>
    </div>
  );
}
