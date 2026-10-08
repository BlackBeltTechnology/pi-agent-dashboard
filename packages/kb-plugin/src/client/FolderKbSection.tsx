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
 * Because that placement has no menu, the CARD placement instead renders ONE
 * compact reindex control as a SIBLING of the pill — outside the pill's
 * `role="button"` root, so no interactive element nests inside it and the pill's
 * Enter/Space handler can never swallow the control's activation. Its accessible
 * name varies with the KB state exactly like the menu item (Retry / Index now /
 * Reindex now) and lives on a wrapping `span`'s `title` as well, because a
 * disabled button swallows the mouse events a tooltip needs. The sidebar
 * placement renders no such sibling — its actions stay in the folder menu.
 * See change: fix-kb-card-refresh-and-shared-stats.
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
 *
 * Cwd refusal / folder presence (design D3–D6, D11). Full precedence:
 * `denied` (sub-state `pinning`) > `missing` > `error` > `indexing` (pending or
 * polled) > `loading` > `no-sources` > `not-indexed` > `stale` > `populated`.
 * `denied` offers ONE action, **Pin folder** (`pin_directory` WS verb, only
 * while connected); while denied a `PinnedDirsWatcher` child refetches on ANY
 * `pinned_dirs_updated` (no path matching — a still-refused refetch is
 * self-correcting). `missing` offers a disabled action. Zero configured sources
 * overrides the action with **Configure sources** (opens settings) — never a
 * dead `Index now` / `Retry` that can only 409.
 * See change: kb-denied-folder-pin-state.
 */

