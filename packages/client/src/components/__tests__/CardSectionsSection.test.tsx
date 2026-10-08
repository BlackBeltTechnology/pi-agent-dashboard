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

  it("switches are disabled while the socket is down", () => {
    render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <CardSectionsProvider value={{ prefs: {}, send: vi.fn(), connected: false }}>
          <CardSectionsSection />
        </CardSectionsProvider>
      </PluginContextProvider>,
    );
    const git = screen.getByTestId("card-sections-global-git").querySelector("[role=switch]") as HTMLButtonElement;
    expect(git.disabled).toBe(true);
  });

  it("omits plugin rows no plugin contributes", () => {
    renderSection({});
    expect(screen.getByTestId("card-sections-global-flows")).toBeTruthy();
    expect(screen.queryByTestId("card-sections-global-memory")).toBeNull();
  });
});

describe("CardSectionsSection — blocks, effects, notice (add-focus-mode-and-card-block-toggles)", () => {
  it("offers directory-card rows and the Effects group (global only)", () => {
    renderSection({});
    expect(screen.getByTestId("card-sections-global-group-directory")).toBeTruthy();
    expect(screen.getByTestId("card-sections-global-group-effects")).toBeTruthy();
    expect(screen.getByTestId("card-sections-global-fx-selected-glow")).toBeTruthy();
    expect(screen.getByTestId("card-sections-global-count-fx-selected-glow").textContent).not.toMatch(/folder/);
  });

  it("directory-card switch off writes a global false; on writes inherit", () => {
    const { send } = renderSection({});
    const sw = () => screen.getByTestId("card-sections-global-folder-create").querySelector("[role=switch]") as HTMLElement;
    fireEvent.click(sw());
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", section: "folder-create", visible: false });
  });

  it("switching a child ON under a hidden legacy parent writes an explicit true", () => {
    const { send } = renderSection({ global: { openspec: false } });
    const sw = screen.getByTestId("card-sections-global-openspec-badge").querySelector("[role=switch]") as HTMLElement;
    expect(sw.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw);
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", section: "openspec-badge", visible: true });
  });

  it("shows the global (normal) value while Focus is on, with a notice", () => {
    renderSection({ global: { git: false }, focus: { enabled: true } });
    expect(screen.getByTestId("focus-notice")).toBeTruthy();
    const git = screen.getByTestId("card-sections-global-git").querySelector("[role=switch]") as HTMLElement;
    expect(git.getAttribute("aria-checked")).toBe("false");
  });

  it("writes are disabled while disconnected, incl. effects", () => {
    render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <CardSectionsProvider value={{ prefs: {}, send: vi.fn(), connected: false }}>
          <CardSectionsSection />
        </CardSectionsProvider>
      </PluginContextProvider>,
    );
    const fx = screen.getByTestId("card-sections-global-fx-status-animation").querySelector("[role=switch]") as HTMLButtonElement;
    expect(fx.disabled).toBe(true);
  });
});

