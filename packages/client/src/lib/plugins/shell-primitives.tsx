/**
 * Shell-bound UI primitive wrappers registered in `main.tsx`.
 *
 * A primitive registration MAY inject session-scoped, shell-owned props that
 * are deliberately absent from the plugin-facing contract (same pattern as
 * `ToolCallStepPrimitive`). Extracted from `main.tsx` so the binding is
 * testable without booting the app.
 *
 * See change: upgrade-model-selector-primitives (design D1, D3).
 */
import type {
  UiModelSelectorProps,
  UiThinkingLevelSelectorProps,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { ModelSelector } from "../../components/settings/ModelSelector.js";
import { ThinkingLevelSelector } from "../../components/settings/ThinkingLevelSelector.js";
import { useModelConfigOptional } from "../state/ModelConfigContext.js";

/**
 * `ui:model-selector` — the public contract stays `{ current, models, onSelect,
 * placeholder }`; favorites + list-refresh are injected from
 * `ModelConfigContext` so plugin surfaces inherit them with no wiring. With no
 * selected session the context is absent: no refresh handler, no favorites, and
 * the caller's list still renders.
 */
export const ModelSelectorPrimitive: React.FC<UiModelSelectorProps> = (props) => {
  const cfg = useModelConfigOptional();
  return (
    <ModelSelector
      current={props.current}
      models={props.models}
      onSelect={props.onSelect}
      placeholder={props.placeholder}
      favorites={cfg?.favorites}
      onToggleFavorite={cfg ? cfg.toggleFavorite : undefined}
      onRefresh={cfg ? cfg.refreshModels : undefined}
      onOpenProviderSettings={cfg ? cfg.openProviderSettings : undefined}
    />
  );
};

/**
 * `ui:thinking-level-selector` — the shell's own component, thinly wrapped.
 * `supportedLevels` stays caller-supplied: only the caller knows which model the
 * row it is editing refers to (design D3).
 */
export const ThinkingLevelSelectorPrimitive: React.FC<UiThinkingLevelSelectorProps> = (props) => (
  <ThinkingLevelSelector
    current={props.current}
    onSelect={props.onSelect}
    supportedLevels={props.supportedLevels}
  />
);
