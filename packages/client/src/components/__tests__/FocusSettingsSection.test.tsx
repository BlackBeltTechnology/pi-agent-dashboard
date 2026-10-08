/**
 * Settings › Sessions › Focus section. Scenarios: spec focus-mode (Capture
 * current globals, Edit one profile row, First edit copies the built-in profile).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import { FocusSettingsSection } from "../settings/FocusSettingsSection.js";

afterEach(cleanup);

function renderSection(prefs: CardSectionPrefs, ctx: Record<string, unknown> = {}) {
  const send = vi.fn();
  const registry = createSlotRegistry();
  registry.addClaim({ pluginId: "goal", priority: 1, slot: "session-card-badge", Component: () => null });
  render(
    <PluginContextProvider registry={registry}>
      <CardSectionsProvider value={{ prefs, send, ...ctx }}>
        <FocusSettingsSection />
      </CardSectionsProvider>
    </PluginContextProvider>,
  );
  return { send };
}

describe("FocusSettingsSection", () => {
  it("switch reflects and toggles Focus; label says Built-in", () => {
    const { send } = renderSection({});
    const sw = screen.getByTestId("focus-settings-switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("focus-profile-label").textContent).toContain("Built-in");
    fireEvent.click(sw);
    expect(send).toHaveBeenLastCalledWith({ type: "set_focus_mode", enabled: true });
  });

  it("Save current captures globals + configured list mode", () => {
    const { send } = renderSection({ global: { git: false, tags: true } }, { folderListMode: "classic" });
    fireEvent.click(screen.getByTestId("focus-save-current"));
    const msg = send.mock.calls[0][0];
    expect(msg.type).toBe("set_focus_profile");
    expect(msg.profile.sections).toMatchObject({ git: false, tags: true });
    expect(msg.profile.folderListMode).toBe("classic");
  });

  it("customize is collapsed; first row edit copies the built-in profile; label flips after store", () => {
    const { send } = renderSection({});
    expect((screen.getByTestId("focus-customize") as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(screen.getByTestId("focus-row-badge-goal-show"));
    const profile = send.mock.calls[0][0].profile;
    expect(profile.sections["badge-goal"]).toBe(true);
    expect(profile.sections.git).toBe(false);
    expect(profile.folderListMode).toBe("accordion");
  });

  it("Not set removes just that key; Reset only enabled for a custom profile", () => {
    const { send } = renderSection({ focus: { profile: { sections: { git: false, flows: false } } } });
    expect(screen.getByTestId("focus-profile-label").textContent).toContain("Custom");
    fireEvent.click(screen.getByTestId("focus-row-git-unset"));
    expect(send.mock.calls[0][0].profile.sections).toEqual({ flows: false });
    fireEvent.click(screen.getByTestId("focus-reset"));
    expect(send).toHaveBeenLastCalledWith({ type: "set_focus_profile", profile: null });
  });

  it("controls disabled while disconnected", () => {
    renderSection({}, { connected: false });
    expect((screen.getByTestId("focus-settings-switch") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("focus-save-current") as HTMLButtonElement).disabled).toBe(true);
  });

  it("list-mode row shows the effective mode: custom profile without a mode follows the configured one", () => {
    renderSection({ focus: { profile: { sections: {} } } }, { folderListMode: "classic" });
    expect(screen.getByTestId("focus-row-folderListMode-show").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("focus-row-folderListMode-hide").getAttribute("aria-pressed")).toBe("false");
  });

  it("list-mode row: explicit profile mode wins; built-in shows accordion", () => {
    cleanup();
    renderSection({ focus: { profile: { sections: {}, folderListMode: "accordion" } } }, { folderListMode: "classic" });
    expect(screen.getByTestId("focus-row-folderListMode-hide").getAttribute("aria-pressed")).toBe("true");
    cleanup();
    renderSection({}, { folderListMode: "classic" });
    expect(screen.getByTestId("focus-row-folderListMode-hide").getAttribute("aria-pressed")).toBe("true");
  });
});
