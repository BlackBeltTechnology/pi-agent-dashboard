import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { SortableWorkspace } from "../workspace/SortableWorkspace.js";
import { SortableWorkspaceFolder } from "../workspace/SortableWorkspaceFolder.js";
import { SortableSessionCard } from "../session/SortableSessionCard.js";
import { DndContext } from "@dnd-kit/core";
import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

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

const workspaces: Workspace[] = [
  { id: "w1", name: "Alpha", collapsed: false, folders: ["/proj/a", "/proj/b"] },
  { id: "w2", name: "Beta", collapsed: false, folders: ["/proj/c"] },
];

function renderList(extra: Partial<React.ComponentProps<typeof SessionList>> = {}) {
  return render(
    <TestRouter>
      <ThemeProvider>
        <SessionList
          sessions={[]}
          onSelect={() => {}}
          workspaces={workspaces}
          onSetWorkspaceCollapsed={vi.fn()}
          onReorderWorkspaces={vi.fn()}
          onReorderWorkspaceFolders={vi.fn()}
          {...extra}
        />
      </ThemeProvider>
    </TestRouter>,
  );
}

describe("Workspace + folder drag handles", () => {
  it("renders a drag handle per workspace header", () => {
    renderList();
    expect(screen.getByTestId("workspace-drag-handle-w1")).toBeTruthy();
    expect(screen.getByTestId("workspace-drag-handle-w2")).toBeTruthy();
  });

  it("wraps each workspace in a SortableWorkspace", () => {
    renderList();
    expect(screen.getAllByTestId("sortable-workspace").length).toBe(2);
  });

  it("wraps each intra-workspace folder in a SortableWorkspaceFolder", () => {
    renderList();
    // w1 has 2 folders, w2 has 1 → 3 total
    expect(screen.getAllByTestId("sortable-workspace-folder").length).toBe(3);
  });
});

// Drop indicator: the active-state logic is unit-tested in sidebar-dnd.test
// (`dropIndicatorProps`). The three sidebar wrappers wire it; the session
// wrapper does NOT. Here we assert the wrappers render and that the session
// wrapper never emits a drop-indicator slot (a real pointer drag that toggles
// `isOver` is infeasible in jsdom).
describe("Workspace collapse wiring (drag-collapse is local-only)", () => {
  it("renders the body when serverCollapsed is false, hides it when true", () => {
    const onSet = vi.fn();
    const { rerender } = render(
      <TestRouter><ThemeProvider>
        <SessionList sessions={[]} onSelect={() => {}} onSetWorkspaceCollapsed={onSet}
          workspaces={[{ id: "w1", name: "Alpha", collapsed: false, folders: ["/proj/a"] }]} />
      </ThemeProvider></TestRouter>,
    );
    // Expanded → folder sortable present.
    expect(screen.queryByTestId("sortable-workspace-folder")).toBeTruthy();
    rerender(
      <TestRouter><ThemeProvider>
        <SessionList sessions={[]} onSelect={() => {}} onSetWorkspaceCollapsed={onSet}
          workspaces={[{ id: "w1", name: "Alpha", collapsed: true, folders: ["/proj/a"] }]} />
      </ThemeProvider></TestRouter>,
    );
    // Collapsed → body (and its folders) gone.
    expect(screen.queryByTestId("sortable-workspace-folder")).toBeNull();
    // Rendering never persists collapse state.
    expect(onSet).not.toHaveBeenCalled();
  });
});

describe("Drop indicator wiring", () => {
  it("renders the three indicator-bearing wrappers", () => {
    render(
      <DndContext>
        <SortableWorkspace id="w"><span>w</span></SortableWorkspace>
        <SortableWorkspaceFolder id="/f" wsId="w"><span>f</span></SortableWorkspaceFolder>
      </DndContext>,
    );
    expect(screen.getByTestId("sortable-workspace")).toBeTruthy();
    expect(screen.getByTestId("sortable-workspace-folder")).toBeTruthy();
  });

  it("session card wrapper never renders a drop-indicator slot", () => {
    render(
      <DndContext>
        <SortableSessionCard id="s1"><span>card</span></SortableSessionCard>
      </DndContext>,
    );
    expect(document.querySelectorAll('[data-over]').length).toBe(0);
  });
});
