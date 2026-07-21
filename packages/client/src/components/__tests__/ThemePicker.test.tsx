import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { ThemePicker } from "../settings/ThemePicker.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { THEMES } from "../../lib/theme/themes.js";

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
  return render(
    <ThemeProvider>
      <ThemePicker />
    </ThemeProvider>,
    { container: document.createElement("div") },
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
});