import {
  SlotPill,
  useFolderMenuItem,
  usePluginMessage,
  usePluginSend,
  useShellConnectionStatus,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { FolderDescriptor, SlotPlacement } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-props.js";
import { mdiDatabaseOutline, mdiDatabaseRefreshOutline, mdiPinOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import type { KbStats } from "../shared/kb-plugin-types.js";
import { kbSettingsUrl } from "./kb-api.js";
import { useKbStats } from "./useKbStats.js";

type RowState = "missing" | "error" | "indexing" | "no-sources" | "not-indexed" | "stale" | "populated";

/** Ordered stats-only derivation (design §5, D11). `denied`/`pinning` and the
 *  client-side error channels are layered on top at the call site. An absent
 *  `folderMissing` / `sourceCount` (older server) never yields `missing` /
 *  `no-sources`. */
export function deriveKbRowState(stats: KbStats | null): RowState | "loading" {
  if (!stats) return "loading";
  if (stats.folderMissing === true) return "missing";
  if (stats.jobStatus === "error") return "error";
  if (stats.indexing) return "indexing";
  if (stats.sourceCount === 0 && stats.chunks === 0) return "no-sources";
  if (!stats.indexed) return "not-indexed";
  if (stats.staleCount > 0) return "stale";
  return "populated";
}

type SectionState = RowState | "loading" | "denied" | "pinning";
type T = ReturnType<typeof useT>;

/**
 * Full section precedence (design D3, D11): `denied` (sub-state `pinning`) >
 * `missing` > client-side error (`reindexError` / poll `error`) > optimistic
 * `pending` (renders as `indexing`) > the stats-only {@link deriveKbRowState}.
 *
 * A rejected trigger or a persistent poll outage forces `error`, but a live
 * walk keeps its spinner because a transient blip never sets `error` (see
 * change: fix-kb-index-feedback). `pending` renders the SAME `indexing` branch
 * optimistically on click (see change: add-kb-index-optimistic-pending).
 */
function deriveSectionState(i: {
  denied: boolean;
  pinPending: boolean;
  clientError: string | null;
  pending: boolean;
  stats: KbStats | null;
}): SectionState {
  if (i.denied) return i.pinPending ? "pinning" : "denied";
  if (i.stats?.folderMissing === true) return "missing";
  if (i.clientError != null) return "error";
  if (i.pending) return "indexing";
  return deriveKbRowState(i.stats);
}

/** The ONE KB action, by kind. Zero configured sources overrides with
 *  `configure` (settings) — never a reindex that can only 409, not even
 *  `error`'s Retry (design D11). */
type ActionKind = "pin" | "missing" | "configure" | "retry" | "busy" | "index" | "reindex";

function actionKindFor(state: SectionState, busy: boolean, sourceCount: number | undefined): ActionKind {
  if (state === "denied" || state === "pinning") return "pin";
  if (state === "missing") return "missing";
  if (!busy && sourceCount === 0) return "configure";
  if (state === "error") return "retry";
  if (state === "indexing") return "busy";
  if (state === "not-indexed") return "index";
  return "reindex";
}

const ACTION_LABEL: Record<ActionKind, (t: T) => string> = {
  pin: (t) => t("pinFolder", undefined, "Pin folder"),
  missing: (t) => t("folderMissingAction", undefined, "Folder missing"),
  configure: (t) => t("configureSources", undefined, "Configure sources"),
  retry: (t) => t("retry", undefined, "Retry"),
  busy: (t) => t("labelIndexingShort", undefined, "indexing\u2026"),
  index: (t) => t("indexNow", undefined, "Index now"),
  reindex: (t) => t("titleReindexNow", undefined, "Reindex now"),
};

/** Presentation of the ONE action. Pin is gated on the connection (a send
 *  before `connected` is dropped); `busy` is the reindex double-submit window. */
function actionView(
  kind: ActionKind,
  i: { stale: boolean; staleCount: number; busy: boolean; pinPending: boolean; connected: boolean },
  t: T,
): { label: string; badge: string | undefined; disabled: boolean; icon: string; offline: boolean } {
  const pin = kind === "pin";
  const offline = pin && !i.connected;
  let badge: string | undefined;
  if (offline) badge = t("labelOffline", undefined, "offline");
  else if (i.stale) badge = t("labelStale", { count: i.staleCount }, `${i.staleCount} stale`);
  return {
    label: ACTION_LABEL[kind](t),
    badge,
    disabled: pin ? i.pinPending || !i.connected : kind === "missing" || i.busy,
    icon: pin ? mdiPinOutline : mdiDatabaseRefreshOutline,
    offline,
  };
}

const TERTIARY = "text-[var(--text-tertiary)]";

/** Single-span pill labels. Denied / pinning / missing are informational, so
 *  they render in the tertiary text colour, never the error accent (design D6). */
const SIMPLE_LABEL: Partial<Record<SectionState, { render: (t: T) => string; className: string }>> = {
  denied: { render: (t) => t("labelNotAllowedShort", undefined, "not allowed"), className: TERTIARY },
  pinning: { render: (t) => t("labelPinningShort", undefined, "pinning\u2026"), className: TERTIARY },
  missing: { render: (t) => t("labelFolderMissingShort", undefined, "folder missing"), className: TERTIARY },
  "no-sources": { render: (t) => t("labelNoSourcesShort", undefined, "no sources"), className: "text-teal-400" },
  error: { render: (t) => t("labelIndexFailedShort", undefined, "index failed"), className: "text-red-400" },
  "not-indexed": { render: (t) => t("labelNotIndexedShort", undefined, "not indexed"), className: "text-teal-400" },
};

function KbCount({ state, stats, t }: { state: SectionState; stats: KbStats | null; t: T }): React.ReactElement {
  const simple = SIMPLE_LABEL[state];
  if (simple) return <span className={simple.className}>{simple.render(t)}</span>;
  const files = stats?.files ?? 0;
  if (state === "indexing") {
    return (
      <>
        <span className="text-teal-400">{t("labelIndexingShort", undefined, "indexing…")}</span>
        <span className={`tabular-nums text-[10px] font-semibold ${TERTIARY}`}>{files.toLocaleString()} {t("labelFiles", undefined, "files")}</span>
      </>
    );
  }
  const staleCount = stats?.staleCount ?? 0;
  return (
    <>
      <span className="tabular-nums">{(stats?.chunks ?? 0).toLocaleString()}</span>
      <span className={`text-[10px] font-semibold ${TERTIARY}`}>{t("labelChunks", undefined, "chunks")}</span>
      {state === "stale" && (
        <span className="text-[10px] font-extrabold text-amber-400" data-testid="folder-kb-stale">
          ⚠ {t("labelStale", { count: staleCount }, `${staleCount} stale`)}
        </span>
      )}
    </>
  );
}

/** The pill is ALWAYS the settings link; state drives its tooltip. The denied
 *  tooltip is localized — the server's constant English `reason` is never shown. */
function pillTitle(state: SectionState, stats: KbStats | null, clientError: string | null, t: T): string {
  if (state === "denied" || state === "pinning") return t("titleDenied", undefined, "Folder not admitted — pin it to enable the knowledge base");
  if (state === "missing") return t("folderMissingAction", undefined, "Folder missing");
  if (state === "error") return clientError ?? stats?.lastError ?? t("titleErrorFallback", undefined, "Reindex failed — open KB settings");
  if (state === "not-indexed" || state === "no-sources") return t("titleNotIndexed", undefined, "Not indexed — open KB settings to define sources");
  const files = stats?.files ?? 0;
  const chunks = stats?.chunks ?? 0;
  const tip = t("countTip", { files, chunks }, `${files} files · ${chunks} chunks`);
  return t("titlePopulated", { tip }, `${tip} — open KB settings`);
}

/** Mounted ONLY while denied, so admitted folders attach no `ws` listener
 *  (`usePluginMessage` parses every frame). See change: kb-denied-folder-pin-state (D5). */
function PinnedDirsWatcher({ onUpdate }: { onUpdate: () => void }): null {
  usePluginMessage("pinned_dirs_updated", onUpdate);
  return null;
}

export function FolderKbSection({ folder, placement = "sidebar" }: { folder: FolderDescriptor; placement?: SlotPlacement }): React.ReactElement | null {
  const t = useT();
  const cwd = folder?.cwd;
  const [, navigate] = useLocation();
  const { stats, reindex, refetch, reindexError, error, pending, denied, pinPending, beginPinWait } = useKbStats(cwd);
  const send = usePluginSend();
  const connected = useShellConnectionStatus() === "connected";

  const clientError = reindexError ?? error ?? null;
  const state = deriveSectionState({ denied, pinPending, clientError, pending, stats });
  // `busy` (pending OR polled indexing) is the disabled window, so the
  // optimistic pending span keeps the double-submit guard.
  const busy = pending || stats?.indexing === true;
  const kind = actionKindFor(state, busy, stats?.sourceCount);
  // ONE action for every state (menu item in the sidebar, sibling control on the card).
  const {
    label: actionLabel,
    badge: actionBadge,
    disabled: actionDisabled,
    icon: actionIcon,
    offline: offlinePin,
  } = actionView(kind, { stale: state === "stale", staleCount: stats?.staleCount ?? 0, busy, pinPending, connected }, t);

  // Pin: fire-and-forget WS verb (dropped unless connected, hence the gate),
  // then a bounded wait for the `pinned_dirs_updated` refetch (design D4, D5).
  const runAction = useCallback(() => {
    if (actionDisabled || !cwd) return;
    if (kind === "pin") {
      void Promise.resolve(send({ type: "pin_directory", path: cwd })).catch(() => {});
      beginPinWait();
    } else if (kind === "configure") navigate(kbSettingsUrl(cwd));
    else reindex();
  }, [actionDisabled, cwd, kind, send, beginPinWait, navigate, reindex]);

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
        label: actionLabel,
        icon: actionIcon,
        badge: actionBadge,
        disabled: actionDisabled,
        onSelect: runAction,
      }),
      [actionLabel, actionIcon, actionBadge, actionDisabled, runAction],
    ),
  );

  if (!cwd) return null;

  return (
    <div
      data-testid="folder-kb-section"
      data-state={state}
      onClick={(e) => e.stopPropagation()}
      className={placement === "card" ? "flex items-center gap-1.5 [&>[role=button]]:flex-1 [&>[role=button]]:min-w-0" : undefined}
    >
      <SlotPill
        surface={placement === "card" ? "flat" : "raised"}
        glyph={mdiDatabaseOutline}
        accent={state === "error" ? "red" : "cyan"}
        label={t("labelKbShort", undefined, "Knowledge base")}
        activateTestId="folder-kb-open-settings"
        activateTitle={pillTitle(state, stats, clientError, t)}
        onActivate={() => navigate(kbSettingsUrl(cwd))}
      >
        <span data-testid="folder-kb-count" className="flex items-baseline gap-1.5 min-w-0">
          <KbCount state={state} stats={stats} t={t} />
        </span>
      </SlotPill>
      {kind === "pin" && <PinnedDirsWatcher onUpdate={refetch} />}
      {placement === "card" && (
        // Wrapper carries the tooltip: a disabled <button> swallows mouse
        // events, so a `title` on the button itself vanishes exactly in the
        // `indexing` window where the label matters most.
        <span title={offlinePin ? t("pinOffline", undefined, "Pin folder — offline") : actionLabel} className="shrink-0 flex items-center">
          <button
            type="button"
            data-testid="folder-kb-card-reindex"
            aria-label={actionLabel}
            disabled={actionDisabled}
            onClick={(e) => {
              e.stopPropagation();
              runAction();
            }}
            className="focus-ring shrink-0 w-6 h-6 rounded-md flex items-center justify-center border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-cyan-400 hover:border-cyan-500/45 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Icon path={actionIcon} size={0.55} />
          </button>
        </span>
      )}
    </div>
  );
}
