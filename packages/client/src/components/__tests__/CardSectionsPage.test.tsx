/**
 * Directory Settings › Session cards page.
 * See change: configurable-session-card-sections (tasks 6.1).
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import { CardSectionsPage } from "../DirectorySettings/CardSectionsPage.js";

afterEach(() => cleanup());

const CWD = "/repo/a";

function renderPage(prefs: CardSectionPrefs, slots: string[] = []) {
  const send = vi.fn();
  const registry = createSlotRegistry();
  for (const slot of slots) {
    registry.addClaim({ pluginId: slot, priority: 100, slot: slot as never, Component: () => null });
  }
  const { hook, history } = memoryLocation({ path: "/", record: true });
  const utils = render(
    <Router hook={hook}>
      <PluginContextProvider registry={registry}>
        <CardSectionsProvider value={{ prefs, send, showToast: vi.fn() }}>
          <CardSectionsPage cwd={CWD} />
        </CardSectionsProvider>
      </PluginContextProvider>
    </Router>,
  );
  return { ...utils, send, history };
}

describe("CardSectionsPage", () => {
  it("Hide writes a folder override; Default writes inherit (sparse)", () => {
    const { send, rerender } = renderPage({});
    fireEvent.click(screen.getByTestId("card-section-tags-hide"));
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", path: CWD, section: "tags", visible: false });

    // Server echo: /a now stores tags=hidden.
    rerender(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        <PluginContextProvider registry={createSlotRegistry()}>
          <CardSectionsProvider value={{ prefs: { folders: { [CWD]: { tags: false } } }, send }}>
            <CardSectionsPage cwd={CWD} />
          </CardSectionsProvider>
        </PluginContextProvider>
      </Router>,
    );
    expect(screen.getByTestId("card-section-tags-hide").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("card-section-overridden-tags")).toBeTruthy();
    fireEvent.click(screen.getByTestId("card-section-tags-inherit"));
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", path: CWD, section: "tags", visible: null });
  });

  it("Default label reflects the global value", () => {
    renderPage({ global: { git: false } });
    expect(screen.getByTestId("card-section-git-inherit").textContent).toBe("Default (Hide)");
    expect(screen.getByTestId("card-section-tags-inherit").textContent).toBe("Default (Show)");
  });

  it("Reset to global is disabled with no overrides", () => {
    renderPage({ folders: { "/other": { git: false } } });
    expect((screen.getByTestId("card-sections-reset") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Reset to global sends the reset when overrides exist", () => {
    const { send } = renderPage({ folders: { [CWD]: { git: false } } });
    const reset = screen.getByTestId("card-sections-reset") as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    fireEvent.click(reset);
    expect(send).toHaveBeenCalledWith({ type: "reset_folder_card_sections", path: CWD });
  });

  it("plugin rows are absent without a contributing plugin", () => {
    renderPage({});
    for (const id of ["kb", "status", "flows", "memory"]) {
      expect(screen.queryByTestId(`card-section-row-${id}`)).toBeNull();
    }
    for (const id of ["openspec", "git", "process", "tags", "spawn"]) {
      expect(screen.getByTestId(`card-section-row-${id}`)).toBeTruthy();
    }
  });

  it("plugin row renders when a plugin claims its slot", () => {
    renderPage({}, ["session-card-memory"]);
    expect(screen.getByTestId("card-section-row-memory")).toBeTruthy();
    expect(screen.queryByTestId("card-section-row-flows")).toBeNull();
  });

  it("context usage bar is a link, not a Show/Hide control", () => {
    const { history } = renderPage({});
    const row = screen.getByTestId("card-section-row-context-bar");
    expect(row.querySelector("[aria-pressed]")).toBeNull();
    fireEvent.click(screen.getByTestId("card-section-context-bar-link"));
    expect(history[history.length - 1]).toBe("/settings/general");
  });

  it("OPENSPEC row states hiding does not disable OpenSpec and links to the opt-out", () => {
    const { history } = renderPage({});
    expect(screen.getByTestId("card-section-row-openspec").textContent).toMatch(/does not disable OpenSpec/);
    fireEvent.click(screen.getByTestId("card-section-openspec-optout-link"));
    expect(history[history.length - 1]).toBe("/settings/openspec");
  });

  it("controls are disabled while the socket is down", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(
      <Router hook={hook}>
        <PluginContextProvider registry={createSlotRegistry()}>
          <CardSectionsProvider value={{ prefs: { folders: { [CWD]: { git: false } } }, send: vi.fn(), connected: false }}>
            <CardSectionsPage cwd={CWD} />
          </CardSectionsProvider>
        </PluginContextProvider>
      </Router>,
    );
    expect((screen.getByTestId("card-section-git-show") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("card-sections-reset") as HTMLButtonElement).disabled).toBe(true);
  });

  it("live preview omits hidden sections", () => {
    renderPage({ folders: { [CWD]: { git: false, spawn: false } } });
    expect(screen.queryByTestId("card-sections-preview-git")).toBeNull();
    expect(screen.queryByTestId("card-sections-preview-spawn")).toBeNull();
    expect(screen.getByTestId("card-sections-preview-openspec")).toBeTruthy();
    expect(screen.getByTestId("card-sections-preview-tags")).toBeTruthy();
  });
});
