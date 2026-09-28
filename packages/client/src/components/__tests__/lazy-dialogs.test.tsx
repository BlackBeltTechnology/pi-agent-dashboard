/**
 * The REAL code-split dialog loaders (the global test setup maps the lazy
 * wrappers to eager components): each loader resolves to the component it
 * names. See change: redesign-composer-session-strip.
 */
import { describe, expect, it, vi } from "vitest";

describe("code-split dialog loaders", () => {
  it("openspec dialog loaders resolve to their components", async () => {
    const { openspecDialogLoaders: L } = await vi.importActual<typeof import("../openspec/lazy-openspec-dialogs.js")>(
      "../openspec/lazy-openspec-dialogs.js",
    );
    expect((await L.AttachChangePicker()).default).toBe((await import("../openspec/AttachChangePicker.js")).AttachChangePicker);
    expect((await L.ExploreDialog()).default).toBe((await import("../openspec/ExploreDialog.js")).ExploreDialog);
    expect((await L.NewChangeDialog()).default).toBe((await import("../openspec/NewChangeDialog.js")).NewChangeDialog);
    expect((await L.ProposeDialog()).default).toBe((await import("../openspec/ProposeDialog.js")).ProposeDialog);
    expect((await L.TasksPopover()).default).toBe((await import("../session/TasksPopover.js")).TasksPopover);
  });

  it("worktree dialog loaders resolve to their components", async () => {
    const { worktreeDialogLoaders: L } = await vi.importActual<typeof import("../worktree/lazy-worktree-dialogs.js")>(
      "../worktree/lazy-worktree-dialogs.js",
    );
    expect((await L.CloseWorktreeDialog()).default).toBe((await import("../worktree/CloseWorktreeDialog.js")).CloseWorktreeDialog);
    expect((await L.MergeConfirmDialog()).default).toBe((await import("../worktree/MergeConfirmDialog.js")).MergeConfirmDialog);
  });
});
