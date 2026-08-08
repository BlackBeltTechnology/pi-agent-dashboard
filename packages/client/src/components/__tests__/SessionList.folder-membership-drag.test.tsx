/**
 * Which sidebar message a folder-membership drag emits, and which it must
 * NOT. jsdom cannot reproduce dnd-kit's geometric collision, so — like
 * `SessionList.expanded-pinned-drag.test.tsx` — we capture the live
 * `DndContext` handlers and drive the drag lifecycle directly. Collision
 * detection itself is unit-tested in `lib/__tests__/sidebar-dnd.test.ts`.
 *
 * Covers test-plan #F1-#F10, #F14, #F15, #F17.
 * See change: drag-folders-across-workspaces.
 */

import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

let handlers: {
  onDragStart?: (e: DragStartEvent) => void;
  onDragOver?: (e: DragOverEvent) => void;
  onDragEnd?: (e: DragEndEvent) => void;
  onDragCancel?: () => void;
} = {};

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children, ...rest }: any) => {
      handlers = rest;
      return <>{children}</>;
    },
  };
});

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  handlers = {};
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

const A_FOLDER = "/proj/a";
const B_FOLDERS = ["/proj/x", "/proj/y", "/proj/z"];
const PINNED = "/proj/p";

function makeWorkspaces(): Workspace[] {
  return [
    { id: "A", name: "Alpha", collapsed: false, folders: [A_FOLDER] },
    { id: "B", name: "Beta", collapsed: false, folders: [...B_FOLDERS] },
  ];
}

function drag(
  activeId: string,
  activeData: Record<string, unknown>,
  overId: string,
  overData: Record<string, unknown>,
): DragEndEvent {
  return {
    active: { id: activeId, data: { current: activeData } },
    over: { id: overId, data: { current: overData } },
  } as unknown as DragEndEvent;
}

type ListProps = React.ComponentProps<typeof SessionList>;

interface Spies {
  onMoveFolderToWorkspace: Mock<NonNullable<ListProps["onMoveFolderToWorkspace"]>>;
  onReorderWorkspaceFolders: Mock<NonNullable<ListProps["onReorderWorkspaceFolders"]>>;
  onReorderPinnedDirs: Mock<NonNullable<ListProps["onReorderPinnedDirs"]>>;
  onReorderSessions: Mock<NonNullable<ListProps["onReorderSessions"]>>;
  onSetWorkspaceCollapsed: Mock<NonNullable<ListProps["onSetWorkspaceCollapsed"]>>;
}

function renderList(extra: Partial<ListProps> = {}): Spies {
  const spies: Spies = {
    onMoveFolderToWorkspace: vi.fn(),
    onReorderWorkspaceFolders: vi.fn(),
    onReorderPinnedDirs: vi.fn(),
    onReorderSessions: vi.fn(),
    onSetWorkspaceCollapsed: vi.fn(),
  };
  render(
    <TestRouter>
      <ThemeProvider>
        <SessionList
          sessions={[]}
          onSelect={() => {}}
          workspaces={makeWorkspaces()}
          {...spies}
          {...extra}
        />
      </ThemeProvider>
    </TestRouter>,
  );
  return spies;
}

