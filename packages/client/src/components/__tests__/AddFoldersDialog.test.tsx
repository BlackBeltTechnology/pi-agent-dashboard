/**
 * Tests for AddFoldersDialog — the file-manager Add Folders flow.
 * Covers commit targets (selection, else the browsed folder, never implicit
 * home), already-added skip + labels, the status line, Escape-clears-first,
 * the single-select workspace destination, the absence of any pin control,
 * pins-before-workspace-adds ordering, and session badges.
 * See changes: redesign-folder-workspace-add-flow, simplify-add-folder-picker.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddFoldersDialog } from "../workspace/AddFoldersDialog.js";

const mockBrowse = vi.fn();
const mockClassify = vi.fn();
const mockMkdir = vi.fn();
vi.mock("../../lib/api/browse-api.js", () => ({
  browseDirectory: (...args: unknown[]) => mockBrowse(...args),
  classifyPaths: (...args: unknown[]) => mockClassify(...args),
  createDirectory: (...args: unknown[]) => mockMkdir(...args),
}));

const HOME = {
  current: "/home/user",
  parent: "/home",
  entries: [
    { name: "work", path: "/home/user/work" },
    { name: "projects", path: "/home/user/projects" },
    { name: "scratch", path: "/home/user/scratch" },
  ],
};
const WORK = { current: "/home/user/work", parent: "/home/user", entries: [{ name: "src", path: "/home/user/work/src" }] };
const PROJECTS = {
  current: "/home/user/projects",
  parent: "/home/user",
  entries: [{ name: "alpha", path: "/home/user/projects/alpha" }],
};

const WORKSPACES = [
  { id: "fe", name: "Frontend", collapsed: false, folders: [] },
  { id: "be", name: "Backend", collapsed: false, folders: [] },
];

afterEach(() => cleanup());

describe("AddFoldersDialog", () => {
  const onPin = vi.fn();
  const onAddFolderToWorkspace = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(HOME);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  function renderDialog(props: Record<string, unknown> = {}) {
    return render(
      <AddFoldersDialog
        workspaces={WORKSPACES}
        initialPath="/home/user/"
        onPin={onPin}
        onAddFolderToWorkspace={onAddFolderToWorkspace}
        onCancel={onCancel}
        {...props}
      />,
    );
  }

  const row = (path: string) => screen.getByTestId(`path-picker-row-${path}`);
  const commit = () => screen.getByTestId("add-folders-commit") as HTMLButtonElement;
  const dest = () => screen.getByTestId("add-folders-dest") as HTMLSelectElement;

  it("renders no pin control anywhere — pinning is implicit", async () => {
    const { container } = renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(container.textContent).not.toMatch(/pin to dashboard/i);
    expect(container.querySelector('input[type="checkbox"][name*="pin" i]')).toBeNull();
    expect(screen.queryByTestId("add-folders-pin-toggle")).toBeNull();
  });

  it("commit with None pins every path and adds none to a workspace", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    fireEvent.click(row("/home/user/work"));
    fireEvent.click(row("/home/user/scratch"), { ctrlKey: true });
    expect(commit().textContent).toBe("Add 2 folders");
    fireEvent.click(commit());

    expect(onPin.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/home/user/scratch",
      "/home/user/work",
    ]);
    expect(onAddFolderToWorkspace).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("commit with a workspace pins FIRST, then adds every path to it", async () => {
    const order: string[] = [];
    renderDialog({
      onPin: (p: string) => order.push(`pin:${p}`),
      onAddFolderToWorkspace: (ws: string, p: string) => order.push(`ws:${ws}:${p}`),
    });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    fireEvent.click(row("/home/user/work"));
    fireEvent.change(dest(), { target: { value: "fe" } });
    fireEvent.click(commit());

    expect(order).toEqual(["pin:/home/user/work", "ws:fe:/home/user/work"]);
  });

  it("the destination is one dropdown, single-select, default None", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(dest().value).toBe("");
    expect(dest().selectedOptions[0].textContent).toBe("None (optional)");
    expect([...dest().options].map((o) => o.textContent)).toEqual(["None (optional)", "Frontend", "Backend"]);
    fireEvent.change(dest(), { target: { value: "fe" } });
    expect(dest().value).toBe("fe");
    fireEvent.change(dest(), { target: { value: "be" } });
    expect(dest().value).toBe("be");
    // No pills / radio chips remain.
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("preselects the workspace it was opened from and says why", async () => {
    renderDialog({ initialWorkspaceId: "be" });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(dest().value).toBe("be");
    expect(screen.getByTestId("add-folders-dest-why").textContent).toContain("Backend");
    fireEvent.change(dest(), { target: { value: "" } });
    expect(screen.queryByTestId("add-folders-dest-why")).toBeNull();
  });

  it("with zero workspaces the dropdown offers None and + New workspace…", async () => {
    renderDialog({ workspaces: [], onCreateWorkspace: vi.fn() });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect([...dest().options].map((o) => o.textContent)).toEqual(["None (optional)", "+ New workspace…"]);
  });

  it("badges a directory that is a live session cwd, and only that one", async () => {
    renderDialog({ sessionCwds: ["/home/user/work", "/home/user/work/"] });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    // pathKey collapses the trailing-separator drift → one folder, 2 sessions.
    expect(screen.getByTestId("path-picker-sessions-/home/user/work").textContent).toMatch(/2/);
    expect(screen.queryByTestId("path-picker-sessions-/home/user/scratch")).toBeNull();
  });
});

describe("AddFoldersDialog footer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(HOME);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  it("shows exactly one Cancel and no picker-level Select", async () => {
    render(
      <AddFoldersDialog
        workspaces={WORKSPACES}
        initialPath="/home/user/"
        onPin={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(screen.getAllByText("Cancel")).toHaveLength(1);
    expect(screen.queryByText("Select")).toBeNull();
    // "New folder" stays with the picker (mockup footer: New folder … Cancel · Add folders).
    expect(screen.getByText("New folder")).toBeTruthy();
  });
});

describe("AddFoldersDialog new-workspace destination", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(HOME);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  it("a workspace created from the dialog becomes the selected destination", async () => {
    const onCreateWorkspace = vi.fn();
    const { rerender } = render(
      <AddFoldersDialog
        workspaces={[]}
        initialPath="/home/user/"
        onPin={vi.fn()}
        onCreateWorkspace={onCreateWorkspace}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    fireEvent.change(screen.getByTestId("add-folders-dest"), { target: { value: "__new__" } });
    const input = screen.getByRole("textbox", { name: /workspace/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Infra" } });
    fireEvent.submit(input.closest("form") ?? input);
    expect(onCreateWorkspace).toHaveBeenCalledWith("Infra");

    // Server echo arrives with the new workspace.
    rerender(
      <AddFoldersDialog
        workspaces={[{ id: "infra", name: "Infra", collapsed: false, folders: [] }]}
        initialPath="/home/user/"
        onPin={vi.fn()}
        onCreateWorkspace={onCreateWorkspace}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect((screen.getByTestId("add-folders-dest") as HTMLSelectElement).value).toBe("infra"),
    );
  });
});


// simplify-add-folder-picker — commit targets, labels, status line and keys.
// Ids map to openspec/changes/archive/2026-10-20-simplify-add-folder-picker/test-plan.md.
describe("AddFoldersDialog file-manager commit", () => {
  const onPin = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockImplementation(async (dir?: string) => (dir === "/home/user/work" ? WORK : HOME));
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  function renderDialog(props: Record<string, unknown> = {}) {
    return render(
      <AddFoldersDialog workspaces={WORKSPACES} initialPath="/home/user/" onPin={onPin} onCancel={onCancel} {...props} />,
    );
  }
  const row = (path: string) => screen.getByTestId(`path-picker-row-${path}`);
  const commit = () => screen.getByTestId("add-folders-commit") as HTMLButtonElement;
  const dest = () => screen.getByTestId("add-folders-dest") as HTMLSelectElement;
  // Rows AND the picker→dialog onChange must have landed (the label depends on it).
  const ready = () =>
    waitFor(() => {
      expect(screen.getByText("work")).toBeTruthy();
      expect(screen.getByTestId("add-folders-status").textContent).not.toBe("Adds:" + screen.getByTestId("add-folders-hint").textContent);
    });

  describe("E8 — commit target decision table", () => {
    it("nothing selected, not home → Add \"<browsed leaf>\" pins the browsed folder", async () => {
      renderDialog();
      await ready();
      expect(commit().textContent).toBe('Add "user"');
      fireEvent.click(commit());
      expect(onPin.mock.calls).toEqual([["/home/user", true]]);
      expect(onCancel).toHaveBeenCalled();
    });

    it("one pinned row selected → disabled 'Already added'", async () => {
      renderDialog({ pinnedPaths: ["/home/user/work"] });
      await ready();
      fireEvent.click(row("/home/user/work"));
      expect(commit().disabled).toBe(true);
      expect(commit().textContent).toBe("Already added");
    });

    it("pinned + new selected → Add \"<new leaf>\" pins only the new one", async () => {
      renderDialog({ pinnedPaths: ["/home/user/work"] });
      await ready();
      fireEvent.click(row("/home/user/work"));
      fireEvent.click(row("/home/user/scratch"), { ctrlKey: true });
      expect(commit().textContent).toBe('Add "scratch"');
      fireEvent.click(commit());
      expect(onPin.mock.calls).toEqual([["/home/user/scratch", true]]);
    });

    it("two new selected → Add 2 folders pins both, never the browsed parent", async () => {
      renderDialog();
      await ready();
      fireEvent.click(row("/home/user/work"));
      fireEvent.click(row("/home/user/projects"), { ctrlKey: true });
      expect(commit().textContent).toBe("Add 2 folders");
      fireEvent.click(commit());
      expect(onPin.mock.calls.map((c) => c[0])).toEqual(["/home/user/work", "/home/user/projects"]);
    });

    it("browsed folder already pinned, nothing selected → disabled 'Already added'", async () => {
      renderDialog({ pinnedPaths: ["/home/user/"] });
      await ready();
      expect(commit().disabled).toBe(true);
      expect(commit().textContent).toBe("Already added");
    });
  });

  it("E9 — a Windows browsed folder commits in native form without the trailing separator", async () => {
    mockBrowse.mockResolvedValue({ current: "C:\\Users\\me\\", parent: "C:\\Users", entries: [] });
    renderDialog({ initialPath: "C:\\Users\\me\\" });
    await waitFor(() => expect(commit().disabled).toBe(false));
    fireEvent.click(commit());
    expect(onPin.mock.calls).toEqual([["C:\\Users\\me", true]]);
  });

  it("E11 — select-all counts and commits only folders not yet added", async () => {
    renderDialog({ pinnedPaths: ["/home/user/work"] });
    await ready();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "a", ctrlKey: true });
    expect(commit().textContent).toBe("Add 2 folders");
    fireEvent.click(commit());
    expect(onPin.mock.calls.map((c) => c[0])).toEqual(["/home/user/projects", "/home/user/scratch"]);
  });

  it("E13 — opened on home: disabled with a hint, enabled inside a child, disabled again back home", async () => {
    renderDialog({ initialPath: undefined });
    await ready();
    expect(commit().disabled).toBe(true);
    expect(commit().textContent).toBe("Select or open a folder");
    expect(screen.getByTestId("add-folders-status-home").textContent).toMatch(/home folder is never added/);
    fireEvent.click(commit());
    expect(onPin).not.toHaveBeenCalled();

    fireEvent.doubleClick(row("/home/user/work"));
    await waitFor(() => expect(commit().textContent).toBe('Add "work"'));
    expect(commit().disabled).toBe(false);

    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes(".."))!);
    await waitFor(() => expect(commit().textContent).toBe("Select or open a folder"));
  });

  it("E13b — home with a selection is fine (only the implicit fallback is blocked)", async () => {
    renderDialog({ initialPath: undefined });
    await ready();
    fireEvent.click(row("/home/user/work"));
    expect(commit().textContent).toBe('Add "work"');
    expect(commit().disabled).toBe(false);
  });

  it("E14 — with an explicit initialPath the same folder is committable", async () => {
    renderDialog();
    await ready();
    expect(commit().disabled).toBe(false);
  });

  it("F9 — committing right after opening a folder targets that folder", async () => {
    renderDialog();
    await ready();
    fireEvent.doubleClick(row("/home/user/work"));
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    fireEvent.click(commit());
    expect(onPin.mock.calls).toEqual([["/home/user/work", true]]);
  });

  it("F19 — Escape clears the selection first, closes on the second press", async () => {
    renderDialog();
    await ready();
    fireEvent.click(row("/home/user/work"));
    fireEvent.click(row("/home/user/scratch"), { ctrlKey: true });
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("add-folders-dialog")).toBeTruthy();
    expect(commit().textContent).toBe('Add "user"');
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("F25 — status line: browsed path, then selected names with a working Clear", async () => {
    renderDialog();
    await ready();
    expect(screen.getByTestId("add-folders-status").textContent).toContain("Adds:");
    expect(screen.getByTestId("add-folders-status-path").textContent).toBe("/home/user");
    fireEvent.click(row("/home/user/work"));
    fireEvent.click(row("/home/user/scratch"), { ctrlKey: true });
    expect(screen.getByTestId("add-folders-status-selected").textContent).toBe("work, scratch");
    fireEvent.click(screen.getByTestId("add-folders-clear"));
    await waitFor(() => expect(screen.getByTestId("add-folders-status-path")).toBeTruthy());
    expect(commit().textContent).toBe('Add "user"');
  });

  it("F26 — no basket, pills or row checkboxes render", async () => {
    renderDialog();
    await ready();
    fireEvent.click(row("/home/user/work"));
    expect(screen.queryByTestId("add-folders-basket")).toBeNull();
    expect(screen.queryByTestId("add-folders-pill-/home/user/work")).toBeNull();
    expect(screen.queryAllByRole("checkbox").filter((c) => c.closest("[role='listbox']"))).toHaveLength(0);
  });

  it("X3 — nothing to commit while the first browse is pending", async () => {
    mockBrowse.mockReturnValue(new Promise(() => { /* never resolves */ }));
    renderDialog();
    expect(commit().disabled).toBe(true);
    fireEvent.click(commit());
    expect(onPin).not.toHaveBeenCalled();
  });

  it("controls meet the target-size floor, use tokens, and the footer is sticky", async () => {
    renderDialog({ onCreateWorkspace: vi.fn() });
    await ready();
    fireEvent.click(row("/home/user/work"));
    expect(screen.getByTestId("add-folders-clear").className).toMatch(/min-h-6/);
    expect(dest().className).toMatch(/min-h-\[44px\]/);
    expect(commit().className).toMatch(/min-h-\[44px\]/);
    expect(commit().className).toMatch(/--accent-solid/);
    expect(commit().className).not.toMatch(/bg-blue-/);
    expect(commit().className).toMatch(/truncate/);
    for (const el of [screen.getByTestId("add-folders-clear"), dest(), commit()]) {
      expect(el.className).toMatch(/\bfocus-ring\b/);
    }
    expect(commit().closest(".sticky")).toBeTruthy();
    // Readable text: no --text-muted anywhere in the dialog body.
    expect(screen.getByTestId("add-folders-dialog").innerHTML).not.toMatch(/--text-muted/);
  });
});
