/**
 * `WorkspaceHeader`'s dedicated append droppable. Covers test-plan #F19.
 *
 * jsdom has no layout, so dnd-kit never computes `isOver`; the droppable
 * registration and the `isOver` → indicator wiring are asserted by stubbing
 * `useDroppable`. Whether a header WINS the collision is decided by
 * `compatibleClosestCenter` (unit-tested in `lib/__tests__/sidebar-dnd.test.ts`).
 *
 * See change: drag-folders-across-workspaces.
 */

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DROP_INDICATOR_CLASS } from "../../lib/layout/sidebar-dnd.js";
import { WorkspaceHeader } from "../workspace/WorkspaceHeader.js";

const droppableCalls: Array<{ id: string; data: Record<string, unknown> }> = [];
let isOver = false;

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useDroppable: (args: { id: string; data: Record<string, unknown> }) => {
      droppableCalls.push(args);
      return { setNodeRef: () => {}, isOver };
    },
  };
});

beforeEach(() => {
  droppableCalls.length = 0;
  isOver = false;
});
afterEach(() => cleanup());

function renderHeader() {
  return render(
    <WorkspaceHeader
      id="B"
      name="Beta"
      collapsed={false}
      folderCount={3}
      onToggleCollapsed={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
    />,
  );
}

describe("WorkspaceHeader append droppable", () => {
  // The `wsId` payload is mandatory — resolvers must not string-parse the
  // `wsh:` prefix to recover the target workspace.
  it("registers a namespaced header droppable carrying wsId", () => {
    renderHeader();
    const call = droppableCalls.find((c) => c.id === "wsh:B");
    expect(call).toBeDefined();
    expect(call!.data).toEqual({ type: "workspace-header", wsId: "B" });
  });

  it("shows no drop indicator when not hovered", () => {
    renderHeader();
    const header = screen.getByTestId("workspace-header-B");
    expect(header.getAttribute("data-over")).toBeNull();
    expect(header.className).not.toContain(DROP_INDICATOR_CLASS);
  });

  // #F19
  it("shows the standard drop indicator while hovered", () => {
    isOver = true;
    renderHeader();
    const header = screen.getByTestId("workspace-header-B");
    expect(header.getAttribute("data-over")).toBe("true");
    expect(header.className).toContain(DROP_INDICATOR_CLASS);
  });
});
