import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import React from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { DragEndEvent } from "@dnd-kit/core";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

// Capture the live `onDragEnd` the real component hands to <DndContext> so
// the test can drive the drag-end branch deterministically. jsdom cannot
// reproduce the geometric collision that the bug depends on, so we exercise
// the reorder dispatch directly (collision detection itself is unit-tested
// in lib/__tests__/sidebar-dnd.test.ts). See change: fix-expanded-pinned-group-drag.
let capturedOnDragEnd: ((event: DragEndEvent) => void) | undefined;

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode;
      onDragEnd?: (event: DragEndEvent) => void;
    }) => {
      capturedOnDragEnd = onDragEnd;
      return <>{children}</>;
    },
  };
});

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  capturedOnDragEnd = undefined;
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

function dragEnd(
  activeId: string,
  activeType: string,
  overId: string,
  overType: string,
): DragEndEvent {
  return {
    active: { id: activeId, data: { current: { type: activeType } } },
    over: { id: overId, data: { current: { type: overType } } },
  } as unknown as DragEndEvent;
}

describe("Expanded pinned-group drag-to-reorder", () => {
  it("reorders pinned groups when both groups are expanded", () => {
    const onReorderPinnedDirs = vi.fn();
    const onReorderSessions = vi.fn();
    const sessions = [
      makeSession("s1", "/pinned-a", 1000),
      makeSession("s2", "/pinned-b", 2000),
    ];
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            onSelect={() => {}}
            sessionOrderMap={new Map([
              ["/pinned-a", ["s1"]],
              ["/pinned-b", ["s2"]],
            ])}
            pinnedDirectories={["/pinned-a", "/pinned-b"]}
            onReorderSessions={onReorderSessions}
            onReorderPinnedDirs={onReorderPinnedDirs}
          />
        </ThemeProvider>
      </TestRouter>,
    );

    expect(capturedOnDragEnd).toBeTypeOf("function");
    // Drag pinned group A onto pinned group B.
    capturedOnDragEnd?.(dragEnd("/pinned-a", "pinned-group", "/pinned-b", "pinned-group"));

    expect(onReorderPinnedDirs).toHaveBeenCalledTimes(1);
    expect(onReorderPinnedDirs).toHaveBeenCalledWith(["/pinned-b", "/pinned-a"]);
    expect(onReorderSessions).not.toHaveBeenCalled();
  });

  it("does not reorder pinned groups when a session card is dragged inside an expanded group", () => {
    const onReorderPinnedDirs = vi.fn();
    const onReorderSessions = vi.fn();
    const sessions = [
      makeSession("s1", "/pinned-a", 1000),
      makeSession("s2", "/pinned-a", 2000),
    ];
    render(
      <TestRouter>
        <ThemeProvider>
          <SessionList
            sessions={sessions}
            onSelect={() => {}}
            sessionOrderMap={new Map([["/pinned-a", ["s1", "s2"]]])}
            pinnedDirectories={["/pinned-a"]}
            onReorderSessions={onReorderSessions}
            onReorderPinnedDirs={onReorderPinnedDirs}
          />
        </ThemeProvider>
      </TestRouter>,
    );

    expect(capturedOnDragEnd).toBeTypeOf("function");
    // Drag session s1 onto s2 inside the expanded pinned group.
    capturedOnDragEnd?.(dragEnd("s1", "session", "s2", "session"));

    expect(onReorderSessions).toHaveBeenCalledTimes(1);
    expect(onReorderSessions).toHaveBeenCalledWith("/pinned-a", ["s2", "s1"]);
    expect(onReorderPinnedDirs).not.toHaveBeenCalled();
  });
});
