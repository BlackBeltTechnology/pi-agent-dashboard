import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ThemeToggle } from "../settings/ThemeToggle.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

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
    expect(systemBtn.className).toContain("accent-blue");
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
});
