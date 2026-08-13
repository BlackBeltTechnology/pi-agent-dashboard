/**
 * ModelConfigContext — exposes the attached session's model / thinking
 * level, the model list, favorites, and their setters to the OpenSpec launch
 * dialogs (Explore / Propose / New Change) via a single React context provided
 * once at the app root.
 *
 * Sourced from App.tsx's existing `selectedState.model`,
 * `selectedState.thinkingLevel`, `modelsMap`, and `favoriteModels`; the setters
 * emit the existing `set_model` / `set_thinking_level` / `request_models`
 * browser messages. Chosen over prop-drilling seven values through
 * `SessionOpenSpecActions` at three mount sites (design Decision 2). Because
 * `DialogPortal` uses `createPortal`, this context still reaches the dialogs
 * even though they render at `document.body`.
 *
 * The consuming hook throws when used outside the provider, turning a silent
 * degraded row into a loud test failure (design Risk 5).
 *
 * Neutral, NOT OpenSpec-specific: the shell-bound `ui:model-selector` primitive
 * registration reads the same bundle to inject favorites + refresh into plugin
 * surfaces. Renamed from `OpenSpecRunConfigContext` with no compatibility alias.
 *
 * See changes: openspec-dialog-model-effort-selector,
 * upgrade-model-selector-primitives (design D2).
 */
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createContext, useContext } from "react";

export interface ModelConfigValue {
  /** Session's current model as a `"provider/id"` label, or undefined. */
  model?: string;
  /** Available models for the session (undefined/empty → degraded state). */
  models?: ModelInfo[];
  /** Session's current thinking level, or undefined. */
  thinkingLevel?: string;
  /** Favorite model labels (`"provider/id"`), server-persisted. */
  favorites?: string[];
  /** Emit `set_model` for the session. `label` is `"provider/id"`. */
  setModel: (label: string) => void;
  /** Emit `set_thinking_level` for the session. */
  setThinkingLevel: (level: string) => void;
  /** Toggle a model's favorite state. */
  toggleFavorite: (label: string, makeFavorite: boolean) => void;
  /** Emit `request_models` for the session (refresh the list). */
  refreshModels: () => void;
  /** Surface a transient notice (e.g. the confirm-gate timeout copy). */
  notify: (message: string) => void;
}

const ModelConfigContext = createContext<ModelConfigValue | undefined>(undefined);

export const ModelConfigProvider = ModelConfigContext.Provider;

/**
 * Read the run-config context. Throws when rendered outside the provider so a
 * missing mount site fails loudly rather than rendering a degraded row.
 */
export function useModelConfig(): ModelConfigValue {
  const ctx = useContext(ModelConfigContext);
  if (ctx === undefined) {
    throw new Error("useModelConfig must be used within a ModelConfigProvider");
  }
  return ctx;
}

/**
 * Non-throwing read for hosts that legitimately render outside a session (e.g.
 * the shell-bound `ui:model-selector` primitive on a folder-level plugin
 * surface). See change: upgrade-model-selector-primitives (task 6.3).
 */
export function useModelConfigOptional(): ModelConfigValue | undefined {
  return useContext(ModelConfigContext);
}
