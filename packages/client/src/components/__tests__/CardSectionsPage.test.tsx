/**
 * Directory Settings › Session cards page.
 * See change: configurable-session-card-sections (tasks 6.1).
 */
import {
  createSlotRegistry,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
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
  it("Hide writes a folder override; Global writes inherit (sparse)", () => {
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

  it("Global label reflects the global value (card-sections-global-pointer #E3)", () => {
    const { container } = renderPage({ global: { git: false } });
    expect(screen.getByTestId("card-section-git-inherit").textContent).toBe("Global (Hide)");
    expect(screen.getByTestId("card-section-tags-inherit").textContent).toBe("Global (Show)");
    expect(container.textContent).not.toContain("Default (");
  });

  it("Edit global defaults navigates (push) to the Settings block, enabled while Reset is disabled (#E1)", () => {
    const { hook, history } = memoryLocation({ path: "/a", record: true });
    const navSpy = vi.fn();
    const spyHook = () => {
      const [loc, nav] = hook();
      return [loc, (to: string, opts?: unknown) => { navSpy(to, opts); nav(to, opts as never); }] as ReturnType<typeof hook>;
    };
    render(
      <Router hook={spyHook}>
        <PluginContextProvider registry={createSlotRegistry()}>
          <CardSectionsProvider value={{ prefs: {}, send: vi.fn(), connected: false }}>
            <CardSectionsPage cwd={CWD} />
          </CardSectionsProvider>
        </PluginContextProvider>
      </Router>,
    );
    expect((screen.getByTestId("card-sections-reset") as HTMLButtonElement).disabled).toBe(true);
    const link = screen.getByTestId("card-sections-open-global") as HTMLButtonElement;
    expect(link.disabled).toBe(false);
    expect(link.textContent).toBe("Edit global defaults →");
    fireEvent.click(link);
    expect(navSpy).toHaveBeenCalledTimes(1);
    expect(navSpy.mock.calls[0][0]).toBe("/settings/general?scroll=card-sections-settings");
    expect((navSpy.mock.calls[0][1] as { replace?: boolean } | undefined)?.replace).not.toBe(true);
    expect(history[history.length - 1]).toBe("/settings/general?scroll=card-sections-settings");
  });

  it("summary strip names the global defaults (#E2)", () => {
    renderPage({ folders: { [CWD]: { git: false, tags: false } } });
    expect(screen.getByTestId("card-sections-override-summary").textContent).toContain("follows the global defaults");
    cleanup();
    renderPage({});
    expect(screen.getByTestId("card-sections-override-summary").textContent).toContain("Using the global defaults");
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

describe("CardSectionsPage — card blocks (add-focus-mode-and-card-block-toggles #E19)", () => {
  function renderWith(prefs: CardSectionPrefs, claims: [string, string][], ctx: Record<string, unknown> = {}) {
    const send = vi.fn();
    const registry = createSlotRegistry();
    for (const [pluginId, slot] of claims) registry.addClaim({ pluginId, priority: 100, slot: slot as never, Component: () => null });
    const { hook } = memoryLocation({ path: "/", record: true });
    render(
      <Router hook={hook}>
        <PluginContextProvider registry={registry}>
          <CardSectionsProvider value={{ prefs, send, showToast: vi.fn(), pluginNames: { automation: "Automations" }, ...ctx }}>
            <CardSectionsPage cwd={CWD} />
          </CardSectionsProvider>
        </PluginContextProvider>
      </Router>,
    );
    return { send };
  }

  it("lists the directory-card group with built-in rows and an Automations pill row; no MEMORY, no Effects", () => {
    renderWith({}, [["automation", "sidebar-folder-section"], ["goal", "session-card-badge"], ["goal", "session-card-action-bar"]]);
    const dir = screen.getByTestId("card-sections-group-directory");
    for (const id of ["folder-git", "folder-banner", "folder-openspec", "folder-create", "folder-ended", "pill-automation"]) {
      expect(dir.querySelector(`[data-testid="card-section-row-${id}"]`)).not.toBeNull();
    }
    expect(dir.textContent).toContain("Automations pill");
    expect(screen.queryByTestId("card-section-row-badge-goal")).not.toBeNull();
    expect(screen.queryByTestId("card-section-row-actionbar-goal")).not.toBeNull();
    expect(screen.queryByTestId("card-section-row-memory")).toBeNull();
    expect(screen.queryByTestId("card-sections-group-effects")).toBeNull();
    expect(screen.queryByTestId("card-section-row-fx-status-animation")).toBeNull();
  });

  it("openspec-badge inherits a hidden legacy parent as Global (Hide) and a folder write targets the child", () => {
    const { send } = renderWith({ global: { openspec: false } }, []);
    expect(screen.getByTestId("card-section-openspec-badge-inherit").textContent).toBe("Global (Hide)");
    fireEvent.click(screen.getByTestId("card-section-openspec-badge-show"));
    expect(send).toHaveBeenLastCalledWith({ type: "set_card_section_visibility", path: CWD, section: "openspec-badge", visible: true });
  });

  it("child of a folder-hidden legacy parent reads Global (Hide); selecting inherit writes no child key (#E4)", () => {
    const { send } = renderWith({ folders: { [CWD]: { openspec: false } } }, []);
    const inherit = screen.getByTestId("card-section-openspec-badge-inherit");
    expect(inherit.textContent).toBe("Global (Hide)");
    expect(inherit.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(inherit);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows the Focus notice only while Focus is on and Turn off Focus sends the toggle (#E23)", () => {
    const off = renderWith({}, []);
    expect(screen.queryByTestId("focus-notice")).toBeNull();
    cleanup();
    const on = renderWith({ focus: { enabled: true } }, []);
    expect(screen.getByTestId("focus-notice")).toBeTruthy();
    fireEvent.click(screen.getByTestId("focus-notice-off"));
    expect(on.send).toHaveBeenLastCalledWith({ type: "set_focus_mode", enabled: false });
    expect(off.send).not.toHaveBeenCalled();
  });
});

