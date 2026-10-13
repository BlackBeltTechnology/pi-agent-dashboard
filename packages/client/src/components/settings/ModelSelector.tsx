import { RoleRef, type RoleRefLabels } from "@blackbelt-technology/dashboard-plugin-runtime";
import { LayerPortal } from "@blackbelt-technology/pi-dashboard-client-utils/LayerPortal";
import type { ProviderRefreshError } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { ModelInfo, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertOutline, mdiBrain, mdiCheck, mdiChevronDown, mdiCog, mdiEye, mdiLoading, mdiStar, mdiStarOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LIST_POPOVER_MIN_HEIGHT, usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useModelConfigOptional } from "../../lib/state/ModelConfigContext.js";
import { usePopoverBoundary } from "../../lib/state/PopoverBoundaryContext.js";

// Per-browser view-state persistence (NOT favorites — those persist server-side).
// See change: enrich-model-selector-capabilities-favorites.
const PROVIDER_FILTER_KEY = "modelselector.providerFilter";
const FAV_ONLY_KEY = "modelselector.favOnly";

function readLS(key: string): string {
  try { return localStorage.getItem(key) ?? ""; } catch { return ""; }
}
function writeLS(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode / quota */ }
}

interface Props {
  current?: string;
  models?: ModelInfo[];
  onSelect: (model: string) => void;

  /** Trigger text shown when no `current` model is selected. Default "no model". */
  placeholder?: string;

  /**
   * Opt-in Model | Role switch. The Role tab lists built-in + custom roles
   * (from `GET /api/roles`) and emits `@role` via `onSelect`. Renders only
   * when the roles plugin answers 2xx; otherwise the picker is unchanged.
   * See change: add-role-aware-model-refs.
   */
  allowRoles?: boolean;

  /**
   * One-shot hint: the current model was resolved from this `@role` at pick time
   * and will NOT follow later role changes. Shown beside the trigger text.
   */
  viaRole?: string;

  /**
   * Opt-in disable of the trigger. Default (undefined/false) leaves the trigger
   * openable even with an empty catalogue — the composer's recovery path (see
   * change: open-empty-model-selector). Surfaces that legitimately want a dead
   * trigger while a list loads (e.g. the OpenSpec run-config launch row, which
   * has no session to recover) pass `disabled`.
   */
  disabled?: boolean;

  /**
   * Re-request of the model list for the current session, fired on the dropdown
   * OPEN transition — the sole refresh trigger. Optional: with no handler (no
   * session selected) opening simply renders the last-known list.
   * See changes: refresh-model-selector-models, upgrade-model-selector-primitives.
   */
  onRefresh?: () => void;

  /**
   * Providers whose catalogue refresh failed. Rendered as a non-blocking footer
   * notice; absent/empty renders nothing. Never a toast — the refresh fires on
   * every open. See change: upgrade-model-selector-primitives (design D5).
   */
  refreshErrors?: ProviderRefreshError[];

  /**
   * Navigate to the dashboard's Settings → Providers surface. Wired to the
   * recovery link shown in the empty-state body and the thin partial-failure
   * footer. Optional: mount sites without a navigation path omit it and the
   * link is not rendered. See change: open-empty-model-selector.
   */
  onOpenProviderSettings?: () => void;

  /** Favorite model labels (`"provider/id"`), server-persisted, hydrated by App. */
  favorites?: string[];
  /** Toggle a model's favorite state. `makeFavorite` true = add, false = remove. */
  onToggleFavorite?: (label: string, makeFavorite: boolean) => void;

  /**
   * @deprecated Roles UI moved to a `settings-section` plugin contribution
   * (BuiltInRolesSettings in @blackbelt-technology/pi-dashboard-roles-plugin).
   * The prop is kept for backward compatibility with callers that still drill
   * `RoleInfo` through, but it has no effect on rendering. See change:
   * fix-pi-flows-end-to-end (Group 5).
   */
  roles?: RoleInfo;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onRoleSet?: (role: string, modelId: string) => void;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onPresetLoad?: (presetName: string) => void;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onPresetSave?: (presetName: string) => void;
  /** @deprecated — use the roles settings-section. Ignored here. */
  onPresetDelete?: (presetName: string) => void;
}

const labelOf = (m: ModelInfo) => `${m.provider}/${m.id}`;
const ctxFmt = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : `${Math.round(n / 1000)}k`);

// Trigger→panel gap for the portaled `fixed` panel — replaces the `mt-1` /
// `mb-1` the inline form got from flow (a portaled panel has no flow sibling).
// See change: fix-composer-popover-layering.
const GAP = 4;

/**
 * One capability icon (MDI). The accessible text is visually hidden so a screen
 * reader hears the capability and its confidence; `title` stays for sighted
 * hover. See change: retro-ux-model-selector (D9 conformance).
 */
function CapIcon({ path, title }: { path: string; title: string }) {
  return (
    <span className="relative inline-flex items-center text-[var(--text-secondary)]" title={title}>
      <Icon path={path} size={0.45} aria-hidden />
      <span className="sr-only">{title}</span>
    </span>
  );
}

