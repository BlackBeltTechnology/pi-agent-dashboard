/**
 * Settings › Session card sections (global defaults + override counts).
 * See change: configurable-session-card-sections (tasks 6.2).
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import { CardSectionsSection } from "../settings/CardSectionsSection.js";

afterEach(() => cleanup());

function renderSection(prefs: CardSectionPrefs) {
  const send = vi.fn();
  const registry = createSlotRegistry();
  registry.addClaim({ pluginId: "flows", priority: 100, slot: "session-card-flows", Component: () => null });
  render(
    <PluginContextProvider registry={registry}>
      <CardSectionsProvider value={{ prefs, send }}>
        <CardSectionsSection />
      </CardSectionsProvider>
    </PluginContextProvider>,
  );
  return { send };
}

describe("CardSectionsSection", () => {
  it("shows the number of folders overriding each section", () => {
    renderSection({ folders: { "/a": { flows: false }, "/b": { flows: true } } });
    expect(screen.getByTestId("card-sections-global-count-flows").textContent).toMatch(/2 folder/);
    expect(screen.getByTestId("card-sections-global-count-git").textContent).toBe("No folder overrides");
  });

  it("switch reflects the global value; off sends false, on sends inherit", () => {
    const { send } = renderSection({ global: { git: false } });
    const git = screen.getByTestId("card-sections-global-git").querySelector("[role=switch]") as HTMLElement;
    expect(git.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(git);
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", section: "git", visible: null });
    const tags = screen.getByTestId("card-sections-global-tags").querySelector("[role=switch]") as HTMLElement;
    expect(tags.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(tags);
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", section: "tags", visible: false });
  });

  it("omits plugin rows no plugin contributes", () => {
    renderSection({});
    expect(screen.getByTestId("card-sections-global-flows")).toBeTruthy();
    expect(screen.queryByTestId("card-sections-global-memory")).toBeNull();
  });
});
