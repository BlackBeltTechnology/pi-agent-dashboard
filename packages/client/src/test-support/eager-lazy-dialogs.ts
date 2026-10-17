/**
 * Vitest `setupFiles` shim: map the code-split click-only dialogs
 * (`lazy-openspec-dialogs.ts`, `lazy-worktree-dialogs.ts`) to their EAGER
 * components, so unit tests keep asserting a dialog synchronously after the
 * click that opens it. Production keeps the split (cold-landing chunk cap).
 * The real lazy wrappers are covered by `lazy-dialogs.test.tsx`
 * (`vi.importActual`). See change: redesign-composer-session-strip.
 */
import { vi } from "vitest";

vi.mock("../components/openspec/lazy-openspec-dialogs.js", async () => ({
  LazyAttachChangePicker: (await import("../components/openspec/AttachChangePicker.js")).AttachChangePicker,
  LazyExploreDialog: (await import("../components/openspec/ExploreDialog.js")).ExploreDialog,
  LazyNewChangeDialog: (await import("../components/openspec/NewChangeDialog.js")).NewChangeDialog,
  LazyProposeDialog: (await import("../components/openspec/ProposeDialog.js")).ProposeDialog,
  LazyTasksPopover: (await import("../components/session/TasksPopover.js")).TasksPopover,
}));

vi.mock("../components/worktree/lazy-worktree-dialogs.js", async () => ({
  LazyCloseWorktreeDialog: (await import("../components/worktree/CloseWorktreeDialog.js")).CloseWorktreeDialog,
  LazyMergeConfirmDialog: (await import("../components/worktree/MergeConfirmDialog.js")).MergeConfirmDialog,
  LazyWorktreeSpawnDialog: (await import("../components/worktree/WorktreeSpawnDialog.js")).WorktreeSpawnDialog,
  LazyBranchSwitchDialog: (await import("../components/worktree/BranchSwitchDialog.js")).BranchSwitchDialog,
}));

// The session actions flyout's code-split panel + per-card dialog host
// (`lazy-session-menu.ts`). See change: add-session-actions-flyout.
vi.mock("../components/session/lazy-session-menu.js", async () => ({
  LazySessionActionsPanel: (await import("../components/session/SessionActionsPanel.js")).SessionActionsPanel,
  LazySessionCardDialogs: (await import("../components/session/SessionCardDialogs.js")).SessionCardDialogs,
  prefetchSessionActionsPanel: () => undefined,
}));