/**
 * Capability icons with honest confidence:
 *   - reasoning:true  → brain icon
 *   - vision:true     → eye icon
 *   - metadataSource "fallback" → eye + brain followed by the word "assumed"
 *     (provider gave no signal)
 *   - metadataSource "endpoint" → confirmed, same as "catalog": the provider
 *     advertised every field itself. Only "fallback" is uncertain.
 *     See change: fix-custom-provider-model-metadata.
 *   - no capability fields → nothing rendered
 */
function CapBadges({ m }: { m: ModelInfo }) {
  if (m.metadataSource === "fallback") {
    // Provider reported nothing: vision force-assumed, reasoning unknown.
    return (
      <>
        <CapIcon path={mdiEye} title={i18nT("providers.visionAssumedProviderReportedNoCapabi", undefined, "Vision assumed — provider reported no capabilities; image input defaulted on")} />
        <CapIcon path={mdiBrain} title={i18nT("providers.reasoningUnknownProviderReportedNone", undefined, "Reasoning unknown — provider reported none")} />
        <span aria-hidden="true" className="text-[11px] text-[var(--text-secondary)]">{i18nT("common.capabilityAssumed", undefined, "assumed")}</span>
      </>
    );
  }
  return (
    <>
      {m.reasoning && <CapIcon path={mdiBrain} title={i18nT("session.reasoningConfirmed", undefined, "Reasoning (confirmed)")} />}
      {m.vision && <CapIcon path={mdiEye} title={i18nT("common.visionCapableConfirmed", undefined, "Vision-capable (confirmed)")} />}
    </>
  );
}

const SECONDARY_BTN =
  "focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] px-3 min-h-[44px] sm:min-h-[36px] text-xs font-semibold";
const GHOST_BTN =
  "focus-ring inline-flex items-center gap-1 rounded-md px-2 tap-target text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
const WARNING_PILL =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]";

/**
 * Shared recovery button → Settings → Providers (gear icon, no directional
 * arrow). Rendered only when a navigation handler is wired. `secondary` is the
 * empty-state button, `ghost` the footer one (they never render together).
 * See changes: open-empty-model-selector, retro-ux-model-selector.
 */
function ProviderSettingsLink({ label, onClick, variant }: { label: string; onClick?: () => void; variant: "secondary" | "ghost" }) {
  if (!onClick) return null;
  return (
    <button type="button" data-testid="model-provider-settings-link" onClick={onClick} className={variant === "secondary" ? SECONDARY_BTN : GHOST_BTN}>
      {variant === "secondary" && <Icon path={mdiCog} size={0.55} className="flex-shrink-0" aria-hidden />}
      <span>{label}</span>
    </button>
  );
}

/**
 * Empty-catalogue popover body: a transient refreshing line (`role="status"`)
 * while the open-triggered refresh is in flight, then headline + help line +
 * "Open provider settings" button once the refresh has completed empty.
 * See changes: open-empty-model-selector (D4-A, D5-B), retro-ux-model-selector.
 */
function EmptyCatalogueBody({
  awaitingRefresh,
  onOpenProviderSettings,
}: {
  awaitingRefresh: boolean;
  onOpenProviderSettings?: () => void;
}) {
  if (awaitingRefresh) {
    return (
      <div className="px-3 py-4 flex flex-col items-start gap-2 text-xs" data-testid="model-empty">
        <div role="status" className="flex items-center gap-1.5 text-[var(--text-secondary)]" data-testid="model-empty-refreshing">
          <Icon path={mdiLoading} size={0.6} className="animate-spin" aria-hidden />
          <span>{i18nT("common.refreshingModels", undefined, "Refreshing models…")}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="px-3 py-4 flex flex-col items-start gap-2 text-xs" data-testid="model-empty">
      <div className="text-[13px] font-semibold text-[var(--text-primary)]">{i18nT("common.noModelsAvailable", undefined, "No models available")}</div>
      <p className="m-0 text-[var(--text-secondary)]">
        {i18nT("common.noModelsHelp", undefined, "Connect a provider to add models. Close and reopen this list to refresh it.")}
      </p>
      <ProviderSettingsLink
        variant="secondary"
        label={i18nT("common.openProviderSettings", undefined, "Open provider settings")}
        onClick={onOpenProviderSettings}
      />
    </div>
  );
}

/**
 * Fire the open-transition `request_models` refresh (the sole refresh trigger)
 * and report whether the selector is still awaiting the first `models_list`
 * since opening. `awaitingRefresh` is true from that fired refresh until the
 * next change in `models` prop identity (a fresh list arrived) or a safety
 * timeout. Gates the empty-state recovery link so an in-flight refresh never
 * renders a premature "no models" affordance.
 * See changes: upgrade-model-selector-primitives (D4), open-empty-model-selector.
 */
function useOpenTriggeredRefresh(open: boolean, models: ModelInfo[] | undefined, onRefresh?: () => void): boolean {
  const [awaitingRefresh, setAwaitingRefresh] = useState(false);
  // Latest handler without re-firing the open effect when its identity changes.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => { onRefreshRef.current = onRefresh; }, [onRefresh]);

  useEffect(() => {
    if (open) {
      if (onRefreshRef.current) {
        onRefreshRef.current();
        setAwaitingRefresh(true);
      }
    } else {
      setAwaitingRefresh(false);
    }
  }, [open]);

  // A change in `models` identity = a fresh `models_list` arrived; leave the
  // awaiting window. (Runs on mount too, harmlessly — the flag is already false.)
  // biome-ignore lint/correctness/useExhaustiveDependencies: identity-only signal, not a value read.
  useEffect(() => { setAwaitingRefresh(false); }, [models]);

  // Safety timeout: never strand the refreshing body if no list ever arrives.
  useEffect(() => {
    if (!awaitingRefresh) return;
    const timer = setTimeout(() => setAwaitingRefresh(false), 10_000);
    return () => clearTimeout(timer);
  }, [awaitingRefresh]);

  return awaitingRefresh;
}

/** "Favorites only" filter toggle; pressed state is painted with the `--tint-blue-*` family. */
function FavsOnlyToggle({ pressed, onToggle }: { pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="favs-only-toggle"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`focus-ring inline-flex items-center gap-1 px-2 tap-target text-xs font-semibold rounded border whitespace-nowrap ${
        pressed
          ? "bg-[var(--tint-blue-bg)] border-[var(--tint-blue-border)] text-[var(--tint-blue-fg)]"
          : "text-[var(--text-secondary)] border-[var(--border-secondary)] bg-[var(--bg-tertiary)]"
      }`}
    >
      <Icon path={pressed ? mdiStar : mdiStarOutline} size={0.55} aria-hidden /> {i18nT("common.favoritesOnly", undefined, "Favorites only")}
    </button>
  );
}

