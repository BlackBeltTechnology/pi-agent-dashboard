/**
 * Per-browser hide-list for the session-level `<ModelSelector>`.
 *
 * Persisted in `window.localStorage` under {@link STORAGE_KEY}. The shape is
 * partitioned into {@link PersistedModelVisibility} (what we save) and
 * {@link ModelVisibilityRuntime} (persisted + non-persistent toggle state from
 * the dropdown's "Show hidden (N)" affordance). Only the persisted part round-
 * trips through storage.
 *
 * Filter rule: a model is hidden when
 *   provider ∈ hiddenProviders OR `${provider}/${id}` ∈ hiddenModels
 * Provider-level hide always wins; per-model "unhide" overrides are NOT
 * supported (out of scope per design Decision 3).
 *
 * See change: hide-models-from-selector.
 */

import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const STORAGE_KEY = "pi-dashboard.modelVisibility";

/** Persisted shape — round-trips through localStorage. */
export interface PersistedModelVisibility {
  hiddenProviders: string[];
  hiddenModels: string[];
}

/** Runtime shape — persisted fields + the non-persistent dropdown toggle. */
export interface ModelVisibilityRuntime extends PersistedModelVisibility {
  showHiddenInSelector: boolean;
}

const DEFAULT_PERSISTED: PersistedModelVisibility = Object.freeze({
  hiddenProviders: [],
  hiddenModels: [],
}) as PersistedModelVisibility;

/** Return a fresh default object (callers may mutate). */
function defaults(): PersistedModelVisibility {
  return { hiddenProviders: [], hiddenModels: [] };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Read and validate the persisted hide-list. On absent key, malformed JSON,
 * unexpected shape, or any storage error, returns the default `{ [], [] }`
 * without throwing.
 */
export function loadVisibility(): PersistedModelVisibility {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw == null) return defaults();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults();
    const obj = parsed as Record<string, unknown>;
    return {
      hiddenProviders: isStringArray(obj.hiddenProviders) ? obj.hiddenProviders : [],
      hiddenModels: isStringArray(obj.hiddenModels) ? obj.hiddenModels : [],
    };
  } catch {
    return defaults();
  }
}

/**
 * Persist the hide-list. Silently no-ops on storage errors (private mode,
 * quota, disabled).
 */
export function saveVisibility(v: PersistedModelVisibility): void {
  try {
    const payload: PersistedModelVisibility = {
      hiddenProviders: [...v.hiddenProviders],
      hiddenModels: [...v.hiddenModels],
    };
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* noop */
  }
}

/** True if `m` is hidden by either provider-level or model-level rule. */
export function isModelHidden(m: ModelInfo, vis: PersistedModelVisibility): boolean {
  if (vis.hiddenProviders.includes(m.provider)) return true;
  if (vis.hiddenModels.includes(`${m.provider}/${m.id}`)) return true;
  return false;
}

/**
 * Filter `models` against the runtime hide-list. Order is preserved.
 * When `runtime.showHiddenInSelector === true`, returns the input verbatim
 * (no filtering — the dropdown's `Show hidden (N)` toggle is on).
 */
export function filterVisibleModels(
  models: ModelInfo[],
  runtime: ModelVisibilityRuntime,
): ModelInfo[] {
  if (runtime.showHiddenInSelector) return models;
  if (runtime.hiddenProviders.length === 0 && runtime.hiddenModels.length === 0) {
    return models;
  }
  return models.filter((m) => !isModelHidden(m, runtime));
}

/**
 * Count how many models in `models` are currently hidden by `vis`.
 * Used by the `Show hidden (N)` toggle label.
 */
export function countHidden(models: ModelInfo[], vis: PersistedModelVisibility): number {
  if (vis.hiddenProviders.length === 0 && vis.hiddenModels.length === 0) return 0;
  let n = 0;
  for (const m of models) {
    if (isModelHidden(m, vis)) n++;
  }
  return n;
}

/**
 * Multi-token AND search: every whitespace-separated token in `query` must
 * appear in `haystack` (case-insensitive). Empty/whitespace query matches.
 * Shared between the `ModelSelector` text filter and the
 * `HiddenModelsSection` search input for consistent semantics.
 */
export function tokenMatch(haystack: string, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = haystack.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// Re-export the frozen default so consumers can compare without recomputing.
export { DEFAULT_PERSISTED };
