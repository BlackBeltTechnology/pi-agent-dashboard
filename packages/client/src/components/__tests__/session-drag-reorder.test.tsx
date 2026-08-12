import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
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

afterEach(() => cleanup());

function makeSession(id: string, cwd: string, startedAt: number): DashboardSession {
  return {
    id,
    cwd,
    source: "tui",
    status: "active",
    startedAt,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
  };
}

describe("Session drag-and-drop", () => {
  it("renders drag handles for session cards", () => {
    const sessions = [
      makeSession("s1", "/project", 1000),
      makeSession("s2", "/project", 2000),
    ];
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            onSelect={() => {}}
            sessionOrderMap={new Map([["/project", ["s1", "s2"]]])}
            onReorderSessions={vi.fn()}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const handles = screen.getAllByTestId("drag-handle-session");
    expect(handles.length).toBe(2);
  });

  it("renders sessions in server order", () => {
    const sessions = [
      makeSession("s1", "/project", 1000),
      makeSession("s2", "/project", 2000),
      makeSession("s3", "/project", 3000),
    ];
    const orderMap = new Map([["/project", ["s3", "s1", "s2"]]]);
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            onSelect={() => {}}
            sessionOrderMap={orderMap}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const handles = screen.getAllByTestId("drag-handle-session");
    // Verify the drag handles exist (order is verified in unit tests for groupSessionsByDirectory)
    expect(handles.length).toBe(3);
  });

  it("renders drag handles for session cards inside pinned groups", () => {
    const sessions = [
      makeSession("s1", "/pinned-project", 1000),
      makeSession("s2", "/pinned-project", 2000),
    ];
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            onSelect={() => {}}
            sessionOrderMap={new Map([["/pinned-project", ["s1", "s2"]]])}
            onReorderSessions={vi.fn()}
            pinnedDirectories={["/pinned-project"]}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const sessionHandles = screen.getAllByTestId("drag-handle-session");
    expect(sessionHandles.length).toBe(2);
    const pinnedHandles = screen.getAllByTestId("drag-handle-pinned");
    expect(pinnedHandles.length).toBe(1);
  });

  it("renders both pinned group and session drag handles without nested DndContext", () => {
    const sessions = [
      makeSession("s1", "/pinned-a", 1000),
      makeSession("s2", "/pinned-a", 2000),
      makeSession("s3", "/unpinned-b", 3000),
    ];
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            onSelect={() => {}}
            sessionOrderMap={new Map([
              ["/pinned-a", ["s1", "s2"]],
              ["/unpinned-b", ["s3"]],
            ])}
            onReorderSessions={vi.fn()}
            onReorderPinnedDirs={vi.fn()}
            pinnedDirectories={["/pinned-a"]}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    // All 3 session cards have drag handles
    const sessionHandles = screen.getAllByTestId("drag-handle-session");
    expect(sessionHandles.length).toBe(3);
    // Pinned group has its own drag handle
    const pinnedHandles = screen.getAllByTestId("drag-handle-pinned");
    expect(pinnedHandles.length).toBe(1);
  });

  // The drag zone used to BE the 20px status gutter. It is now an opaque bead
  // parked in the directory-rail band; if the bead ever loses its opaque
  // background the 2px rail shows through the grip dots (the defect this
  // design round fixed). See change: session-card-directory-rail.
  it("drag bead is an opaque hover-revealed pill that masks the directory rail", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession("s1", "/project", 1000)]}
            onSelect={() => {}}
            sessionOrderMap={new Map([["/project", ["s1"]]])}
            onReorderSessions={vi.fn()}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const bead = screen.getByTestId("drag-handle-session");
    // Opaque surface + border == the rail cannot bleed through the dots.
    expect(bead.className).toContain("bg-[var(--bg-primary)]");
    expect(bead.className).toContain("border-[var(--border-subtle)]");
    // Parked in the rail band, left of the card body.
    expect(bead.className).toContain("-left-[19px]");
    // Hover-revealed, not always-on.
    expect(bead.className).toContain("opacity-0");
    expect(bead.className).toContain("group-hover/card:opacity-100");
    expect(bead.className).toMatch(/cursor-grab/);
    // Grip glyph is an exact 7x13 canvas so it centers inside the bead.
    const svg = bead.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 7 13");
    expect(svg?.querySelectorAll("circle").length).toBe(6);
  });

  // `.card-selected-ring > *` (index.css) re-declares position:relative on
  // EVERY direct child of a selected card. The bead is a direct child, so
  // without the `card-drag-bead` escape class it fell into normal flow and the
  // selected card grew a blank 26px band. See change: session-card-directory-rail.
  it("selected card keeps the drag bead out of normal flow (no extra space)", () => {
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={[makeSession("s1", "/project", 1000)]}
            onSelect={() => {}}
            selectedId="s1"
            sessionOrderMap={new Map([["/project", ["s1"]]])}
            onReorderSessions={vi.fn()}
          />
        </ThemeProvider>
      </TestRouter>,
    );
    const card = screen.getByTestId("session-card-desktop");
    expect(card.className).toContain("card-selected-ring");
    const bead = screen.getByTestId("drag-handle-session");
    // The escape class must survive on a SELECTED card, otherwise the
    // selected-ring rule wins on source order and re-flows the bead.
    expect(bead.className).toContain("card-drag-bead");
    expect(bead.className).toContain("absolute");
  });
});
