import React, { useMemo, useRef, useState, useEffect } from "react";
import { Icon } from "@mdi/react";
import { mdiChevronDown, mdiChevronRight } from "@mdi/js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useModelVisibility } from "../hooks/useModelVisibility.js";
import {
  countHidden,
  isModelHidden,
  tokenMatch,
} from "../lib/model-visibility.js";

interface Props {
  /** May be undefined while the dashboard is still bootstrapping the model list. */
  models?: ModelInfo[];
}

/**
 * Settings → General → Hidden Models section.
 *
 * Two collapsible subsections:
 *   - Providers: 1 toggle per provider, hides all of its models.
 *   - Individual Models: per-provider groups (each collapsed by default; auto-
 *     expanded when a search has matches). Each group header has a tri-state
 *     "select all" checkbox that hides/unhides every model in the group at
 *     once. When a search is active, a section-level "Hide all matching" /
 *     "Unhide all matching" button operates on the entire filtered set.
 *
 * Models whose provider is hidden render muted + disabled.
 *
 * See change: hide-models-from-selector.
 */
export function HiddenModelsSection({ models }: Props) {
  const { vis, update } = useModelVisibility();
  const [providersOpen, setProvidersOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const safeModels = models ?? [];

  // Group models by provider for both subsections; sorted alphabetically.
  const byProvider = useMemo(() => {
    const m = new Map<string, ModelInfo[]>();
    for (const x of safeModels) {
      const arr = m.get(x.provider) ?? [];
      arr.push(x);
      m.set(x.provider, arr);
    }
    for (const [, arr] of m) {
      arr.sort((a, b) =>
        `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`),
      );
    }
    return new Map([...m].sort(([a], [b]) => a.localeCompare(b)));
  }, [safeModels]);

  const providers = useMemo(() => [...byProvider.keys()], [byProvider]);

  const totalHidden = useMemo(() => countHidden(safeModels, vis), [safeModels, vis]);

  // Per-group filtered model lists for the Individual Models subsection.
  const filteredByProvider = useMemo(() => {
    const m = new Map<string, ModelInfo[]>();
    for (const [provider, list] of byProvider.entries()) {
      const visible = search
        ? list.filter((x) => tokenMatch(`${x.provider}/${x.id}`, search))
        : list;
      m.set(provider, visible);
    }
    return m;
  }, [byProvider, search]);

  const hasActiveSearch = search.trim().length > 0;

  // Flat list of models that are currently visible across every provider — used
  // by the section-level "Hide/Unhide all matching" button when a search is on.
  const filteredModels = useMemo(() => {
    const out: ModelInfo[] = [];
    for (const arr of filteredByProvider.values()) out.push(...arr);
    return out;
  }, [filteredByProvider]);

  const toggleProvider = (provider: string): void => {
    const next = vis.hiddenProviders.includes(provider)
      ? vis.hiddenProviders.filter((p) => p !== provider)
      : [...vis.hiddenProviders, provider];
    update({ hiddenProviders: next });
  };

  const toggleModel = (m: ModelInfo): void => {
    const key = `${m.provider}/${m.id}`;
    const next = vis.hiddenModels.includes(key)
      ? vis.hiddenModels.filter((x) => x !== key)
      : [...vis.hiddenModels, key];
    update({ hiddenModels: next });
  };

  const toggleGroupOpen = (provider: string): void => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(provider)) next.delete(provider);
      else next.add(provider);
      return next;
    });
  };

  /**
   * Set the hidden-state of every model in `targets` to `hide`.
   * Provider-hidden models (covered by `vis.hiddenProviders`) are skipped —
   * they are already hidden inherently and the per-model toggle is disabled.
   */
  const bulkSetHidden = (targets: ModelInfo[], hide: boolean): void => {
    const nextSet = new Set(vis.hiddenModels);
    for (const m of targets) {
      if (vis.hiddenProviders.includes(m.provider)) continue;
      const key = `${m.provider}/${m.id}`;
      if (hide) nextSet.add(key);
      else nextSet.delete(key);
    }
    update({ hiddenModels: [...nextSet] });
  };

  // For each group, compute aggregate state of its non-provider-hidden models:
  // - allHidden: every model has its full id in hiddenModels.
  // - someHidden: at least one model is in hiddenModels but not all.
  // Provider-hidden groups report "all hidden" trivially (every model is
  // covered) — the checkbox is disabled there anyway.
  const groupState = (provider: string, list: ModelInfo[]): {
    allHidden: boolean;
    someHidden: boolean;
  } => {
    if (vis.hiddenProviders.includes(provider)) {
      return { allHidden: true, someHidden: false };
    }
    if (list.length === 0) return { allHidden: false, someHidden: false };
    let hiddenCount = 0;
    for (const m of list) {
      if (vis.hiddenModels.includes(`${m.provider}/${m.id}`)) hiddenCount++;
    }
    return {
      allHidden: hiddenCount === list.length,
      someHidden: hiddenCount > 0 && hiddenCount < list.length,
    };
  };

  return (
    <div data-testid="hidden-models-section">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        Hidden Models
      </h2>
      <p
        className="text-xs text-[var(--text-secondary)] mb-3"
        data-testid="hidden-models-summary"
      >
        {totalHidden} model{totalHidden === 1 ? "" : "s"} hidden across{" "}
        {vis.hiddenProviders.length} provider
        {vis.hiddenProviders.length === 1 ? "" : "s"}
      </p>

      {/* ── Providers subsection ── */}
      <div className="mb-3">
        <button
          onClick={() => setProvidersOpen((o) => !o)}
          className="flex items-center gap-1 text-xs uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors w-full"
          data-testid="providers-subsection-toggle"
        >
          <Icon path={providersOpen ? mdiChevronDown : mdiChevronRight} size={0.6} />
          <span>Providers ({providers.length})</span>
        </button>
        {providersOpen && (
          <div className="mt-2 space-y-1 pl-4">
            {providers.map((p) => {
              const isHidden = vis.hiddenProviders.includes(p);
              const count = byProvider.get(p)?.length ?? 0;
              return (
                <div
                  key={p}
                  className="flex items-center justify-between"
                  data-testid={`provider-row-${p}`}
                >
                  <label className="text-sm text-[var(--text-secondary)]">
                    {p}{" "}
                    <span className="text-xs text-[var(--text-muted)]">
                      ({count} model{count === 1 ? "" : "s"})
                    </span>
                  </label>
                  <button
                    onClick={() => toggleProvider(p)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      isHidden ? "bg-blue-600" : "bg-[var(--bg-tertiary)]"
                    }`}
                    aria-pressed={isHidden}
                    data-testid={`provider-toggle-${p}`}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        isHidden ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
            {providers.length === 0 && (
              <p className="text-xs text-[var(--text-muted)]">No providers known yet.</p>
            )}
          </div>
        )}
      </div>

      {/* ── Individual Models subsection ── */}
      <div>
        <button
          onClick={() => setModelsOpen((o) => !o)}
          className="flex items-center gap-1 text-xs uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors w-full"
          data-testid="models-subsection-toggle"
        >
          <Icon path={modelsOpen ? mdiChevronDown : mdiChevronRight} size={0.6} />
          <span>Individual Models ({safeModels.length})</span>
        </button>
        {modelsOpen && (
          <div className="mt-2 pl-4 space-y-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search models…"
              className="w-full px-2 py-1 text-xs bg-[var(--bg-tertiary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
              data-testid="models-search"
            />

            {/* Bulk action when a search is active — operates on the entire
                filtered set across all providers. */}
            {hasActiveSearch && filteredModels.length > 0 && (
              <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                <span>
                  {filteredModels.length} match{filteredModels.length === 1 ? "" : "es"}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => bulkSetHidden(filteredModels, true)}
                    className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    data-testid="hide-all-matching"
                  >
                    Hide all matching
                  </button>
                  <button
                    onClick={() => bulkSetHidden(filteredModels, false)}
                    className="px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    data-testid="unhide-all-matching"
                  >
                    Unhide all matching
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {[...filteredByProvider.entries()].map(([provider, visible]) => {
                if (visible.length === 0) return null;
                const providerHidden = vis.hiddenProviders.includes(provider);
                // When a search is active and this group has matches, expand
                // automatically so the user sees the hits.
                const isOpen = hasActiveSearch || openGroups.has(provider);
                const totalInGroup = byProvider.get(provider)?.length ?? 0;
                const { allHidden, someHidden } = groupState(provider, visible);
                return (
                  <ProviderGroup
                    key={provider}
                    provider={provider}
                    visible={visible}
                    totalInGroup={totalInGroup}
                    isOpen={isOpen}
                    onToggleOpen={() => toggleGroupOpen(provider)}
                    providerHidden={providerHidden}
                    allHidden={allHidden}
                    someHidden={someHidden}
                    onSelectAll={() =>
                      bulkSetHidden(visible, !allHidden)
                    }
                    onToggleModel={toggleModel}
                    isModelHidden={(m) => isModelHidden(m, vis)}
                  />
                );
              })}
              {safeModels.length === 0 && (
                <p className="text-xs text-[var(--text-muted)]">No models known yet.</p>
              )}
              {safeModels.length > 0 && filteredModels.length === 0 && hasActiveSearch && (
                <p className="text-xs text-[var(--text-muted)]">No models match your search.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One provider group inside the Individual Models list. Header shows a chevron
 * (open/close), provider name, "X / Y" count (X visible after search, Y total
 * in group), and a tri-state "select all" checkbox.
 */
interface ProviderGroupProps {
  provider: string;
  visible: ModelInfo[];
  totalInGroup: number;
  isOpen: boolean;
  onToggleOpen: () => void;
  providerHidden: boolean;
  allHidden: boolean;
  someHidden: boolean;
  onSelectAll: () => void;
  onToggleModel: (m: ModelInfo) => void;
  isModelHidden: (m: ModelInfo) => boolean;
}

function ProviderGroup({
  provider,
  visible,
  totalInGroup,
  isOpen,
  onToggleOpen,
  providerHidden,
  allHidden,
  someHidden,
  onSelectAll,
  onToggleModel,
  isModelHidden,
}: ProviderGroupProps) {
  // Tri-state checkbox via ref (React doesn't support `indeterminate` as a prop).
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = someHidden && !allHidden;
    }
  }, [someHidden, allHidden]);

  const showCount =
    visible.length === totalInGroup
      ? `${totalInGroup}`
      : `${visible.length} / ${totalInGroup}`;

  return (
    <div data-testid={`group-${provider}`}>
      <div className="flex items-center gap-2">
        <button
          onClick={onToggleOpen}
          className="flex items-center gap-1 flex-1 text-left text-[10px] uppercase tracking-wider text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          data-testid={`group-toggle-${provider}`}
        >
          <Icon path={isOpen ? mdiChevronDown : mdiChevronRight} size={0.5} />
          <span>{provider}</span>
          <span className="text-[var(--text-muted)] normal-case font-normal">
            ({showCount})
          </span>
        </button>
        <label
          className={`flex items-center gap-1 text-[10px] text-[var(--text-muted)] ${
            providerHidden ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:text-[var(--text-primary)]"
          }`}
          title={
            providerHidden
              ? "Provider already hidden — turn off the provider toggle to edit individual models"
              : allHidden
                ? "Unhide all in this group"
                : "Hide all in this group"
          }
        >
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={allHidden}
            disabled={providerHidden}
            onChange={() => {
              if (providerHidden) return;
              onSelectAll();
            }}
            data-testid={`group-select-all-${provider}`}
          />
          <span>all</span>
        </label>
      </div>
      {isOpen && (
        <ul className="space-y-0.5 mt-1 ml-4">
          {visible.map((m) => {
            const key = `${m.provider}/${m.id}`;
            const checked = isModelHidden(m);
            return (
              <li
                key={key}
                className={`flex items-center gap-2 text-xs ${
                  providerHidden ? "opacity-50" : ""
                }`}
                data-testid={`model-row-${key}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={providerHidden}
                  onChange={() => {
                    if (providerHidden) return;
                    onToggleModel(m);
                  }}
                  data-testid={`model-checkbox-${key}`}
                />
                <span className="font-mono text-[var(--text-secondary)]">
                  {key}
                </span>
                {providerHidden && (
                  <span className="text-[10px] text-[var(--text-muted)] italic">
                    (inherited)
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
