/**
 * Test harness for the OpenSpec run-config context. Wraps children in an
 * `ModelConfigProvider` with a controllable, spy-able value so dialog and
 * row tests can assert emitted setters and drive the confirm-before-send gate.
 *
 * See change: openspec-dialog-model-effort-selector.
 */
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { ReactNode } from "react";
import { vi } from "vitest";
import {
  ModelConfigProvider,
  type ModelConfigValue,
} from "../lib/state/ModelConfigContext.js";

export function makeModels(labels: string[]): ModelInfo[] {
  return labels.map((label) => {
    const slash = label.indexOf("/");
    return { provider: label.slice(0, slash), id: label.slice(slash + 1) } as ModelInfo;
  });
}

export function makeRunConfig(
  overrides: Partial<ModelConfigValue> = {},
): ModelConfigValue {
  return {
    model: "anthropic/claude-sonnet-4-6",
    models: makeModels(["anthropic/claude-sonnet-4-6", "openai/gpt-5.1-codex"]),
    thinkingLevel: "high",
    favorites: [],
    setModel: vi.fn(),
    setThinkingLevel: vi.fn(),
    toggleFavorite: vi.fn(),
    refreshModels: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
}

export function RunConfigHarness({
  value,
  children,
}: {
  value: ModelConfigValue;
  children: ReactNode;
}) {
  return <ModelConfigProvider value={value}>{children}</ModelConfigProvider>;
}
