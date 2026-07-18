import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { SessionSidebar } from "../session/SessionSidebar.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

beforeAll(() => {
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

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/tmp",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    ...overrides,
  };
}

describe("SessionSidebar error indicator", () => {
  it("shows red dot when session has error", () => {
    const session = makeSession({ id: "s1", status: "idle" });
    const { container } = render(
      <ThemeProvider>
        <SessionSidebar
          sessions={[session]}
          onSelect={() => {}}
          errorSessionIds={new Set(["s1"])}
        />
      </ThemeProvider>,
    );

    const dot = container.querySelector(".bg-red-500");
    expect(dot).toBeTruthy();
  });

  it("shows normal green dot when session has no error", () => {
    const session = makeSession({ id: "s1", status: "idle" });
    const { container } = render(
      <ThemeProvider>
        <SessionSidebar
          sessions={[session]}
          onSelect={() => {}}
          errorSessionIds={new Set()}
        />
      </ThemeProvider>,
    );

    const dot = container.querySelector(".bg-green-500");
    expect(dot).toBeTruthy();
    expect(container.querySelector(".bg-red-500")).toBeNull();
  });

  it("shows green dot when errorSessionIds is not provided", () => {
    const session = makeSession({ id: "s1", status: "idle" });
    const { container } = render(
      <ThemeProvider>
        <SessionSidebar
          sessions={[session]}
          onSelect={() => {}}
        />
      </ThemeProvider>,
    );

    const dot = container.querySelector(".bg-green-500");
    expect(dot).toBeTruthy();
    expect(container.querySelector(".bg-red-500")).toBeNull();
  });

  it("renders the inline PiLogo SVG in the header brand button", () => {
    const { container } = render(
      <ThemeProvider>
        <SessionSidebar
          sessions={[]}
          onSelect={() => {}}
        />
      </ThemeProvider>,
    );

    const headerBtn = container.querySelector("button[title='Home']");
    expect(headerBtn).toBeTruthy();
    // No literal π text node
    expect(headerBtn?.textContent?.trim()).toBe("");
    // Inline SVG with the brand aria-label, transparent (no <img> with raster src)
    const svg = headerBtn?.querySelector("svg[aria-label='Pi Dashboard']");
    expect(svg).toBeTruthy();
    expect(headerBtn?.querySelector("img")).toBeNull();
  });
});
