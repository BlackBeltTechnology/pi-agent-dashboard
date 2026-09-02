/**
 * Tests for AddFoldersDialog — the multi-select Add Folders flow.
 * Covers the selection basket (persists across navigation, pill removal,
 * empty-disables-commit, count-bearing action), the single-select workspace
 * destination + its empty state, the absence of any pin control (pinning is
 * implicit), pins-before-workspace-adds commit ordering, and session badges.
 * See change: redesign-folder-workspace-add-flow.
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

  const check = (path: string) => screen.getByTestId(`path-picker-check-${path}`);
  const commit = () => screen.getByTestId("add-folders-commit") as HTMLButtonElement;

  it("selections persist across navigation and the action reflects the count", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    fireEvent.click(check("/home/user/work"));
    expect(commit().textContent).toMatch(/1/);

    mockBrowse.mockResolvedValue(PROJECTS);
    fireEvent.click(screen.getByTestId("path-picker-open-/home/user/projects"));
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(check("/home/user/projects/alpha"));

    // Both survive the navigation.
    expect(screen.getByTestId("add-folders-pill-/home/user/work")).toBeTruthy();
    expect(screen.getByTestId("add-folders-pill-/home/user/projects/alpha")).toBeTruthy();
    expect(commit().textContent).toMatch(/2/);
  });

  it("pill removal deselects and unticks the row", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    fireEvent.click(check("/home/user/work"));
    expect(check("/home/user/work").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("add-folders-pill-remove-/home/user/work"));
    expect(screen.queryByTestId("add-folders-pill-/home/user/work")).toBeNull();
    expect(check("/home/user/work").getAttribute("aria-checked")).toBe("false");
  });

  it("an empty basket disables commit and shows the empty hint", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(commit().disabled).toBe(true);
    expect(screen.getByTestId("add-folders-basket-empty")).toBeTruthy();

    fireEvent.click(check("/home/user/work"));
    expect(commit().disabled).toBe(false);
    expect(screen.queryByTestId("add-folders-basket-empty")).toBeNull();
  });

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
    fireEvent.click(check("/home/user/work"));
    fireEvent.click(check("/home/user/scratch"));
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
    fireEvent.click(check("/home/user/work"));
    fireEvent.click(screen.getByTestId("add-folders-dest-fe"));
    fireEvent.click(commit());

    expect(order).toEqual(["pin:/home/user/work", "ws:fe:/home/user/work"]);
  });

  it("the destination is single-select and defaults to None", async () => {
    renderDialog();
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(screen.getByTestId("add-folders-dest-none").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("add-folders-dest-fe"));
    expect(screen.getByTestId("add-folders-dest-fe").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("add-folders-dest-none").getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByTestId("add-folders-dest-be"));
    expect(screen.getByTestId("add-folders-dest-be").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("add-folders-dest-fe").getAttribute("aria-checked")).toBe("false");
  });

  it("preselects the workspace it was opened from", async () => {
    renderDialog({ initialWorkspaceId: "be" });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(screen.getByTestId("add-folders-dest-be").getAttribute("aria-checked")).toBe("true");
  });

  it("with zero workspaces renders the empty statement, no radio options", async () => {
    renderDialog({ workspaces: [], onCreateWorkspace: vi.fn() });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(screen.getByTestId("add-folders-dest-empty").textContent).toMatch(/no workspaces yet/i);
    expect(screen.queryByTestId("add-folders-dest-fe")).toBeNull();
    expect(screen.getByTestId("add-folders-dest-new")).toBeTruthy();
  });

  it("badges a directory that is a live session cwd, and only that one", async () => {
    renderDialog({ sessionCwds: ["/home/user/work", "/home/user/work/"] });
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    // pathKey collapses the trailing-separator drift → one folder, 2 sessions.
    expect(screen.getByTestId("path-picker-sessions-/home/user/work").textContent).toMatch(/2/);
    expect(screen.queryByTestId("path-picker-sessions-/home/user/scratch")).toBeNull();
  });
});

// add-current-folder-to-add-flow — the current-directory self-row lets the user
// add the folder they have navigated INTO. These cover the dialog-level
// observables (basket label, pill label, commit → onPin); picker-level self-row
// mechanics live in PathPicker.test.tsx.
describe("AddFoldersDialog current-directory self-row", () => {
  const onPin = vi.fn();
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
        onCancel={onCancel}
        {...props}
      />,
    );
  }
  const commit = () => screen.getByTestId("add-folders-commit") as HTMLButtonElement;

  it("E1 — self-row activation adds the current directory to the basket", async () => {
    renderDialog();
    await screen.findByTestId("path-picker-self");
    const browseCalls = mockBrowse.mock.calls.length;
    // Click the self-row body — activation toggles (never browses).
    fireEvent.click(screen.getByTestId("path-picker-self"));
    expect(screen.getByTestId("add-folders-pill-/home/user")).toBeTruthy();
    expect(commit().textContent).toMatch(/1/);
    expect(mockBrowse.mock.calls.length).toBe(browseCalls); // no navigation
  });

  it("E4 — committing a sole self-row selection pins the current directory and closes", async () => {
    renderDialog();
    await screen.findByTestId("path-picker-self");
    fireEvent.click(screen.getByTestId("path-picker-check-/home/user"));
    fireEvent.click(commit());
    expect(onPin.mock.calls).toEqual([["/home/user"]]);
    expect(onCancel).toHaveBeenCalled();
  });

  it("E5 — self-row selection coexists with a child selection", async () => {
    renderDialog();
    await screen.findByTestId("path-picker-self");
    fireEvent.click(screen.getByTestId("path-picker-check-/home/user"));

    mockBrowse.mockResolvedValue(PROJECTS);
    fireEvent.click(screen.getByTestId("path-picker-open-/home/user/projects"));
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    fireEvent.click(screen.getByTestId("path-picker-check-/home/user/projects/alpha"));

    expect(screen.getByTestId("add-folders-pill-/home/user")).toBeTruthy();
    expect(screen.getByTestId("add-folders-pill-/home/user/projects/alpha")).toBeTruthy();
    expect(commit().textContent).toMatch(/2/);
  });

  it("E8 — filesystem-root self-row yields a non-empty pill label and remove aria-label", async () => {
    mockBrowse.mockResolvedValue({ current: "/", parent: null, entries: [{ name: "home", path: "/home" }] });
    renderDialog({ initialPath: "/" });
    await screen.findByTestId("path-picker-self");
    fireEvent.click(screen.getByTestId("path-picker-check-/"));
    const pill = screen.getByTestId("add-folders-pill-/");
    expect(pill.textContent?.trim()).not.toBe("");
    const remove = screen.getByTestId("add-folders-pill-remove-/");
    expect(remove.getAttribute("aria-label")?.trim()).toBeTruthy();
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
    fireEvent.click(screen.getByTestId("add-folders-dest-new"));
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
      expect(screen.getByTestId("add-folders-dest-infra").getAttribute("aria-checked")).toBe("true"),
    );
  });
});

// redesign-folder-workspace-add-flow — WCAG 2.5.8 (Target Size Minimum, 24×24).
// Caught by the live harness a11y pass: the compact glyphs rendered 14–16px hit
// boxes. jsdom has no layout, so assert the padding contract that produces ≥24px.
describe("AddFoldersDialog target sizes (WCAG 2.5.8)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(HOME);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  it("row checkbox, row chevron, pill remove, destination and new-workspace controls carry a ≥24px hit box", async () => {
    render(
      <AddFoldersDialog
        workspaces={WORKSPACES}
        initialPath="/home/user/"
        onPin={vi.fn()}
        onCreateWorkspace={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());

    // Picker row controls.
    for (const el of [
      screen.getByTestId("path-picker-check-/home/user/work"),
      screen.getByTestId("path-picker-open-/home/user/work"),
    ]) {
      expect(el.className).toMatch(/min-w-6/);
      expect(el.className).toMatch(/min-h-6/);
    }

    // Destination radio + create affordance.
    expect(screen.getByTestId("add-folders-dest-none").className).toMatch(/min-h-6/);
    expect(screen.getByTestId("add-folders-dest-new").className).toMatch(/min-h-6/);

    // Basket pill remove control (needs a selection first).
    fireEvent.click(screen.getByTestId("path-picker-check-/home/user/work"));
    const remove = screen.getByTestId("add-folders-pill-remove-/home/user/work");
    expect(remove.className).toMatch(/min-w-6/);
    expect(remove.className).toMatch(/min-h-6/);

    // Theme-aware focus ring (project `.focus-ring` utility → 2px var(--focus-ring)),
    // not the 1px UA default that is near-invisible on dark themes.
    for (const el of [
      screen.getByTestId("path-picker-check-/home/user/work"),
      screen.getByTestId("path-picker-open-/home/user/work"),
      screen.getByTestId("add-folders-dest-none"),
      screen.getByTestId("add-folders-dest-new"),
      screen.getByTestId("add-folders-commit"),
      remove,
    ]) {
      expect(el.className).toMatch(/\bfocus-ring\b/);
    }
  });
});

// redesign-folder-workspace-add-flow — keyboard contract inside the dialog.
// Space toggles the highlighted row's selection; Enter DESCENDS into it and must
// never commit/close the dialog (the basket is the answer, not the input).
describe("AddFoldersDialog keyboard: Space selects, Enter descends (never commits)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(HOME);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  it("Space selects the highlighted row without navigating", async () => {
    const onPin = vi.fn();
    render(
      <AddFoldersDialog workspaces={WORKSPACES} initialPath="/home/user/" onPin={onPin} onCancel={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // skip the current-dir self-row
    fireEvent.keyDown(input, { key: "ArrowDown" }); // skip the `..` parent row
    fireEvent.keyDown(input, { key: "ArrowDown" }); // land on the `work` child row
    fireEvent.keyDown(input, { key: " " });

    expect(screen.getByTestId("add-folders-pill-/home/user/work")).toBeTruthy();
    expect(commitBtn().textContent).toMatch(/1/);
    expect(onPin).not.toHaveBeenCalled(); // selecting is not committing
  });

  it("Enter descends into the highlighted row and does NOT commit or close", async () => {
    const onPin = vi.fn();
    const onCancel = vi.fn();
    render(
      <AddFoldersDialog workspaces={WORKSPACES} initialPath="/home/user/" onPin={onPin} onCancel={onCancel} />,
    );
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // skip the current-dir self-row
    fireEvent.keyDown(input, { key: "ArrowDown" }); // skip the `..` parent row
    fireEvent.keyDown(input, { key: "ArrowDown" }); // land on the `work` child row

    mockBrowse.mockResolvedValue(PROJECTS);
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/work")).toBe(true);
    });
    // Enter is navigation only: nothing pinned, dialog still open.
    expect(onPin).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByTestId("add-folders-dialog")).toBeTruthy();
  });
});

function commitBtn(): HTMLButtonElement {
  return screen.getByTestId("add-folders-commit") as HTMLButtonElement;
}
