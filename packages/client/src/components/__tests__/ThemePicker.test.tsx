import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mdiCheck } from "@mdi/js";
import { THEMES } from "../../lib/theme/themes.js";
import { ThemePicker } from "../settings/ThemePicker.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

afterEach(() => cleanup());

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  for (const prop of [...document.documentElement.style]) {
    document.documentElement.style.removeProperty(prop);
  }
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function renderPicker() {
  const container = document.body.appendChild(document.createElement("div"));
  return render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>,
    { container },
  );
}

describe("ThemePicker", () => {
  it("renders trigger button", () => {
    const { getByTestId } = renderPicker();
    expect(getByTestId("theme-picker-trigger")).toBeTruthy();
  });

  it("dropdown is hidden by default", () => {
    const { queryByTestId } = renderPicker();
    expect(queryByTestId("theme-picker-dropdown")).toBeNull();
  });

  it("opens dropdown on click", () => {
    const { getByTestId } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    expect(getByTestId("theme-picker-dropdown")).toBeTruthy();
  });

  it("shows all themes in dropdown", () => {
    const { getByTestId } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    for (const theme of THEMES) {
      expect(getByTestId(`theme-option-${theme.id}`)).toBeTruthy();
    }
  });

  it("selects a theme and closes dropdown", () => {
    const { getByTestId, queryByTestId } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    fireEvent.click(getByTestId("theme-option-dracula"));
    // Dropdown should close
    expect(queryByTestId("theme-picker-dropdown")).toBeNull();
    // CSS variable should be applied
    expect(document.documentElement.style.getPropertyValue("--bg-primary")).toBe("#282a36");
  });

  it("shows active indicator on selected theme", () => {
    const { getByTestId } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    // Base is default — active row is marked by aria-pressed (selected-chip recipe)
    const baseOption = getByTestId("theme-option-base");
    expect(baseOption.getAttribute("aria-pressed")).toBe("true");
  });

  // ---- declutter-sidebar-header (test-plan #E16 #F2 #F3, D1) ----
  it("E16: mode switch keeps the dropdown open; a palette closes it, focuses the trigger and persists", () => {
    const { getByTestId, queryByTestId, unmount } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    fireEvent.click(getByTestId("theme-light"));
    expect(getByTestId("theme-light").getAttribute("aria-pressed")).toBe("true");
    expect(queryByTestId("theme-picker-dropdown")).not.toBeNull();
    fireEvent.click(getByTestId("theme-option-nord"));
    expect(queryByTestId("theme-picker-dropdown")).toBeNull();
    expect(document.activeElement).toBe(getByTestId("theme-picker-trigger"));
    unmount();
    const again = renderPicker();
    fireEvent.click(again.getByTestId("theme-picker-trigger"));
    expect(again.getByTestId("theme-option-nord").getAttribute("aria-pressed")).toBe("true");
  });

  it("the mode control lives inside the dropdown only", () => {
    const { getByTestId, queryByTestId } = renderPicker();
    expect(queryByTestId("theme-toggle")).toBeNull();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    expect(getByTestId("theme-picker-dropdown").contains(getByTestId("theme-toggle"))).toBe(true);
  });

  it("F3: keyboard open focuses the pressed mode button", () => {
    const { getByTestId } = renderPicker();
    const trigger = getByTestId("theme-picker-trigger");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(document.activeElement).toBe(getByTestId("theme-system"));
  });

  it("F2: Escape closes the dropdown and focuses the trigger", () => {
    const { getByTestId, queryByTestId } = renderPicker();
    const trigger = getByTestId("theme-picker-trigger");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    expect(queryByTestId("theme-picker-dropdown")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("anchors to the right edge when a left-anchored panel would not fit (trigger near the viewport edge)", () => {
    const { getByTestId } = renderPicker();
    const trigger = getByTestId("theme-picker-trigger");
    const vw = window.innerWidth;
    trigger.getBoundingClientRect = () =>
      ({ top: 10, bottom: 30, left: vw - 20, right: vw - 4, width: 16, height: 20, x: vw - 20, y: 10, toJSON() {} }) as DOMRect;
    act(() => { fireEvent.click(trigger); });
    expect(getByTestId("theme-picker-dropdown").className).toContain("right-0");
  });

  it("stays left-anchored when there is room", () => {
    const { getByTestId } = renderPicker();
    const trigger = getByTestId("theme-picker-trigger");
    trigger.getBoundingClientRect = () =>
      ({ top: 10, bottom: 30, left: 20, right: 36, width: 16, height: 20, x: 20, y: 10, toJSON() {} }) as DOMRect;
    act(() => { fireEvent.click(trigger); });
    expect(getByTestId("theme-picker-dropdown").className).toContain("left-0");
  });

  it("ArrowDown on the trigger of an already-open dropdown moves focus to the pressed mode button", () => {
    const { getByTestId } = renderPicker();
    const trigger = getByTestId("theme-picker-trigger");
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(getByTestId("theme-system"));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(document.activeElement).toBe(getByTestId("theme-system"));
  });

  // ---- polish-sidebar-header-controls (test-plan #E13 #E14) ----
  it("E13: labelled Mode / Palette sections, two-column grid, one pressed palette, no check glyph", () => {
    localStorage.setItem("dashboard:theme", "dark");
    const { getByTestId, getByText, container } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    expect(getByText("Mode")).toBeTruthy();
    expect(getByText("Palette")).toBeTruthy();
    expect(getByTestId("theme-light").textContent).toContain("Light");
    expect(getByTestId("theme-system").textContent).toContain("System");
    expect(getByTestId("theme-dark").textContent).toContain("Dark");
    const options = [...container.querySelectorAll<HTMLElement>('button[data-testid^="theme-option-"]')];
    expect(options).toHaveLength(THEMES.length);
    expect(THEMES).toHaveLength(9);
    const pressed = options.filter((o) => o.getAttribute("aria-pressed") === "true");
    expect(pressed.map((o) => o.getAttribute("data-testid"))).toEqual(["theme-option-base"]);
    const grid = getByTestId("theme-palette-grid");
    expect(grid.className).toContain("grid-cols-2");
    expect(mdiCheckAbsent(grid)).toBe(true);
  });

  it("E14: swatch halves follow the resolved mode", () => {
    const nord = THEMES.find((t) => t.id === "nord");
    if (!nord) throw new Error("nord theme missing");
    const { getByTestId } = renderPicker();
    fireEvent.click(getByTestId("theme-picker-trigger"));
    fireEvent.click(getByTestId("theme-light"));
    const halves = () => {
      const opt = getByTestId("theme-option-nord");
      return [
        (opt.querySelector('[data-testid="theme-swatch-bg"]') as HTMLElement).style.backgroundColor,
        (opt.querySelector('[data-testid="theme-swatch-accent"]') as HTMLElement).style.backgroundColor,
      ];
    };
    const norm = (c: string) => {
      const el = document.createElement("span");
      el.style.backgroundColor = c;
      return el.style.backgroundColor;
    };
    expect(halves()).toEqual([norm(nord.light["--bg-primary"]), norm(nord.light["--accent-blue"])]);
    fireEvent.click(getByTestId("theme-dark"));
    expect(halves()).toEqual([norm(nord.dark["--bg-primary"]), norm(nord.dark["--accent-blue"])]);
  });
});

/** True when no MDI check glyph path is rendered inside `root`. */
function mdiCheckAbsent(root: HTMLElement): boolean {
  return ![...root.querySelectorAll("path")].some((p) => p.getAttribute("d") === mdiCheck);
}
