/**
 * ModelSelector dropdown layering + dismissal regression tests.
 *
 * See change: fix-composer-popover-layering — the open dropdown moves from an
 * inline `absolute z-50` panel (trapped in the composer's stacking context,
 * underlapping the context strip) to a `LayerPortal`-portaled `fixed` panel
 * carrying the `z-popover` token. Portaling takes the panel out of the
 * component container, so the outside-click handler must treat the portaled
 * panel as "inside" or every in-dropdown click would close it instantly.
 */

import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "../components/settings/ModelSelector.js";

afterEach(() => cleanup());

const MODELS: ModelInfo[] = [
  { provider: "acme", id: "big", name: "Big", reasoning: true, contextWindow: 200_000 },
  { provider: "acme", id: "small", name: "Small" },
  { provider: "other", id: "tiny", name: "Tiny" },
];

function openDropdown() {
  fireEvent.click(screen.getByTestId("model-selector-button"));
}

describe("ModelSelector — portaled dropdown", () => {
  // The outside-click trap: once the panel is portaled out of the trigger's
  // container, a naive container-only containment check reads every in-panel
  // mousedown as "outside" and closes the menu before a selection registers.
  it("does not close on mousedown inside the open dropdown — selection still fires", () => {
    const onSelect = vi.fn();
    render(<ModelSelector current="acme/big" models={MODELS} onSelect={onSelect} />);
    openDropdown();
    const row = screen.getAllByTestId("model-row")[0]!;
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith("acme/big");
  });

  it("still closes on mousedown outside the dropdown", () => {
    render(<ModelSelector current="acme/big" models={MODELS} onSelect={vi.fn()} />);
    openDropdown();
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("model-dropdown")).toBeNull();
  });

  // The bug's red test: the panel must NOT be a DOM descendant of the
  // component container (it is portaled to the layer root) and must carry the
  // `z-popover` layer token instead of a raw `z-*`.
  it("portals the open dropdown out of the component container with the z-popover layer token", () => {
    const { container } = render(<ModelSelector current="acme/big" models={MODELS} onSelect={vi.fn()} />);
    openDropdown();
    const dropdown = screen.getByTestId("model-dropdown");
    expect(container.querySelector('[data-testid="model-dropdown"]')).toBeNull();
    expect(dropdown.className).toContain("z-popover");
    expect(dropdown.className).not.toMatch(/(^|\s)z-\d+(\s|$)/);
  });
});
