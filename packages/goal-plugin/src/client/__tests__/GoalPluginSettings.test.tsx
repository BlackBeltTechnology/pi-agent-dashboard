/**
 * GoalPluginSettings (settings consistency wave 2): kit switch + "This browser"
 * pill; the toggle stays immediate and writes only the one localStorage key
 * (test-plan #E26). See change: retro-ux-plugin-settings-wave-2.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoalPluginSettings } from "../GoalPluginSettings.js";

const KEY = "pi-dashboard.goal.autoRespawnDefault";

/** In-memory Storage: the host's Node/jsdom combination may not provide a working global one. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GoalPluginSettings", () => {
  it("#E26 default → 'This browser' pill + kit switch; toggling writes only the autoRespawnDefault key", () => {
    const { container } = render(<GoalPluginSettings />);
    const pill = screen.getByText("This browser");
    expect(pill.closest("[data-tone]")?.getAttribute("data-tone")).toBe("neutral");

    const sw = screen.getByRole("switch", { name: /Auto-restart new goals/ });
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector("input[type='checkbox']")).toBeNull();
    expect(localStorage.length).toBe(0);

    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(KEY)).toBe("1");

    fireEvent.click(sw);
    expect(localStorage.getItem(KEY)).toBe("0");
    expect(localStorage.length).toBe(1);
  });

  it("reads the stored default and keeps the protected testid on the switch", () => {
    localStorage.setItem(KEY, "1");
    render(<GoalPluginSettings />);
    const sw = screen.getByTestId("goal-settings-auto-respawn-default");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
  });

  it("lead text and hint are not muted/tertiary", () => {
    const { container } = render(<GoalPluginSettings />);
    expect(container.innerHTML).not.toMatch(/--text-muted|--text-tertiary|text-\[13px\]/);
  });
});
