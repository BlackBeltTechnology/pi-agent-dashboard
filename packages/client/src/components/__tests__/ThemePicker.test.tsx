import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // Base is default — check it has the active class
    const baseOption = getByTestId("theme-option-base");
    expect(baseOption.className).toContain("text-[var(--accent-blue)]");
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
    expect(again.getByTestId("theme-option-nord").className).toContain("text-[var(--accent-blue)]");
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
});
