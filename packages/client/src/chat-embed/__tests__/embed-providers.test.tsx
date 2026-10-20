/**
 * E32 — a standalone embed gets the full host registry from
 * `createHostPrimitiveRegistry()` and `EmbedProviders`; the shell-bound
 * `ui:model-selector` runs in its no-context form (no favorites / refresh /
 * provider-settings link, caller's list still renders).
 * See change: decouple-plugins-from-core.
 */
import { UiPrimitiveProvider, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHostPrimitiveRegistry, EmbedProviders } from "../index.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
afterEach(() => cleanup());

const models: ModelInfo[] = [
  { provider: "p", id: "a", reasoning: false, vision: true, contextWindow: 1000, metadataSource: "catalog" },
  { provider: "p", id: "b", reasoning: false, vision: true, contextWindow: 1000, metadataSource: "catalog" },
];

function Picker({ onSelect }: { onSelect: (m: string) => void }) {
  const ModelSelector = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);
  return <ModelSelector current="p/a" models={models} onSelect={onSelect} />;
}

describe("createHostPrimitiveRegistry()", () => {
  it("takes no parameters and registers exactly UI_PRIMITIVE_KEYS", () => {
    expect(createHostPrimitiveRegistry.length).toBe(0);
    const registry = createHostPrimitiveRegistry();
    expect([...registry._impls.keys()].sort()).toEqual(Object.values(UI_PRIMITIVE_KEYS).sort());
  });
});

describe("ui:model-selector inside EmbedProviders (no ModelConfigContext)", () => {
  it("lists the caller's models, selects one once, and shows no favorites toggle or refresh", () => {
    const onSelect = vi.fn();
    render(
      <UiPrimitiveProvider value={createHostPrimitiveRegistry()}>
        <EmbedProviders apiBase="">
          <Picker onSelect={onSelect} />
        </EmbedProviders>
      </UiPrimitiveProvider>,
    );
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(screen.queryByTestId("favs-only-toggle")).toBeNull();
    expect(screen.queryByTestId("model-fav-toggle")).toBeNull();
    expect(screen.queryByTestId("model-provider-settings-link")).toBeNull();
    const rows = screen.getAllByTestId("model-row");
    expect(rows.length).toBe(2);
    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("p/b");
  });
});