describe("folder membership drags", () => {
  // #F1 — a header drop APPENDS, so no index rides along.
  it("sends an indexless move when a pinned dir is dropped on a workspace header", () => {
    const s = renderList({ pinnedDirectories: [PINNED] });
    handlers.onDragEnd?.(
      drag(PINNED, { type: "pinned-group" }, "wsh:B", { type: "workspace-header", wsId: "B" }),
    );
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledTimes(1);
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledWith(PINNED, "B", undefined);
  });

  // #F2 — a slot drop carries the target-array position.
  it("sends the target slot index when a workspace folder is dropped on another workspace's folder", () => {
    const s = renderList();
    handlers.onDragEnd?.(
      drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, "/proj/y", {
        type: "workspace-folder",
        wsId: "B",
      }),
    );
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledWith(A_FOLDER, "B", 1);
  });

  // #F3
  it("sends the target slot index when a pinned dir is dropped on a workspace folder", () => {
    const s = renderList({ pinnedDirectories: [PINNED] });
    handlers.onDragEnd?.(
      drag(PINNED, { type: "pinned-group" }, "/proj/y", { type: "workspace-folder", wsId: "B" }),
    );
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledWith(PINNED, "B", 1);
  });

  // #F4 — exactly ONE workspace message; no add/remove pair.
  it("emits exactly one workspace message for a cross-workspace move", () => {
    const s = renderList();
    handlers.onDragEnd?.(
      drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, "wsh:B", {
        type: "workspace-header",
        wsId: "B",
      }),
    );
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledTimes(1);
    expect(s.onReorderWorkspaceFolders).not.toHaveBeenCalled();
    expect(s.onReorderPinnedDirs).not.toHaveBeenCalled();
  });

  // #F5
  it("sends a null target when a workspace folder is dropped on a pinned group", () => {
    const s = renderList({ pinnedDirectories: [PINNED] });
    handlers.onDragEnd?.(
      drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, PINNED, { type: "pinned-group" }),
    );
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledWith(A_FOLDER, null, undefined);
  });

  it("sends a null target when a workspace folder is dropped on the empty-tier zone", () => {
    const s = renderList();
    handlers.onDragEnd?.(
      drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, "__pinned_tier__", {
        type: "pinned-tier",
      }),
    );
    expect(s.onMoveFolderToWorkspace).toHaveBeenCalledWith(A_FOLDER, null, undefined);
  });

  // #F6 — the shipped intra-workspace reorder must not regress into a move.
  it("keeps a same-workspace folder drop on the reorder path", () => {
    const s = renderList();
    handlers.onDragEnd?.(
      drag("/proj/x", { type: "workspace-folder", wsId: "B" }, "/proj/y", {
        type: "workspace-folder",
        wsId: "B",
      }),
    );
    expect(s.onReorderWorkspaceFolders).toHaveBeenCalledWith("B", ["/proj/y", "/proj/x", "/proj/z"]);
    expect(s.onMoveFolderToWorkspace).not.toHaveBeenCalled();
  });

  // #F7 — the shipped pinned reorder must not regress into a move.
  it("keeps a pinned-on-pinned drop on the reorder path", () => {
    const s = renderList({ pinnedDirectories: [PINNED, "/proj/q"] });
    handlers.onDragEnd?.(
      drag(PINNED, { type: "pinned-group" }, "/proj/q", { type: "pinned-group" }),
    );
    expect(s.onReorderPinnedDirs).toHaveBeenCalledTimes(1);
    expect(s.onMoveFolderToWorkspace).not.toHaveBeenCalled();
  });

  // #F8 — the loosened collision matrix must not let a session card land on
  // a workspace target.
  it.each([
    ["wsh:B", { type: "workspace-header", wsId: "B" }],
    ["/proj/y", { type: "workspace-folder", wsId: "B" }],
  ])("ignores a session dropped on %s", (overId, overData) => {
    const s = renderList();
    handlers.onDragEnd?.(drag("s1", { type: "session" }, overId as string, overData as any));
    expect(s.onMoveFolderToWorkspace).not.toHaveBeenCalled();
    expect(s.onReorderWorkspaceFolders).not.toHaveBeenCalled();
    expect(s.onReorderSessions).not.toHaveBeenCalled();
  });

  // #F9 — a release on your own slot is a no-op.
  it("sends nothing when a folder is released on its own slot", () => {
    const s = renderList();
    handlers.onDragEnd?.(
      drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, A_FOLDER, {
        type: "workspace-folder",
        wsId: "A",
      }),
    );
    expect(s.onMoveFolderToWorkspace).not.toHaveBeenCalled();
    expect(s.onReorderWorkspaceFolders).not.toHaveBeenCalled();
  });

  // #F10 — dropping on your OWN header would otherwise detach-and-re-append,
  // silently jumping the folder to the bottom.
  it("sends nothing when a folder is dropped on its own workspace's header", () => {
    const s = renderList();
    handlers.onDragEnd?.(
      drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, "wsh:A", {
        type: "workspace-header",
        wsId: "A",
      }),
    );
    expect(s.onMoveFolderToWorkspace).not.toHaveBeenCalled();
    expect(s.onReorderWorkspaceFolders).not.toHaveBeenCalled();
  });
});

