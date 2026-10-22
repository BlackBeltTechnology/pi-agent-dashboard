import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { ThemeToggle } from "../settings/ThemeToggle.js";

afterEach(() => cleanup());

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
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

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
}

describe("ThemeToggle", () => {
  it("renders three buttons", () => {
    renderToggle();
    expect(screen.getByTestId("theme-light")).toBeTruthy();
    expect(screen.getByTestId("theme-system")).toBeTruthy();
    expect(screen.getByTestId("theme-dark")).toBeTruthy();
  });

  it("defaults to system selected", () => {
    renderToggle();
    const systemBtn = screen.getByTestId("theme-system");
    expect(systemBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches to light on click", () => {
    renderToggle();
    fireEvent.click(screen.getByTestId("theme-light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("switches to dark on click", () => {
    document.documentElement.setAttribute("data-theme", "light");
    renderToggle();
    fireEvent.click(screen.getByTestId("theme-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("exactly one button is aria-pressed and it follows the preference", () => {
    renderToggle();
    const pressed = () => ["light", "system", "dark"].filter((v) => screen.getByTestId(`theme-${v}`).getAttribute("aria-pressed") === "true");
    expect(pressed()).toEqual(["system"]);
    fireEvent.click(screen.getByTestId("theme-light"));
    expect(pressed()).toEqual(["light"]);
  });
});
