/**
 * Menu gating for the `manage-worktrees` folder action.
 *
 * Two guarantees:
 *   1. Not a git repository → the item is absent (test-plan #F5).
 *   2. A group with no applicable workspace items renders no workspace
 *      heading — guards the MODIFIED folder-actions-menu delta against
 *      dropping the empty-group suppression (test-plan #F6).
 *
 * See change: manage-worktrees-filter-cleanup.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderActionsMenu, type FolderMenuItem } from "../folder/FolderActionsMenu.js";
import { folderIsGitRepo } from "../session/SessionList.js";

afterEach(() => cleanup());

// test-plan #F5 / #F4 — gating is on the REPO, never on live sessions.
describe("folderIsGitRepo gating", () => {
  it("excludes a folder positively known not to be a git repository", () => {
    expect(folderIsGitRepo({ sessions: [{ isGitRepo: false }] })).toBe(false);
    expect(folderIsGitRepo({ sessions: [{ isGitRepo: false }, { isGitRepo: false }] })).toBe(false);
  });

  it("keeps a git-repo folder with ZERO live sessions eligible", () => {
    // The manage surface exists to clean up worktrees that have no sessions,
    // so a session-count gate would defeat its purpose.
    expect(folderIsGitRepo({ sessions: [] })).toBe(true);
  });

  it("keeps a folder whose repo-ness is unknown eligible", () => {
    expect(folderIsGitRepo({ sessions: [{}] })).toBe(true);
    expect(folderIsGitRepo({ sessions: [{ isGitRepo: true }] })).toBe(true);
  });
});

// test-plan #F6
describe("FolderActionsMenu empty groups", () => {
  function renderMenu(items: FolderMenuItem[]) {
    render(
      <FolderActionsMenu
        items={items}
        open
        onClose={() => {}}
        anchorRef={{ current: document.createElement("div") } as any}
      />,
    );
  }

  it("renders no workspace heading when no workspace item applies", () => {
    renderMenu([
      {
        id: "manage-worktrees",
        group: "directory",
        label: "Manage worktrees",
        icon: "",
        onSelect: vi.fn(),
      },
    ]);
    expect(screen.queryByTestId("folder-menu-group-workspace")).toBeNull();
    expect(screen.getByTestId("folder-menu-group-directory")).toBeTruthy();
    expect(screen.getByText("Manage worktrees")).toBeTruthy();
  });

  it("renders the workspace group only when it holds an item", () => {
    renderMenu([
      { id: "pin", group: "directory", label: "Pin directory", icon: "", onSelect: vi.fn() },
      {
        id: "add-to-workspace",
        group: "workspace",
        label: "Add to workspace",
        icon: "",
        onSelect: vi.fn(),
      },
    ]);
    expect(screen.getByTestId("folder-menu-group-workspace")).toBeTruthy();
    expect(screen.getByTestId("folder-menu-group-directory")).toBeTruthy();
  });
});