describe("spring-load and drag-collapse never persist collapse state", () => {
  const collapsedB: Workspace[] = [
    { id: "A", name: "Alpha", collapsed: false, folders: [A_FOLDER] },
    { id: "B", name: "Beta", collapsed: true, folders: [...B_FOLDERS] },
  ];

  function springOpenB() {
    handlers.onDragStart?.({
      active: { id: A_FOLDER, data: { current: { type: "workspace-folder", wsId: "A" } } },
    } as unknown as DragStartEvent);
    act(() => {
      handlers.onDragOver?.({
        active: { id: A_FOLDER, data: { current: { type: "workspace-folder", wsId: "A" } } },
        over: { id: "wsh:B", data: { current: { type: "workspace-header", wsId: "B" } } },
      } as unknown as DragOverEvent);
      vi.advanceTimersByTime(600);
    });
  }

  // #F14
  it("spring-expands a collapsed workspace, re-collapses on drop AND on cancel, and never persists", () => {
    vi.useFakeTimers();
    try {
      const s = renderList({ workspaces: collapsedB });
      // Collapsed → B's folders are not mounted.
      expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(1);

      springOpenB();
      expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(4);

      act(() => {
        handlers.onDragEnd?.(
          drag(A_FOLDER, { type: "workspace-folder", wsId: "A" }, "/proj/y", {
            type: "workspace-folder",
            wsId: "B",
          }),
        );
      });
      expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(1);

      // Second drag, cancelled instead of dropped.
      springOpenB();
      expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(4);
      act(() => handlers.onDragCancel?.());
      expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(1);

      expect(s.onSetWorkspaceCollapsed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // #F15 — the shipped workspace drag-collapse is untouched by spring-load.
  it("renders a dragged workspace collapsed for the drag and expanded after, without persisting", () => {
    const s = renderList();
    expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(4);
    act(() =>
      handlers.onDragStart?.({
        active: { id: "A", data: { current: { type: "workspace" } } },
      } as unknown as DragStartEvent),
    );
    // A collapses locally; B is untouched.
    expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(3);
    act(() => handlers.onDragCancel?.());
    expect(screen.getAllByTestId("sortable-workspace-folder")).toHaveLength(4);
    expect(s.onSetWorkspaceCollapsed).not.toHaveBeenCalled();
  });
});

describe("empty-tier eject zone", () => {
  // #F17 — a non-empty pinned tier already offers eject targets; a second
  // overlapping zone would make nearest-center resolution arbitrary.
  it("is absent while a folder drag is active but the pinned tier is non-empty", () => {
    renderList({ pinnedDirectories: [PINNED] });
    act(() =>
      handlers.onDragStart?.({
        active: { id: A_FOLDER, data: { current: { type: "workspace-folder", wsId: "A" } } },
      } as unknown as DragStartEvent),
    );
    expect(screen.queryByTestId("pinned-tier-drop-zone")).toBeNull();
  });

  it("is absent when no drag is active", () => {
    renderList();
    expect(screen.queryByTestId("pinned-tier-drop-zone")).toBeNull();
  });

  it("mounts when the pinned tier is empty and a workspace-folder drag starts", () => {
    renderList();
    act(() =>
      handlers.onDragStart?.({
        active: { id: A_FOLDER, data: { current: { type: "workspace-folder", wsId: "A" } } },
      } as unknown as DragStartEvent),
    );
    expect(screen.getByTestId("pinned-tier-drop-zone")).toBeTruthy();
  });
});
