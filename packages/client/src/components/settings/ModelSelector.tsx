import type { ProviderRefreshError } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { ModelInfo, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertOutline, mdiBrain, mdiChevronDown, mdiCog, mdiEye, mdiLoading, mdiStar, mdiStarOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { LIST_POPOVER_MIN_HEIGHT, usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
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

/**
 * One capability icon (MDI) with optional uncertainty `?` overlay.
 * Uses real MDI glyphs (not emoji) so it renders consistently across browsers.
 */
function CapIcon({ path, uncertain, title }: { path: string; uncertain?: boolean; title: string }) {
  return (
    <span className="relative inline-flex items-center text-[var(--text-muted)]" title={title}>
      <Icon path={path} size={0.45} />
      {uncertain && <b className="text-[var(--text-muted)] text-[9px] leading-none -ml-0.5 -mt-1">?</b>}
    </span>
  );
}

/**
 * Capability icons with honest confidence:
 *   - reasoning:true  → brain icon (purple)
 *   - vision:true     → eye icon (green)
 *   - metadataSource "fallback" → muted eye? + brain? (assumed; provider gave no signal)
 *   - no capability fields → nothing rendered
 */
function CapBadges({ m }: { m: ModelInfo }) {
  if (m.metadataSource === "fallback") {
    // Provider reported nothing: vision force-assumed, reasoning unknown.
    return (
      <>
        <CapIcon path={mdiEye} uncertain title={i18nT("providers.visionAssumedProviderReportedNoCapabi", undefined, "Vision assumed — provider reported no capabilities; image input defaulted on")} />
        <CapIcon path={mdiBrain} uncertain title={i18nT("providers.reasoningUnknownProviderReportedNone", undefined, "Reasoning unknown — provider reported none")} />
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

/**
 * Shared recovery link → Settings → Providers (gear icon, no directional
 * arrow). Rendered only when a navigation handler is wired.
 * See change: open-empty-model-selector.
 */
function ProviderSettingsLink({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      data-testid="model-provider-settings-link"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[var(--accent-blue)] hover:underline"
    >
      <Icon path={mdiCog} size={0.55} className="flex-shrink-0" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Empty-catalogue popover body: a transient refreshing line while the
 * open-triggered refresh is in flight, then "no models available" + the
 * provider-settings recovery link once the refresh has completed empty.
 * See change: open-empty-model-selector (D4-A, D5-B).
 */
function EmptyCatalogueBody({
  awaitingRefresh,
  failCount,
  onOpenProviderSettings,
}: {
  awaitingRefresh: boolean;
  failCount: number;
  onOpenProviderSettings?: () => void;
}) {
  if (awaitingRefresh) {
    return (
      <div className="px-3 py-4 flex flex-col items-start gap-2 text-xs" data-testid="model-empty">
        <div className="flex items-center gap-1.5 text-[var(--text-muted)]" data-testid="model-empty-refreshing">
          <Icon path={mdiLoading} size={0.6} className="animate-spin" />
          <span>{i18nT("common.refreshingModels", undefined, "Refreshing models…")}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="px-3 py-4 flex flex-col items-start gap-2 text-xs" data-testid="model-empty">
      <div className="text-[var(--text-secondary)]">{i18nT("common.noModelsAvailable", undefined, "No models available")}</div>
      <ProviderSettingsLink
        label={i18nT("common.openProviderSettings", undefined, "Open provider settings")}
        onClick={onOpenProviderSettings}
      />
      {failCount > 0 && (
        <div className="text-[10px] text-[var(--text-muted)]">
          {i18nT("common.reopenToRetry", undefined, "Close and reopen to retry the refresh.")}
        </div>
      )}
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

/**
 * Populated-catalogue popover body: provider/favs filters, the text filter, the
 * grouped model list, and the thin partial-failure footer. Extracted so its
 * nested conditionals live in their own scope (keeps ModelSelector's cognitive
 * complexity in budget). See change: open-empty-model-selector.
 */
function PopulatedCatalogueBody({
  filter,
  setFilter,
  favOnly,
  setFavOnly,
  providerFilter,
  setProviderFilter,
  setSelectedIndex,
  uniqueProviders,
  providerGroups,
  flat,
  inputRef,
  listRef,
  handleKeyDown,
  renderRow,
  failCount,
  onOpenProviderSettings,
}: {
  filter: string;
  setFilter: (v: string) => void;
  favOnly: boolean;
  setFavOnly: (updater: (v: boolean) => boolean) => void;
  providerFilter: string;
  setProviderFilter: (v: string) => void;
  setSelectedIndex: (v: number) => void;
  uniqueProviders: string[];
  providerGroups: Array<{ provider: string; items: ModelInfo[] }>;
  flat: ModelInfo[];
  inputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  renderRow: (m: ModelInfo, flatIdx: number) => React.ReactNode;
  failCount: number;
  onOpenProviderSettings?: () => void;
}) {
  // Running flat index so grouped rows map to the same order as `flat`.
  let cursor = -1;
  const nextIdx = () => (cursor += 1);
  return (
    <>
      {/* ── Filters ── */}
      <div className="p-1.5 pb-1 space-y-1">
        <div className="flex gap-1">
          {uniqueProviders.length > 1 && (
            <select
              value={providerFilter}
              onChange={(e) => { setProviderFilter(e.target.value); setSelectedIndex(0); }}
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              data-testid="provider-filter"
            >
              <option value="">{i18nT("providers.allProviders", undefined, "All Providers")}</option>
              {uniqueProviders.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            data-testid="favs-only-toggle"
            aria-pressed={favOnly}
            onClick={() => { setFavOnly((v) => !v); setSelectedIndex(0); }}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded border whitespace-nowrap ${
              favOnly
                ? "text-amber-400 border-amber-400"
                : "text-[var(--text-secondary)] border-[var(--border-primary)] bg-[var(--bg-tertiary)]"
            }`}
          >
            <Icon path={favOnly ? mdiStar : mdiStarOutline} size={0.55} /> {i18nT("common.favs", undefined, "Favs")}
          </button>
        </div>
        <input
          ref={inputRef}
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder={i18nT("common.filterModels", undefined, "Filter models…")}
          className="w-full px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
          data-testid="model-filter"
        />
      </div>

      {/* ── Grouped list ── */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
        {flat.length === 0 ? (
          <div className="px-3 py-2 text-xs text-[var(--text-muted)]">{i18nT("common.noModelsMatch", undefined, "No models match")}</div>
        ) : (
          providerGroups.map((g) => (
            <React.Fragment key={g.provider}>
              <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] bg-[var(--bg-primary)] sticky top-0" data-testid="group-provider">{g.provider}</div>
              {g.items.map((m) => renderRow(m, nextIdx()))}
            </React.Fragment>
          ))
        )}
      </div>

      {/* ── Footer: thin partial-failure hint (count only; names live in
          Settings → Providers). See change: open-empty-model-selector (D1-B). ── */}
      {failCount > 0 && (
        <div
          className="border-t border-[var(--border-secondary)] px-2 py-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"
          data-testid="model-refresh-errors"
        >
          <Icon path={mdiAlertOutline} size={0.55} className="flex-shrink-0" />
          <span>
            {i18nT(
              "common.modelProvidersUnavailable",
              { count: failCount },
              `${failCount} ${failCount === 1 ? "provider" : "providers"} unavailable`,
            )}
          </span>
          <span className="ml-auto">
            <ProviderSettingsLink label={i18nT("common.providers", undefined, "Providers")} onClick={onOpenProviderSettings} />
          </span>
        </div>
      )}
    </>
  );
}

export function ModelSelector({ current, models, onSelect, onRefresh, refreshErrors, onOpenProviderSettings, favorites, onToggleFavorite, placeholder, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  // Persistent per-browser view state (restored from localStorage on mount).
  const [providerFilter, setProviderFilter] = useState<string>(() => readLS(PROVIDER_FILTER_KEY));
  const [favOnly, setFavOnly] = useState<boolean>(() => readLS(FAV_ONLY_KEY) === "1");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownId = useId();
  // Opt into the horizontal axis, left-preserving: this `left-0` 320px dropdown
  // must flip (not silently swap to right-0) when its composer pane is too
  // narrow, and flip rather than squish its dense provider/model grid below
  // ~280px. `boundaryRef` is the composer/chat pane when rendered there (else
  // viewport). See change: fix-popover-container-clip.
  const boundaryRef = usePopoverBoundary();
  const { flipUp, maxHeight, minHeight, anchorRight, maxWidth } = usePopoverFlip(triggerRef, {
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

  const hasModels = !!models && models.length > 0;
  const favSet = useMemo(() => new Set(favorites ?? []), [favorites]);

  // Persist view state on change.
  useEffect(() => { writeLS(PROVIDER_FILTER_KEY, providerFilter); }, [providerFilter]);
  useEffect(() => { writeLS(FAV_ONLY_KEY, favOnly ? "1" : "0"); }, [favOnly]);

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

  // Opening is the ONLY refresh trigger; the hook also reports the awaiting
  // window that gates the empty-state recovery link.
  const awaitingRefresh = useOpenTriggeredRefresh(open, models, onRefresh);

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
      if (favOnly && !favSet.has(labelOf(m))) return false;
      const full = labelOf(m).toLowerCase();
      return tokens.length === 0 || tokens.every((t) => full.includes(t));
    });
  }, [hasModels, models, providerFilter, favOnly, filter, favSet]);

  // Group by provider only. No separate favorites group — the ★ Favs filter
  // (persisted in localStorage) is the favorites surface; the per-row star
  // toggles which models are favorites. When favs-only is on, `visible`
  // already contains only favorites.
  const { providerGroups, flat } = useMemo(() => {
    const groups = uniqueProviders
      .map((p) => ({ provider: p, items: visible.filter((m) => m.provider === p) }))
      .filter((g) => g.items.length > 0);
    return { providerGroups: groups, flat: groups.flatMap((g) => g.items) };
  }, [visible, uniqueProviders]);

  // Reset transient state when opening. Provider filter + favs-only PERSIST
  // (they're sticky view modes); only the text filter clears.
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-model-item]");
    items[selectedIndex]?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (m: ModelInfo) => {
      const label = labelOf(m);
      setPendingModel(label);
      onSelect(label);
      setOpen(false);
    },
    [onSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[selectedIndex]) handleSelect(flat[selectedIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Renders one model row. `flatIdx` is the keyboard-nav index into `flat`.
  const renderRow = (m: ModelInfo, flatIdx: number) => {
    const label = labelOf(m);
    const isCurrent = label === current;
    const isFav = favSet.has(label);
    return (
      <div
        key={label}
        data-model-item
        data-testid="model-row"
        onClick={() => handleSelect(m)}
        className={`w-full pl-2 pr-3 py-1 min-h-[44px] md:min-h-0 text-left text-xs flex items-center gap-2 cursor-pointer ${
          flatIdx === selectedIndex ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
        } ${isCurrent ? "text-[var(--accent-blue)]" : "text-[var(--text-secondary)]"}`}
      >
        <button
          type="button"
          data-testid="model-fav-toggle"
          aria-label={isFav ? "Unfavorite" : "Favorite"}
          aria-pressed={isFav}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(label, !isFav); }}
          className={`flex-shrink-0 ${isFav ? "text-amber-400" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}
        >
          <Icon path={isFav ? mdiStar : mdiStarOutline} size={0.6} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-mono truncate">{m.name ?? label}</div>
          {m.name && <div className="font-mono text-[10px] text-[var(--text-muted)] truncate">{label}</div>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 text-[11px] leading-none">
          <CapBadges m={m} />
          {typeof m.contextWindow === "number" && (
            <span className="px-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">{ctxFmt(m.contextWindow)}</span>
          )}
        </div>
      </div>
    );
  };

  const failCount = refreshErrors?.length ?? 0;

  // A disabled trigger (e.g. the run-config launch row while models load) reads
  // as inert — muted, no hover affordance. An openable trigger keeps hover, even
  // with an empty catalogue (the composer recovery path).
  // See change: open-empty-model-selector.
  let triggerClass: string;
  if (disabled) {
    triggerClass = "text-[var(--text-muted)]";
  } else if (hasModels) {
    triggerClass = "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
  } else {
    triggerClass = "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]";
  }

  return (
    <div ref={containerRef} className="relative" data-testid="model-selector">
      <button
        ref={triggerRef}
        onClick={() => !disabled && setOpen(!open)}
        className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded ${triggerClass}`}
        disabled={disabled}
        data-testid="model-selector-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? dropdownId : undefined}
      >
        <span className="font-mono truncate max-w-[200px]">
          {pendingModel ? (
            <>
              {pendingModel} <Icon path={mdiLoading} size={0.4} className="inline animate-spin" />
            </>
          ) : (
            current ?? placeholder ?? "no model"
          )}
        </span>
        {!pendingModel && !disabled && <Icon path={mdiChevronDown} size={0.5} />}
      </button>

      {open && (
        <div
          className={`absolute flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg shadow-lg z-50 overflow-hidden ${
            anchorRight ? "right-0" : "left-0"
          } ${flipUp ? "bottom-full mb-1" : "top-full mt-1"}`}
          // Natural width 320px, capped by the pane-aware `maxWidth` (the hook
          // flips before it would squish below `minContentWidth`).
          style={{ width: Math.min(320, maxWidth), maxHeight, minHeight }}
          data-testid="model-dropdown"
          id={dropdownId}
        >
          {hasModels ? (
            <PopulatedCatalogueBody
              filter={filter}
              setFilter={setFilter}
              favOnly={favOnly}
              setFavOnly={setFavOnly}
              providerFilter={providerFilter}
              setProviderFilter={setProviderFilter}
              setSelectedIndex={setSelectedIndex}
              uniqueProviders={uniqueProviders}
              providerGroups={providerGroups}
              flat={flat}
              inputRef={inputRef}
              listRef={listRef}
              handleKeyDown={handleKeyDown}
              renderRow={renderRow}
              failCount={failCount}
              onOpenProviderSettings={onOpenProviderSettings}
            />
          ) : (
            <EmptyCatalogueBody awaitingRefresh={awaitingRefresh} failCount={failCount} onOpenProviderSettings={onOpenProviderSettings} />
          )}
        </div>
      )}
    </div>
  );
}