/** The grouped model grid (APG grid popup): one rowgroup per provider, headers labelled by id. */
function ModelGrid({
  listRef,
  listId,
  providerGroups,
  flat,
  renderRow,
}: {
  listRef: React.RefObject<HTMLDivElement | null>;
  listId: string;
  providerGroups: Array<{ provider: string; items: ModelInfo[] }>;
  flat: ModelInfo[];
  renderRow: (m: ModelInfo, flatIdx: number) => React.ReactNode;
}) {
  // Running flat index so grouped rows map to the same order as `flat`.
  let cursor = -1;
  const nextIdx = () => (cursor += 1);
  return (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
      {flat.length === 0 ? (
        <div role="status" className="px-3 py-2 text-xs text-[var(--text-secondary)]">{i18nT("common.noModelsMatch", undefined, "No models match")}</div>
      ) : (
        <div role="grid" id={listId} aria-label={i18nT("common.modelsTab", undefined, "Models")}>
          {providerGroups.map((g) => {
            const headerId = `${listId}-grp-${g.provider}`;
            return (
              <React.Fragment key={g.provider}>
                <div id={headerId} role="presentation" className="px-3 py-1 text-xs font-semibold text-[var(--text-secondary)] bg-[var(--bg-primary)] sticky top-0" data-testid="group-provider">{g.provider}</div>
                <div role="rowgroup" aria-labelledby={headerId}>
                  {g.items.map((m) => renderRow(m, nextIdx()))}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Thin partial-failure footer (count only; names live in Settings → Providers). See change: open-empty-model-selector (D1-B). */
function RefreshErrorsFooter({ failCount, onOpenProviderSettings }: { failCount: number; onOpenProviderSettings?: () => void }) {
  if (failCount === 0) return null;
  return (
    <div className="border-t border-[var(--border-secondary)] px-2 py-1.5 flex items-center gap-1.5" data-testid="model-refresh-errors">
      <span className={WARNING_PILL}>
        <Icon path={mdiAlertOutline} size={0.5} className="flex-shrink-0" aria-hidden />
        {i18nT(
          "common.modelProvidersUnavailable",
          { count: failCount },
          `${failCount} ${failCount === 1 ? "provider" : "providers"} unavailable`,
        )}
      </span>
      <span className="ml-auto">
        <ProviderSettingsLink variant="ghost" label={i18nT("common.openProviders", undefined, "Open providers")} onClick={onOpenProviderSettings} />
      </span>
    </div>
  );
}

/**
 * Populated-catalogue popover body: provider/favs filters, the combobox filter,
 * the grouped model grid, and the thin partial-failure footer. Extracted so its
 * nested conditionals live in their own scope (keeps ModelSelector's cognitive
 * complexity in budget). See changes: open-empty-model-selector,
 * retro-ux-model-selector (D5 combobox + grid).
 */
function PopulatedCatalogueBody({
  filter,
  setFilter,
  favOnly,
  setFavOnly,
  favoritesEnabled,
  providerFilter,
  setProviderFilter,
  resetActive,
  uniqueProviders,
  providerGroups,
  flat,
  inputRef,
  listRef,
  listId,
  activeDescendant,
  handleKeyDown,
  renderRow,
  failCount,
  onOpenProviderSettings,
}: {
  filter: string;
  setFilter: (v: string) => void;
  favOnly: boolean;
  setFavOnly: (updater: (v: boolean) => boolean) => void;
  favoritesEnabled: boolean;
  providerFilter: string;
  setProviderFilter: (v: string) => void;
  resetActive: () => void;
  uniqueProviders: string[];
  providerGroups: Array<{ provider: string; items: ModelInfo[] }>;
  flat: ModelInfo[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  listId: string;
  activeDescendant: string | undefined;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  renderRow: (m: ModelInfo, flatIdx: number) => React.ReactNode;
  failCount: number;
  onOpenProviderSettings?: () => void;
}) {
  const filterLabel = i18nT("common.filterModels", undefined, "Filter models…");
  return (
    <>
      {/* ── Filters ── */}
      <div className="p-1.5 pb-1 space-y-1">
        <div className="flex gap-1">
          {uniqueProviders.length > 1 && (
            <select
              value={providerFilter}
              onChange={(e) => { setProviderFilter(e.target.value); resetActive(); }}
              aria-label={i18nT("providers.allProviders", undefined, "All Providers")}
              className="flex-1 min-w-0 px-2 tap-target text-xs bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              data-testid="provider-filter"
            >
              <option value="">{i18nT("providers.allProviders", undefined, "All Providers")}</option>
              {uniqueProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          {favoritesEnabled && <FavsOnlyToggle pressed={favOnly} onToggle={() => { setFavOnly((v) => !v); resetActive(); }} />}
        </div>
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => { setFilter(e.target.value); resetActive(); }}
          onKeyDown={handleKeyDown}
          placeholder={filterLabel}
          aria-label={filterLabel}
          role="combobox"
          aria-haspopup="grid"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          className="w-full px-2 tap-target text-xs bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
          data-testid="model-filter"
        />
      </div>

      <ModelGrid listRef={listRef} listId={listId} providerGroups={providerGroups} flat={flat} renderRow={renderRow} />

      <RefreshErrorsFooter failCount={failCount} onOpenProviderSettings={onOpenProviderSettings} />
    </>
  );
}

/** One role row from `GET /api/roles` (live group) — only the fields the picker reads. */
export interface PickerRoleRow {
  role: string;
  assigned: boolean;
  model?: string;
  thinkingLevel?: string;
}

/**
 * Roles for the Role tab. `rows === null` → roles plugin absent/unreachable
 * (no tab). Fetches on mount and again on every open so a preset switch made
 * elsewhere is never stale. See change: add-role-aware-model-refs (D8).
 */
function useRoleRows(enabled: boolean, open: boolean): PickerRoleRow[] | null {
  const [rows, setRows] = useState<PickerRoleRow[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/roles");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { data?: Array<{ preset: string | null; roles: PickerRoleRow[] }> };
        const live = body.data?.find((g) => g.preset === null) ?? body.data?.[0];
        if (!cancelled) setRows(live?.roles ?? []);
      } catch {
        if (!cancelled) setRows(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, open]);
  return enabled ? rows : null;
}

/** Visible strings `RoleRef` takes from its host (translated here). */
function roleRefLabels(): RoleRefLabels {
  return {
    noModel: i18nT("common.noModelAssigned", undefined, "No model assigned"),
    from: i18nT("common.roleRefFrom", undefined, "from"),
    thinking: i18nT("common.roleRefThinking", undefined, "thinking"),
  };
}

/** Trigger content: a pending spinner, a followed role ref, a one-shot "from @role", or the plain model. */
function TriggerValue({
  current,
  pendingModel,
  viaRole,
  roleRows,
  placeholder,
}: {
  current?: string;
  pendingModel: string | null;
  viaRole?: string;
  roleRows: PickerRoleRow[] | null;
  placeholder?: string;
}) {
  if (pendingModel) {
    return (
      <span className="font-mono truncate max-w-[260px]">
        {pendingModel} <Icon path={mdiLoading} size={0.4} className="inline animate-spin" aria-hidden />
      </span>
    );
  }
  const refMatch = current ? /^@([^:]+)(?::(.+))?$/.exec(current) : null;
  if (refMatch) {
    const row = roleRows?.find((r) => r.role === refMatch[1]);
    const model = row?.assigned ? row.model : undefined;
    return (
      <span className="min-w-0 max-w-[280px] inline-flex" data-testid="model-trigger-role-ref">
        <RoleRef
          role={`@${refMatch[1]}`}
          model={model}
          level={refMatch[2] ?? row?.thinkingLevel}
          resolving={roleRows === null}
          labels={roleRefLabels()}
        />
      </span>
    );
  }
  if (current && viaRole) {
    return (
      <span className="min-w-0 max-w-[280px] inline-flex">
        <RoleRef role={viaRole} model={current} mode="once" labels={roleRefLabels()} testIds={{ from: "model-via-role" }} />
      </span>
    );
  }
  return <span className="font-mono truncate max-w-[260px]">{current ?? placeholder ?? "no model"}</span>;
}

function RoleTabs({ tab, setTab, baseId }: { tab: "model" | "role"; setTab: (t: "model" | "role") => void; baseId: string }) {
  const tabs = [
    { id: "model" as const, label: i18nT("common.modelsTab", undefined, "Models") },
    { id: "role" as const, label: i18nT("common.rolesTab", undefined, "Roles") },
  ];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = tab === "model" ? "role" : "model";
      setTab(next);
      // WAI-ARIA tabs: the arrow key moves focus with the selection.
      e.currentTarget.querySelector<HTMLElement>(`[data-testid="model-tab-${next}"]`)?.focus();
    }
  };
  return (
    <div role="tablist" aria-label={i18nT("common.modelOrRole", undefined, "Model or role")} className="flex gap-1 p-1.5 pb-0" onKeyDown={onKey}>
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          id={`${baseId}-tab-${x.id}`}
          aria-selected={tab === x.id}
          aria-controls={`${baseId}-panel-${x.id}`}
          tabIndex={tab === x.id ? 0 : -1}
          data-testid={`model-tab-${x.id}`}
          onClick={() => setTab(x.id)}
          className={`focus-ring px-3 tap-target text-xs font-semibold rounded ${
            tab === x.id ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          }`}
        >
          {x.label}
        </button>
      ))}
    </div>
  );
}

function RoleList({ rows, current, onPick, baseId }: { rows: PickerRoleRow[]; current?: string; onPick: (role: string) => void; baseId: string }) {
  const currentRole = current?.startsWith("@") ? /^@([^:]+)/.exec(current)?.[1] : undefined;
  const labels = roleRefLabels();
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-role-item]"));
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
    items[next]?.focus();
  };
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-role`}
      aria-labelledby={`${baseId}-tab-role`}
      className="flex-1 min-h-0 overflow-y-auto py-1"
      data-testid="role-list"
      onKeyDown={move}
    >
      {rows.length === 0 && (
        <p className="m-0 px-3 py-2 text-xs text-[var(--text-secondary)]">
          {i18nT("common.noRolesHelp", undefined, "No roles defined yet. Assign models to roles in Settings → Roles.")}
        </p>
      )}
      {rows.map((r) => {
        const isCurrent = r.role === currentRole;
        return (
          <button
            key={r.role}
            type="button"
            data-role-item
            data-testid="role-row"
            data-role={r.role}
            aria-current={isCurrent ? "true" : undefined}
            onClick={() => onPick(r.role)}
            className={`focus-ring w-full px-3 py-1 tap-target text-left text-xs flex items-center gap-2 hover:bg-[var(--bg-hover)] ${
              isCurrent ? "bg-[var(--bg-tertiary)]" : ""
            }`}
          >
            <span className="w-4 flex-none inline-flex justify-center text-[var(--text-primary)]">
              {isCurrent && <Icon path={mdiCheck} size={0.55} aria-hidden />}
            </span>
            <RoleRef
              role={`@${r.role}`}
              model={r.assigned ? r.model : undefined}
              level={r.assigned ? r.thinkingLevel : undefined}
              labels={labels}
              testIds={{ model: "role-resolution", unassigned: "role-unassigned" }}
            />
          </button>
        );
      })}
    </div>
  );
}

/** One model row (grid row): check slot, model cell, capability cell, ★ cell. */
function ModelRow({
  m,
  rowId,
  starId,
  isCurrent,
  isFav,
  isActive,
  activeCell,
  favoritesEnabled,
  onSelect,
  onToggleFavorite,
}: {
  m: ModelInfo;
  rowId: string;
  starId: string;
  isCurrent: boolean;
  isFav: boolean;
  isActive: boolean;
  activeCell: "model" | "star";
  favoritesEnabled: boolean;
  onSelect: () => void;
  onToggleFavorite?: (makeFavorite: boolean) => void;
}) {
  const label = labelOf(m);
  const display = m.name ?? label;
  const starActive = isActive && activeCell === "star";
  return (
    <div
      id={rowId}
      role="row"
      aria-selected={isCurrent}
      data-model-item
      data-testid="model-row"
      onClick={onSelect}
      className={`w-full pl-2 pr-1 py-1 tap-target text-left text-xs flex items-center gap-2 cursor-pointer ${
        isActive && !starActive ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
      } ${isCurrent ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}
    >
      <span className="w-4 flex-none inline-flex justify-center text-[var(--text-primary)]" aria-hidden="true">
        {isCurrent && <Icon path={mdiCheck} size={0.55} />}
      </span>
      <div role="gridcell" className="flex-1 min-w-0">
        <div className="font-mono truncate">{display}</div>
        {m.name && <div className="font-mono text-[11px] text-[var(--text-secondary)] truncate">{label}</div>}
      </div>
      <div role="gridcell" className="flex items-center gap-1 flex-shrink-0 text-[11px] leading-none">
        <CapBadges m={m} />
        {typeof m.contextWindow === "number" && (
          <span className="px-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">{ctxFmt(m.contextWindow)}</span>
        )}
      </div>
      {favoritesEnabled && (
        <div role="gridcell" id={starId} className={`flex-shrink-0 rounded ${starActive ? "bg-[var(--bg-tertiary)] ring-1 ring-[var(--focus-ring)]" : ""}`}>
          <button
            type="button"
            tabIndex={-1}
            data-testid="model-fav-toggle"
            aria-label={i18nT("common.favoriteModel", { model: display }, `Favorite ${display}`)}
            aria-pressed={isFav}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(!isFav); }}
            className={`inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-[32px] sm:min-h-[32px] ${isFav ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
          >
            <Icon path={isFav ? mdiStar : mdiStarOutline} size={0.6} aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Favorites are the selector's DEFAULT when the caller owns neither prop: read
 * the pair all-or-nothing from the model-config context. Passing either prop
 * makes the caller own BOTH (no mixing with context). No resolvable toggle →
 * no ★ buttons, no Favorites-only filter, persisted favs-only ignored.
 * See change: model-picker-everywhere-favorites (design D1).
 */
function useFavoritesSource(favorites?: string[], onToggleFavorite?: (label: string, makeFavorite: boolean) => void) {
  const modelConfig = useModelConfigOptional();
  const callerOwns = favorites !== undefined || onToggleFavorite !== undefined;
  const effectiveFavorites = callerOwns ? favorites : modelConfig?.favorites;
  const toggle = callerOwns ? onToggleFavorite : modelConfig?.toggleFavorite;
  const favSet = useMemo(() => new Set(effectiveFavorites ?? []), [effectiveFavorites]);
  return { favSet, toggle, favoritesEnabled: toggle !== undefined };
}

/** The model the user just picked, shown with a spinner until the session reports it (10 s safety timeout). */
function usePendingModel(current?: string): [string | null, (label: string) => void] {
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  // Clear pending state when current model updates to match
  useEffect(() => {
    if (pendingModel && current === pendingModel) setPendingModel(null);
  }, [current, pendingModel]);
  // Safety timeout: clear pending after 10s if no update arrives
  useEffect(() => {
    if (!pendingModel) return;
    const timer = setTimeout(() => setPendingModel(null), 10_000);
    return () => clearTimeout(timer);
  }, [pendingModel]);
  return [pendingModel, setPendingModel];
}

/**
 * Combobox + grid keyboard model (APG): DOM focus stays in the filter;
 * `aria-activedescendant` names the active row or, after ArrowRight at the end
 * of the text, the row's ★ cell. See change: retro-ux-model-selector (D5).
 */
function useGridKeyboard({
  flat,
  selectedIndex,
  setSelectedIndex,
  activeCell,
  setActiveCell,
  favoritesEnabled,
  favSet,
  toggleFavorite,
  onPick,
}: {
  flat: ModelInfo[];
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  activeCell: "model" | "star";
  setActiveCell: (c: "model" | "star") => void;
  favoritesEnabled: boolean;
  favSet: Set<string>;
  toggleFavorite?: (label: string, makeFavorite: boolean) => void;
  onPick: (m: ModelInfo) => void;
}) {
  const move = (e: React.KeyboardEvent, delta: number) => {
    e.preventDefault();
    setActiveCell("model");
    setSelectedIndex((i) => Math.max(0, Math.min(i + delta, flat.length - 1)));
  };
  const toStar = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Only at the end of the text; otherwise the arrow moves the caret as in any input.
    const el = e.currentTarget;
    const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (!favoritesEnabled || !flat[selectedIndex] || !atEnd || activeCell !== "model") return;
    e.preventDefault();
    setActiveCell("star");
  };
  const activate = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const active = flat[selectedIndex];
    if (!active) return;
    if (activeCell === "star") toggleFavorite?.(labelOf(active), !favSet.has(labelOf(active)));
    else onPick(active);
  };
  return (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") move(e, 1);
    else if (e.key === "ArrowUp") move(e, -1);
    else if (e.key === "ArrowRight") toStar(e);
    else if (e.key === "ArrowLeft" && activeCell === "star") {
      e.preventDefault();
      setActiveCell("model");
    } else if (e.key === "Enter" || (e.key === " " && activeCell === "star")) activate(e);
  };
}

/** Fixed-position style for the portaled panel, from the flip hook's measurements. */
function panelStyle(pos: {
  flipUp: boolean;
  maxHeight?: number;
  minHeight?: number;
  anchorRight: boolean;
  maxWidth: number;
  triggerRect: DOMRect | null | undefined;
}): React.CSSProperties {
  const { flipUp, maxHeight, minHeight, anchorRight, maxWidth, triggerRect } = pos;
  const style: React.CSSProperties = {
    // Natural width 320px, capped by the pane-aware `maxWidth` (the hook flips
    // before it would squish below `minContentWidth`).
    width: Math.min(320, maxWidth),
    maxHeight,
    minHeight,
    visibility: triggerRect ? "visible" : "hidden",
  };
  if (!triggerRect) return style;
  if (flipUp) style.bottom = Math.round(window.innerHeight - triggerRect.top + GAP);
  else style.top = Math.round(triggerRect.bottom + GAP);
  if (anchorRight) style.right = Math.max(0, Math.round(window.innerWidth - triggerRect.right));
  else style.left = Math.round(triggerRect.left);
  return style;
}

/**
 * Provider filter + Favorites-only (persisted per browser in localStorage) + the
 * text filter, and the provider-grouped result. No separate favorites group —
 * the Favorites only filter is the favorites surface; the per-row star toggles
 * which models are favorites. When favs-only is on, the result already holds
 * only favorites.
 */
function useCatalogueView(models: ModelInfo[] | undefined, favoritesEnabled: boolean, favSet: Set<string>) {
  const [filter, setFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>(() => readLS(PROVIDER_FILTER_KEY));
  const [favOnly, setFavOnly] = useState<boolean>(() => readLS(FAV_ONLY_KEY) === "1");
  useEffect(() => { writeLS(PROVIDER_FILTER_KEY, providerFilter); }, [providerFilter]);
  useEffect(() => { writeLS(FAV_ONLY_KEY, favOnly ? "1" : "0"); }, [favOnly]);

  const hasModels = !!models && models.length > 0;
  const uniqueProviders = useMemo(
    () => (hasModels ? [...new Set(models!.map((m) => m.provider))].sort() : []),
    [hasModels, models],
  );
  // Models passing provider + text + favs-only filters.
  const visible = useMemo(() => {
    if (!hasModels) return [] as ModelInfo[];
    const tokens = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return models!.filter((m) => {
      if (providerFilter && m.provider !== providerFilter) return false;
      if (favoritesEnabled && favOnly && !favSet.has(labelOf(m))) return false;
      const full = labelOf(m).toLowerCase();
      return tokens.length === 0 || tokens.every((t) => full.includes(t));
    });
  }, [hasModels, models, providerFilter, favOnly, favoritesEnabled, filter, favSet]);
  const { providerGroups, flat } = useMemo(() => {
    const groups = uniqueProviders
      .map((p) => ({ provider: p, items: visible.filter((m) => m.provider === p) }))
      .filter((g) => g.items.length > 0);
    return { providerGroups: groups, flat: groups.flatMap((g) => g.items) };
  }, [visible, uniqueProviders]);
  return { filter, setFilter, providerFilter, setProviderFilter, favOnly, setFavOnly, hasModels, uniqueProviders, providerGroups, flat };
}

/**
 * Close on outside click / touch. The panel is PORTALED to the layer root, so it
 * is no longer a DOM descendant of the container — every in-panel mousedown
 * would otherwise read as "outside" and close the menu before a selection
 * registers. The panel is checked FIRST: the trigger toggles, so letting a panel
 * click fall through to it would close-then-reopen.
 * See change: fix-composer-popover-layering (pattern: FolderActionsMenu).
 */
function useDismissOutside(open: boolean, panelRef: React.RefObject<HTMLElement | null>, triggerRef: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: Event) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, panelRef, triggerRef, close]);
}

export function ModelSelector({ current, models, onSelect, onRefresh, refreshErrors, onOpenProviderSettings, favorites, onToggleFavorite, placeholder, disabled, allowRoles, viaRole }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Which cell of the active row the combobox's `aria-activedescendant` points at.
  const [activeCell, setActiveCell] = useState<"model" | "star">("model");
  const [pendingModel, setPendingModel] = usePendingModel(current);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dropdownId = useId();
  const listId = `${dropdownId}-grid`;
  const roleRows = useRoleRows(allowRoles === true, open);
  const rolesAvailable = roleRows !== null;
  const [tab, setTab] = useState<"model" | "role">("model");
  // Opt into the horizontal axis, left-preserving: this `left-0` 320px dropdown
  // must flip (not silently swap to right-0) when its composer pane is too
  // narrow, and flip rather than squish its dense provider/model grid below
  // ~280px. `boundaryRef` is the composer/chat pane when rendered there (else
  // viewport). See change: fix-popover-container-clip.
  const boundaryRef = usePopoverBoundary();
  const { flipUp, maxHeight, minHeight, anchorRight, maxWidth, triggerRect } = usePopoverFlip(triggerRef, {
    open,
    estimatedWidth: 320, // 20rem natural width
    minContentWidth: 280, // readable floor for the provider/model grid
    preferredAnchor: "left",
    boundaryRef,
    // Filterable list: typing narrows it to a couple of rows, so it needs the
    // generous floor rather than collapsing to a sliver.
    // See change: fix-popover-pane-bounded-height.
    minPopoverHeight: LIST_POPOVER_MIN_HEIGHT,
  });

  const { favSet, toggle: effectiveToggle, favoritesEnabled } = useFavoritesSource(favorites, onToggleFavorite);

  const { filter, setFilter, providerFilter, setProviderFilter, favOnly, setFavOnly, hasModels, uniqueProviders, providerGroups, flat } =
    useCatalogueView(models, favoritesEnabled, favSet);

  // Opening is the ONLY refresh trigger; the hook also reports the awaiting
  // window that gates the empty-state recovery link.
  const awaitingRefresh = useOpenTriggeredRefresh(open, models, onRefresh);

  // Reset transient state when opening. Provider filter + favs-only PERSIST
  // (they're sticky view modes); only the text filter clears.
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedIndex(0);
      setActiveCell("model");
      setTab(current?.startsWith("@") ? "role" : "model");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);
  useDismissOutside(open, panelRef, triggerRef, close);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-model-item]");
    items[selectedIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex]);

  const resetActive = useCallback(() => {
    setSelectedIndex(0);
    setActiveCell("model");
  }, []);

  const handleSelect = useCallback(
    (m: ModelInfo) => {
      const label = labelOf(m);
      setPendingModel(label);
      onSelect(label);
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onSelect, setPendingModel],
  );

  const handleRolePick = useCallback(
    (role: string) => {
      onSelect(`@${role}`);
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [onSelect],
  );

  const handleKeyDown = useGridKeyboard({
    flat,
    selectedIndex,
    setSelectedIndex,
    activeCell,
    setActiveCell,
    favoritesEnabled,
    favSet,
    toggleFavorite: effectiveToggle,
    onPick: handleSelect,
  });

  // Escape closes from anywhere in the panel and returns focus to the trigger
  // (the popover is non-modal: no focus trap).
  const handlePanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Renders one model row. `flatIdx` is the keyboard-nav index into `flat`.
  const renderRow = (m: ModelInfo, flatIdx: number) => {
    const label = labelOf(m);
    return (
      <ModelRow
        key={label}
        m={m}
        rowId={`${listId}-row-${flatIdx}`}
        starId={`${listId}-star-${flatIdx}`}
        isCurrent={label === current}
        isFav={favSet.has(label)}
        isActive={flatIdx === selectedIndex}
        activeCell={activeCell}
        favoritesEnabled={favoritesEnabled}
        onSelect={() => handleSelect(m)}
        onToggleFavorite={(makeFav) => effectiveToggle?.(label, makeFav)}
      />
    );
  };

  const failCount = refreshErrors?.length ?? 0;
  const activeRowExists = flat[selectedIndex] !== undefined;
  const activeDescendant = activeRowExists
    ? activeCell === "star" && favoritesEnabled
      ? `${listId}-star-${selectedIndex}`
      : `${listId}-row-${selectedIndex}`
    : undefined;

  // A disabled trigger (e.g. the run-config launch row while models load) reads
  // as inert — no hover affordance. An openable trigger keeps hover, even with
  // an empty catalogue (the composer recovery path). `--text-muted` is only
  // allowed on the disabled variant. See changes: open-empty-model-selector,
  // retro-ux-model-selector.
  const triggerClass = disabled
    ? "text-[var(--text-muted)]"
    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";

  return (
    <div ref={containerRef} className="relative" data-testid="model-selector">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        className={`focus-ring flex items-center gap-1 text-xs px-2 tap-target rounded ${triggerClass}`}
        disabled={disabled}
        data-testid="model-selector-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dropdownId : undefined}
      >
        <TriggerValue current={current} pendingModel={pendingModel} viaRole={viaRole} roleRows={roleRows} placeholder={placeholder} />
        {!pendingModel && !disabled && <Icon path={mdiChevronDown} size={0.5} aria-hidden />}
      </button>

      {open && (
        // Portaled to the layer root (escapes the composer's stacking context
        // + overflow clip — the underlap fix) and positioned `fixed` from the
        // trigger's viewport rect. GAP replaces the mt-1/mb-1 a portaled panel
        // has no flow sibling to get; `visibility` hides the pre-measure frame
        // so the panel never flashes at (0,0). See change:
        // fix-composer-popover-layering (pattern: FolderActionsMenu).
        <LayerPortal>
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label={i18nT("common.chooseModel", undefined, "Choose a model")}
            onKeyDown={handlePanelKeyDown}
            className="fixed flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-popover overflow-hidden"
            style={panelStyle({ flipUp, maxHeight, minHeight, anchorRight, maxWidth, triggerRect })}
            data-testid="model-dropdown"
            id={dropdownId}
          >
          {rolesAvailable && <RoleTabs tab={tab} setTab={setTab} baseId={dropdownId} />}
          {rolesAvailable && tab === "role" ? (
            <RoleList rows={roleRows} current={current} onPick={handleRolePick} baseId={dropdownId} />
          ) : (
            <div
              role={rolesAvailable ? "tabpanel" : undefined}
              id={rolesAvailable ? `${dropdownId}-panel-model` : undefined}
              aria-labelledby={rolesAvailable ? `${dropdownId}-tab-model` : undefined}
              className="flex flex-col flex-1 min-h-0"
            >
              {hasModels ? (
                <PopulatedCatalogueBody
                  filter={filter}
                  setFilter={setFilter}
                  favOnly={favOnly}
                  setFavOnly={setFavOnly}
                  favoritesEnabled={favoritesEnabled}
                  providerFilter={providerFilter}
                  setProviderFilter={setProviderFilter}
                  resetActive={resetActive}
                  uniqueProviders={uniqueProviders}
                  providerGroups={providerGroups}
                  flat={flat}
                  inputRef={inputRef}
                  listRef={listRef}
                  listId={listId}
                  activeDescendant={activeDescendant}
                  handleKeyDown={handleKeyDown}
                  renderRow={renderRow}
                  failCount={failCount}
                  onOpenProviderSettings={onOpenProviderSettings}
                />
              ) : (
                <EmptyCatalogueBody awaitingRefresh={awaitingRefresh} onOpenProviderSettings={onOpenProviderSettings} />
              )}
            </div>
          )}
          </div>
        </LayerPortal>
      )}
    </div>
  );
}
