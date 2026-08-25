/**
 * FolderKbSection — `sidebar-folder-section` slot claim.
 *
 * Sibling of the Goals / Automations folder rows: shows the folder's KB entry
 * count in one of five states derived from the KB stats (design §5). The `→`
 * opens the per-folder KB settings page. Plugin-local navigation via wouter;
 * no core/shell edit.
 *
 * The pill is STATE-ONLY. The former three state-variant controls (`retry` /
 * `index now` / `reindex`) fold into ONE declarative `MAINTENANCE` item in the
 * folder actions menu, whose label, badge and disabled state vary by KB state.
 * It stays distinct from the menu's plain refresh — rebuilding an index is not
 * refetching a view — and carries its own glyph for the same reason. The
 * worktree-card placement has no folder actions menu, so it registers nothing.
 * See change: move-slot-actions-to-menu.
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

import { SlotPill, useFolderMenuItem, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor, SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiDatabaseOutline, mdiDatabaseRefreshOutline } from "@mdi/js";
import type React from "react";
import { useMemo } from "react";
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

export function FolderKbSection({ folder, placement = "sidebar" }: { folder: FolderDescriptor; placement?: SlotPlacement }): React.ReactElement | null {
  const t = useT();
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { stats, reindex, reindexError, error, pending } = useKbStats(cwd);

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
  const staleCount = stats?.staleCount ?? 0;

  // ONE menu item for every state. `busy` (pending OR polled indexing) is the
  // disabled window, so the optimistic pending span keeps the existing
  // double-submit guard rather than only the polled `indexing` state.
  const menuLabel =
    state === "error" ? t("retry", undefined, "Retry")
    : state === "indexing" ? t("labelIndexingShort", undefined, "indexing\u2026")
    : state === "not-indexed" ? t("indexNow", undefined, "Index now")
    : t("titleReindexNow", undefined, "Reindex now");
  const menuBadge =
    state === "stale"
      ? t("labelStale", { count: staleCount }, `${staleCount} stale`)
      : undefined;
  // The worktree-card placement is scoped to the worktree cwd, which has no
  // folder actions menu — registering there would strand items in a scope with
  // nothing to render them.
  const menuScope = placement === "card" ? null : cwd;
  useFolderMenuItem(
    menuScope,
    useMemo(
      () => ({
        id: "kb-reindex",
        group: "maintenance" as const,
        label: menuLabel,
        icon: mdiDatabaseRefreshOutline,
        badge: menuBadge,
        disabled: busy,
        onSelect: () => reindex(),
      }),
      [menuLabel, menuBadge, busy, reindex],
    ),
  );

  if (!cwd) return null;

  // The pill itself is ALWAYS the settings link; state drives the tooltip.
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
      <SlotPill
        surface={placement === "card" ? "flat" : "raised"}
        glyph={mdiDatabaseOutline}
        accent={state === "error" ? "red" : "cyan"}
        label={t("labelKbShort", undefined, "Knowledge base")}
        activateTestId="folder-kb-open-settings"
        activateTitle={labelTitle}
        onActivate={() => navigate(kbSettingsUrl(cwd))}
      >
        <span data-testid="folder-kb-count" className="flex items-baseline gap-1.5 min-w-0">
          {state === "error" ? (
            <span className="text-red-400">{t("labelIndexFailedShort", undefined, "index failed")}</span>
          ) : state === "indexing" ? (
            <>
              <span className="text-teal-400">{t("labelIndexingShort", undefined, "indexing…")}</span>
              <span className="tabular-nums text-[10px] font-semibold text-[var(--text-tertiary)]">{files.toLocaleString()} {t("labelFiles", undefined, "files")}</span>
            </>
          ) : state === "not-indexed" ? (
            <span className="text-teal-400">{t("labelNotIndexedShort", undefined, "not indexed")}</span>
          ) : (
            <>
              <span className="tabular-nums">{chunks.toLocaleString()}</span>
              <span className="text-[10px] font-semibold text-[var(--text-tertiary)]">{t("labelChunks", undefined, "chunks")}</span>
              {state === "stale" && (
                <span className="text-[10px] font-extrabold text-amber-400" data-testid="folder-kb-stale">
                  ⚠ {t("labelStale", { count: staleCount }, `${staleCount} stale`)}
                </span>
              )}
            </>
          )}
        </span>
      </SlotPill>
    </div>
  );
}
