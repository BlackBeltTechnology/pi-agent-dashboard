import { normalizePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { mdiChevronRight, mdiFolderOpen } from "@mdi/js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inferPlatform, pathKey } from "../../lib/session/session-grouping.js";
import { PathPicker } from "../primitives/PathPicker.js";

// Mock browse-api
const mockBrowse = vi.fn();
const mockMkdir = vi.fn();
const mockClassify = vi.fn();
vi.mock("../../lib/api/browse-api.js", () => ({
  browseDirectory: (...args: unknown[]) => mockBrowse(...args),
  classifyPaths: (...args: unknown[]) => mockClassify(...args),
  createDirectory: (...args: unknown[]) => mockMkdir(...args),
}));

/**
 * Build a `BrowseResult` mock. Per change `split-browse-flags`, the
 * server omits `isGit`/`isPi` from the initial response; the picker
 * fills them in via the lazy `classifyPaths` phase. Tests that want
 * the legacy eager-flags shape can pass `eagerFlags: true`.
 */
function makeBrowseResult(
  current: string,
  entries: Array<{ name: string; isGit?: boolean; isPi?: boolean }>,
  parent: string | null = "/parent",
  opts: { eagerFlags?: boolean } = {},
) {
  return {
    current,
    parent,
    entries: entries.map((e) => ({
      name: e.name,
      path: `${current}/${e.name}`,
      ...(opts.eagerFlags
        ? { isGit: e.isGit ?? false, isPi: e.isPi ?? false }
        : {}),
    })),
  };
}

/** Build a `classifyPaths` response for the given entries (keyed by full path). */
function makeFlagMap(
  current: string,
  entries: Array<{ name: string; isGit?: boolean; isPi?: boolean }>,
): Record<string, { isGit: boolean; isPi: boolean }> {
  const map: Record<string, { isGit: boolean; isPi: boolean }> = {};
  for (const e of entries) {
    map[`${current}/${e.name}`] = { isGit: e.isGit ?? false, isPi: e.isPi ?? false };
  }
  return map;
}

const homeEntries = makeBrowseResult("/Users/robson", [
  { name: "Desktop" },
  { name: "Documents" },
  { name: "Downloads" },
  { name: "Project", isGit: false, isPi: false },
]);

const projectEntries = makeBrowseResult(
  "/Users/robson/Project",
  [
    { name: "pi-agent-dashboard", isGit: true, isPi: true },
    { name: "pi-coding-agent", isGit: true, isPi: true },
    { name: "pi-tools", isGit: true },
  ],
  "/Users/robson",
);

afterEach(() => cleanup());

describe("PathPicker", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(homeEntries);
    // Default: classify resolves to an empty map (no badges). Individual tests
    // override with a populated map when they care about the lazy fill-in.
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/Users/robson/new-thing" });
  });

  function renderPicker(props: Partial<React.ComponentProps<typeof PathPicker>> = {}) {
    return render(
      <PathPicker
        initialPath="/Users/robson/"
        onSelect={onSelect}
        onCancel={onCancel}
        {...props}
      />,
    );
  }

  function getInput(): HTMLInputElement {
    return screen.getByRole("textbox") as HTMLInputElement;
  }

  // Helper: wait for browseDirectory to have been called with expected path
  async function waitBrowsed(path: string | undefined) {
    await waitFor(() => {
      const lastCall = mockBrowse.mock.calls.find((c) => c[0] === path);
      expect(lastCall).toBeDefined();
    });
  }

  it("should render input with initial path and fetch entries", async () => {
    renderPicker();
    await waitBrowsed("/Users/robson");
    expect(getInput().value).toBe("/Users/robson/");

    await waitFor(() => {
      expect(screen.getByText("Desktop")).toBeTruthy();
      expect(screen.getByText("Documents")).toBeTruthy();
    });
  });

  it("should show loading state while fetching", async () => {
    let resolve!: (v: unknown) => void;
    mockBrowse.mockReturnValue(new Promise((r) => (resolve = r)));
    renderPicker();
    expect(screen.getByText(/loading/i)).toBeTruthy();
    resolve(homeEntries);
    await waitFor(() => {
      expect(screen.queryByText(/loading/i)).toBeNull();
    });
  });

  it("should show .. entry for non-root directories", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    const options = screen.getAllByRole("option");
    const parentOption = options.find((o) => o.textContent?.includes(".."));
    expect(parentOption).toBeTruthy();
  });

  it("should send typed partial as q query via debounced fetch", async () => {
    vi.useFakeTimers();
    try {
      renderPicker();
      // initial fetch (kicked off in useEffect)
      await vi.runOnlyPendingTimersAsync();
      await vi.waitFor(() => expect(mockBrowse).toHaveBeenCalled());
      mockBrowse.mockClear();

      // Set up mock to return filtered result when q=Do
      mockBrowse.mockResolvedValue(
        makeBrowseResult("/Users/robson", [{ name: "Documents" }, { name: "Downloads" }]),
      );

      act(() => {
        fireEvent.change(getInput(), { target: { value: "/Users/robson/Do" } });
      });

      // Before debounce fires — no new call yet
      expect(mockBrowse).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(160);
      });

      const call = mockBrowse.mock.calls[0];
      expect(call[0]).toBe("/Users/robson");
      expect(call[1]?.q).toBe("Do");
    } finally {
      vi.useRealTimers();
    }
  });

  it("should abort in-flight request when partial changes", async () => {
    vi.useFakeTimers();
    try {
      renderPicker();
      await vi.runOnlyPendingTimersAsync();
      await vi.waitFor(() => expect(mockBrowse).toHaveBeenCalled());
      mockBrowse.mockClear();

      // capture signals
      const signals: Array<AbortSignal | undefined> = [];
      mockBrowse.mockImplementation(
        (_p: unknown, opts: { signal?: AbortSignal } | undefined) => {
          signals.push(opts?.signal);
          return new Promise(() => {
            /* never resolves */
          });
        },
      );

      act(() => {
        fireEvent.change(getInput(), { target: { value: "/Users/robson/D" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(160);
      });

      act(() => {
        fireEvent.change(getInput(), { target: { value: "/Users/robson/Do" } });
      });
      await act(async () => {
        vi.advanceTimersByTime(160);
      });

      expect(signals[0]?.aborted).toBe(true);
      expect(signals[1]?.aborted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should descend into directory on click", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());

    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.click(screen.getByText("Project"));

    await waitBrowsed("/Users/robson/Project");
    expect(getInput().value).toBe("/Users/robson/Project/");

    await waitFor(() => {
      expect(screen.getByText("pi-agent-dashboard")).toBeTruthy();
    });
  });

  it("should navigate to parent on .. click", async () => {
    mockBrowse.mockResolvedValue(projectEntries);
    renderPicker({ initialPath: "/Users/robson/Project/" });
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options.find((o) => o.textContent?.includes(".."))).toBeTruthy();
    });

    mockBrowse.mockResolvedValue(homeEntries);
    const parentOption = screen.getAllByRole("option").find((o) => o.textContent?.includes(".."))!;
    fireEvent.click(parentOption);

    await waitBrowsed("/Users/robson");
  });

  it("should move highlight with arrow keys", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    const input = getInput();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
  });

  it("should descend on Tab with highlighted entry", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());

    const input = getInput();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: "ArrowDown" });

    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.keyDown(input, { key: "Tab" });

    await waitFor(() => {
      expect(getInput().value).toBe("/Users/robson/Project/");
    });
  });

  it("should auto-complete single match on Tab (after server filter returns 1)", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    // Simulate server returning exactly one match for partial "Pr"
    mockBrowse.mockResolvedValue(
      makeBrowseResult("/Users/robson", [{ name: "Project" }]),
    );

    fireEvent.change(getInput(), { target: { value: "/Users/robson/Pr" } });

    // Wait for debounced filter to take effect: Desktop should disappear
    await waitFor(() => expect(screen.queryByText("Desktop")).toBeNull(), {
      timeout: 1000,
    });

    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.keyDown(getInput(), { key: "Tab" });

    await waitFor(() => {
      expect(getInput().value).toBe("/Users/robson/Project/");
    });
  });

  it("Enter on trailing-slash current directory calls onSelect and closes", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    fireEvent.keyDown(getInput(), { key: "Enter" });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/Users/robson/"));
  });

  it("Enter on exact-match partial selects that entry's full path", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    fireEvent.change(getInput(), { target: { value: "/Users/robson/Desktop" } });
    // The debounced refetch must land before Enter — poll on the fetch, then
    // flush its RESOLVED result into component state (a resolved mock alone
    // does not prove the entries re-rendered).
    const callsBeforeEnter = mockBrowse.mock.calls.length;
    await waitFor(() => expect(mockBrowse.mock.calls.length).toBeGreaterThan(callsBeforeEnter));
    await act(async () => {});
    fireEvent.keyDown(getInput(), { key: "Enter" });
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith("/Users/robson/Desktop"),
    );
  });

  it("Enter on single candidate (no exact match) completes without closing", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    // server returns only Project for 'Pr'
    mockBrowse.mockResolvedValue(
      makeBrowseResult("/Users/robson", [{ name: "Project" }]),
    );
    fireEvent.change(getInput(), { target: { value: "/Users/robson/Pr" } });
    await waitFor(() => expect(screen.queryByText("Desktop")).toBeNull(), {
      timeout: 1000,
    });

    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.keyDown(getInput(), { key: "Enter" });

    await waitFor(() => {
      expect(getInput().value).toBe("/Users/robson/Project/");
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Enter on non-existent typo path is a no-op (not onSelect)", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    // server returns zero matches for 'zzzzz'
    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson", []));
    fireEvent.change(getInput(), { target: { value: "/Users/robson/zzzzz" } });
    await waitFor(() => expect(screen.queryByText("Desktop")).toBeNull(), {
      timeout: 1000,
    });

    fireEvent.keyDown(getInput(), { key: "Enter" });
    // Flush microtasks; the no-op decision is synchronous after the settle.
    await act(async () => {});
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Select button click follows Enter rules (no onSelect on typo)", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson", []));
    fireEvent.change(getInput(), { target: { value: "/Users/robson/zzzzz" } });
    await waitFor(() => expect(screen.queryByText("Desktop")).toBeNull(), {
      timeout: 1000,
    });

    fireEvent.click(screen.getByText("Select"));
    await act(async () => {});
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Select button click on trailing-slash path calls onSelect", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    fireEvent.click(screen.getByText("Select"));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/Users/robson/"));
  });

  it("should disable Select button when input is empty", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    fireEvent.change(getInput(), { target: { value: "" } });
    const selectBtn = screen.getByText("Select");
    expect(selectBtn.hasAttribute("disabled")).toBe(true);
  });

  it("should call onCancel when Cancel button clicked", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("should call onCancel on Escape", async () => {
    renderPicker();
    fireEvent.keyDown(getInput(), { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("should show git and pi indicators after lazy classify resolves", async () => {
    mockBrowse.mockResolvedValue(projectEntries);
    // change: split-browse-flags — badges arrive via the lazy second phase.
    mockClassify.mockResolvedValue(
      makeFlagMap("/Users/robson/Project", [
        { name: "pi-agent-dashboard", isGit: true, isPi: true },
        { name: "pi-coding-agent", isGit: true, isPi: true },
        { name: "pi-tools", isGit: true, isPi: false },
      ]),
    );
    renderPicker({ initialPath: "/Users/robson/Project/" });

    await waitFor(() => {
      expect(screen.getByText("pi-agent-dashboard")).toBeTruthy();
    });

    await waitFor(() => {
      const dashboardRow = screen.getByText("pi-agent-dashboard").closest("[role='option']");
      expect(dashboardRow?.textContent).toMatch(/git/i);
      expect(dashboardRow?.textContent).toMatch(/pi/i);
    });
  });

  it("should show 'No subdirectories' for empty directory", async () => {
    mockBrowse.mockResolvedValue(makeBrowseResult("/empty", [], "/"));
    renderPicker({ initialPath: "/empty/" });

    await waitFor(() => {
      expect(screen.getByText(/no subdirectories/i)).toBeTruthy();
    });
  });

  it("should default to home directory when no initialPath", async () => {
    const homeResult = {
      current: "/Users/robson",
      parent: "/Users",
      entries: [{ name: "Desktop", path: "/Users/robson/Desktop", isGit: false, isPi: false }],
    };
    mockBrowse.mockResolvedValue(homeResult);
    render(<PathPicker onSelect={onSelect} onCancel={onCancel} />);

    // Wait for Desktop to render — proves the fetch ran and resolved
    await waitFor(() => {
      expect(screen.getByText("Desktop")).toBeTruthy();
    });
    expect(mockBrowse.mock.calls[0][0]).toBeUndefined();
    expect(getInput().value).toBe("/Users/robson/");
  });

  it("does not clobber a path typed while the default-directory fetch is in flight", async () => {
    // Regression: the mount-time `fetchDir(undefined, "")` used to
    // `setInputValue(result.current)` unconditionally when it resolved, wiping
    // anything typed meanwhile — the user silently ended up browsing HOME.
    let resolveHome!: (v: unknown) => void;
    mockBrowse.mockImplementationOnce(
      () => new Promise((res) => { resolveHome = res; }),
    );
    render(<PathPicker onSelect={onSelect} onCancel={onCancel} />);

    // User types a full path BEFORE the default-dir listing comes back.
    mockBrowse.mockResolvedValue({
      current: "/fixtures",
      parent: "/",
      entries: [{ name: "sample-git", path: "/fixtures/sample-git", isGit: true, isPi: true }],
    });
    fireEvent.change(getInput(), { target: { value: "/fixtures/sample-git" } });

    // …then the stale default-directory fetch resolves. This lands INSIDE the
    // debounce window, so `abortRef` still points at the mount controller and
    // the stale-response guard does NOT suppress it — only `userEditedRef` does.
    await act(async () => {
      resolveHome({
        current: "/Users/robson",
        parent: "/Users",
        entries: [{ name: "Desktop", path: "/Users/robson/Desktop", isGit: false, isPi: false }],
      });
      // Flush the promise chain so any clobbering setInputValue has committed
      // before we assert (asserting earlier would pass even without the fix).
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getInput().value).toBe("/fixtures/sample-git");
  });

  it("should reset highlight when typing", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    const input = getInput();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    fireEvent.change(input, { target: { value: "/Users/robson/D" } });

    const options = screen.getAllByRole("option");
    const selected = options.filter((r) => r.getAttribute("aria-selected") === "true");
    expect(selected.length).toBe(0);
  });

  // ── New folder creation ──────────────────────────────────────

  it("arrow-down navigates into the create-here row", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson", []));
    fireEvent.change(getInput(), { target: { value: "/Users/robson/new-thing" } });
    // Wait for server-filtered (empty) result to land: Desktop disappears.
    await waitFor(() => expect(screen.queryByText("Desktop")).toBeNull(), {
      timeout: 1000,
    });
    expect(screen.getByText(/Create "new-thing" here/)).toBeTruthy();

    const input = getInput();
    // displayItems: [..], [create-here] — arrow down twice lands on create-here
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    const options = screen.getAllByRole("option");
    const createRow = options.find((o) => o.textContent?.includes('Create "new-thing" here'));
    expect(createRow).toBeTruthy();
    expect(createRow!.getAttribute("aria-selected")).toBe("true");

    // Enter on highlighted create-here triggers mkdir
    mockMkdir.mockResolvedValue({ path: "/Users/robson/new-thing" });
    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson/new-thing", []));
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(mockMkdir).toHaveBeenCalledWith("/Users/robson", "new-thing"),
    );
  });

  it("shows inline 'Create \"<name>\" here' row when partial has no exact match", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson", []));
    fireEvent.change(getInput(), { target: { value: "/Users/robson/new-thing" } });

    await waitFor(
      () => expect(screen.getByText(/Create "new-thing" here/)).toBeTruthy(),
      { timeout: 1000 },
    );
  });

  it("hides 'Create here' row when partial exactly matches an entry", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    // homeEntries still mocked; partial 'Desktop' matches exactly → no Create row
    fireEvent.change(getInput(), { target: { value: "/Users/robson/Desktop" } });
    // The debounced refetch must land and its result must be rendered before
    // asserting the row state (flush the resolved mock into state).
    const callsBeforeRow = mockBrowse.mock.calls.length;
    await waitFor(() => expect(mockBrowse.mock.calls.length).toBeGreaterThan(callsBeforeRow));
    await act(async () => {});

    expect(screen.queryByText(/Create ".*" here/)).toBeNull();
  });

  it("clicking 'Create here' calls mkdir and descends into new path", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson", []));
    fireEvent.change(getInput(), { target: { value: "/Users/robson/new-thing" } });
    await waitFor(
      () => expect(screen.getByText(/Create "new-thing" here/)).toBeTruthy(),
      { timeout: 1000 },
    );

    mockMkdir.mockResolvedValue({ path: "/Users/robson/new-thing" });
    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson/new-thing", []));

    fireEvent.click(screen.getByText(/Create "new-thing" here/));

    await waitFor(() =>
      expect(mockMkdir).toHaveBeenCalledWith("/Users/robson", "new-thing"),
    );
    await waitFor(() => {
      expect(getInput().value).toBe("/Users/robson/new-thing/");
    });
  });

  it("footer ＋ New folder button opens name entry; Enter creates and descends", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    fireEvent.click(screen.getByText(/New folder/));

    const nameInput = screen.getByLabelText("New folder name") as HTMLInputElement;
    expect(nameInput).toBeTruthy();

    fireEvent.change(nameInput, { target: { value: "experiments" } });

    mockMkdir.mockResolvedValue({ path: "/Users/robson/experiments" });
    mockBrowse.mockResolvedValue(makeBrowseResult("/Users/robson/experiments", []));

    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() =>
      expect(mockMkdir).toHaveBeenCalledWith("/Users/robson", "experiments"),
    );
    await waitFor(() => {
      expect(getInput().value).toBe("/Users/robson/experiments/");
    });
  });

  it("Escape in footer name entry closes without creating", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    fireEvent.click(screen.getByText(/New folder/));
    const nameInput = screen.getByLabelText("New folder name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "abc" } });
    fireEvent.keyDown(nameInput, { key: "Escape" });

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New folder name")).toBeNull();
  });

  it("surfaces server error and does not descend on mkdir failure", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());

    fireEvent.click(screen.getByText(/New folder/));
    const nameInput = screen.getByLabelText("New folder name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "existing" } });

    mockMkdir.mockRejectedValue(new Error("already exists"));
    fireEvent.keyDown(nameInput, { key: "Enter" });

    await waitFor(() => expect(screen.getByText(/already exists/)).toBeTruthy());
    expect(getInput().value).toBe("/Users/robson/");
  });

  // ── change: distinguish-offline-from-network-denied ──────────────────────

  it("renders the remedy hint (not a bare error) on a 403 network_not_allowed browse denial", async () => {
    const denial = Object.assign(new Error("network_not_allowed"), {
      code: "network_not_allowed",
      hint: "Add this network to trustedNetworks (Settings → Servers) or sign in.",
    });
    mockBrowse.mockRejectedValue(denial);

    renderPicker();

    await waitFor(() => {
      expect(screen.getByText(/Network not allowed/i)).toBeTruthy();
      expect(screen.getByText(/trustedNetworks/i)).toBeTruthy();
    });
  });

  it("offers a Settings → Servers affordance on a network_not_allowed denial", async () => {
    const onOpenServers = vi.fn();
    const denial = Object.assign(new Error("network_not_allowed"), {
      code: "network_not_allowed",
      hint: "remedy text",
    });
    mockBrowse.mockRejectedValue(denial);

    renderPicker({ onOpenServers });

    const btn = await screen.findByRole("button", { name: /servers/i });
    fireEvent.click(btn);
    expect(onOpenServers).toHaveBeenCalledTimes(1);
  });

  it("renders existing error copy for a non-denial browse failure", async () => {
    mockBrowse.mockRejectedValue(new Error("ENOENT: no such directory"));

    renderPicker();

    await waitFor(() => expect(screen.getByText(/no such directory/i)).toBeTruthy());
    expect(screen.queryByText(/Network not allowed/i)).toBeNull();
  });

  // ── change: split-browse-flags ──────────────────────────────────────────

  it("renders git/pi badges after the lazy classifyPaths phase resolves", async () => {
    const projectFlagless = makeBrowseResult(
      "/Users/robson/Project",
      [
        { name: "pi-agent-dashboard" },
        { name: "pi-coding-agent" },
        { name: "plain-dir" },
      ],
      "/Users/robson",
    );
    mockBrowse.mockResolvedValue(projectFlagless);
    mockClassify.mockResolvedValue(
      makeFlagMap("/Users/robson/Project", [
        { name: "pi-agent-dashboard", isGit: true, isPi: true },
        { name: "pi-coding-agent", isGit: true, isPi: false },
        { name: "plain-dir", isGit: false, isPi: false },
      ]),
    );

    renderPicker({ initialPath: "/Users/robson/Project/" });

    // Phase 1: rows render without badges.
    await waitFor(() => expect(screen.getByText("pi-agent-dashboard")).toBeTruthy());

    // Phase 2: classifyPaths was called with all rendered paths.
    await waitFor(() => {
      expect(mockClassify).toHaveBeenCalled();
      const [paths] = mockClassify.mock.calls[mockClassify.mock.calls.length - 1];
      expect(paths).toEqual([
        "/Users/robson/Project/pi-agent-dashboard",
        "/Users/robson/Project/pi-coding-agent",
        "/Users/robson/Project/plain-dir",
      ]);
    });

    // Phase 2 fill-in: badges appear for entries with truthy flags.
    await waitFor(() => {
      const gitBadges = screen.getAllByTitle("git repo");
      const piBadges = screen.getAllByTitle("pi project");
      expect(gitBadges.length).toBe(2);
      expect(piBadges.length).toBe(1);
    });
  });

  it("swallows classifyPaths failures silently (no error surfaced, no badges)", async () => {
    const projectFlagless = makeBrowseResult(
      "/Users/robson/Project",
      [{ name: "pi-agent-dashboard" }],
      "/Users/robson",
    );
    mockBrowse.mockResolvedValue(projectFlagless);
    mockClassify.mockRejectedValue(new Error("boom"));

    renderPicker({ initialPath: "/Users/robson/Project/" });

    await waitFor(() => expect(screen.getByText("pi-agent-dashboard")).toBeTruthy());
    await waitFor(() => expect(mockClassify).toHaveBeenCalled());
    // No error rendered, no badges rendered — picker is still usable.
    expect(screen.queryByText(/boom/)).toBeNull();
    expect(screen.queryAllByTitle("git repo").length).toBe(0);
    expect(screen.queryAllByTitle("pi project").length).toBe(0);
  });

  it("aborts phase-2 classifyPaths when fetchDir is re-invoked", async () => {
    const result = makeBrowseResult(
      "/Users/robson/Project",
      [{ name: "first-row" }],
      "/Users/robson",
    );
    mockBrowse.mockResolvedValue(result);

    let firstSignal: AbortSignal | undefined;
    let firstResolved = false;
    // Hold the first classifyPaths call open so the second invocation arrives
    // before it resolves — lets us observe abort.
    mockClassify.mockImplementationOnce((_paths: string[], opts?: { signal?: AbortSignal }) => {
      firstSignal = opts?.signal;
      return new Promise((resolve) => {
        opts?.signal?.addEventListener("abort", () => {
          firstResolved = true;
          resolve({});
        });
      });
    });
    mockClassify.mockResolvedValueOnce({});

    renderPicker({ initialPath: "/Users/robson/Project/" });
    await waitFor(() => expect(mockClassify).toHaveBeenCalledTimes(1));

    // Re-invoke fetchDir: typing a query change forces a fresh fetch and
    // the prior AbortController is canceled.
    fireEvent.change(getInput(), { target: { value: "/Users/robson/Project/f" } });
    await waitFor(() => expect(firstSignal?.aborted).toBe(true));
    expect(firstResolved).toBe(true);
  });

  describe("Windows trailing-backslash confirmation", () => {
    // Build a Windows-shaped BrowseResult (entries joined with `\`, not `/`).
    function makeWinBrowseResult(
      current: string,
      entries: Array<{ name: string }>,
      parent: string | null,
    ) {
      return {
        current,
        parent,
        entries: entries.map((e) => ({
          name: e.name,
          path: `${current}\\${e.name}`,
        })),
      };
    }

    it("Enter on C:\\Users\\me\\ calls onSelect with the input value and closes", async () => {
      const winResult = makeWinBrowseResult(
        "C:\\Users\\me",
        [{ name: "Documents" }, { name: "Downloads" }],
        "C:\\Users",
      );
      mockBrowse.mockResolvedValue(winResult);

      render(
        <PathPicker
          initialPath={"C:\\Users\\me\\"}
          onSelect={onSelect}
          onCancel={onCancel}
        />,
      );

      await waitFor(() => expect(screen.getByText("Documents")).toBeTruthy());
      // Sanity: the picker preserved the Windows shape verbatim.
      expect(getInput().value).toBe("C:\\Users\\me\\");

      fireEvent.keyDown(getInput(), { key: "Enter" });
      await waitFor(() =>
        expect(onSelect).toHaveBeenCalledWith("C:\\Users\\me\\"),
      );
    });

    it("Select button on C:\\Users\\me\\ calls onSelect", async () => {
      const winResult = makeWinBrowseResult(
        "C:\\Users\\me",
        [{ name: "Documents" }],
        "C:\\Users",
      );
      mockBrowse.mockResolvedValue(winResult);

      render(
        <PathPicker
          initialPath={"C:\\Users\\me\\"}
          onSelect={onSelect}
          onCancel={onCancel}
        />,
      );
      await waitFor(() => expect(screen.getByText("Documents")).toBeTruthy());

      fireEvent.click(screen.getByText("Select"));
      await waitFor(() =>
        expect(onSelect).toHaveBeenCalledWith("C:\\Users\\me\\"),
      );
    });

    it("Enter on UNC \\\\server\\share\\ calls onSelect", async () => {
      // UNC root carries a trailing `\` after `normalizePath` (the picker's
      // parent comparison runs against the normalized form), so align the
      // mock's `current` with that shape — `\\server\share\`, not
      // `\\server\share`. Otherwise `fetchedDirRef.current === p` is false
      // and Rule 2 silently skips.
      const uncResult = {
        current: "\\\\server\\share\\",
        parent: null,
        entries: [{ name: "public", path: "\\\\server\\share\\public" }],
      };
      mockBrowse.mockResolvedValue(uncResult);

      render(
        <PathPicker
          initialPath={"\\\\server\\share\\"}
          onSelect={onSelect}
          onCancel={onCancel}
        />,
      );
      await waitFor(() => expect(screen.getByText("public")).toBeTruthy());

      fireEvent.keyDown(getInput(), { key: "Enter" });
      await waitFor(() =>
        expect(onSelect).toHaveBeenCalledWith("\\\\server\\share\\"),
      );
    });
  });
});

// redesign-folder-workspace-add-flow — the picker gains an opt-in multi-select
// mode with explorer semantics (row body = navigate, checkbox = select) and
// swaps every emoji glyph for an @mdi/js path.
// Reference: openspec/changes/redesign-folder-workspace-add-flow/mockups/add-flow.html
describe("PathPicker multi-select mode", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const onToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(homeEntries);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/Users/robson/new-thing" });
  });

  function renderMulti(selected: string[] = [], props: Record<string, unknown> = {}) {
    return render(
      <PathPicker
        initialPath="/Users/robson/"
        onSelect={onSelect}
        onCancel={onCancel}
        selection={{ selected: new Set(selected), onToggle }}
        {...props}
      />,
    );
  }

  it("row activation browses into the directory and never calls onSelect", async () => {
    renderMulti();
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.click(screen.getByText("Project"));
    await waitFor(() => {
      const call = mockBrowse.mock.calls.find((c) => c[0] === "/Users/robson/Project");
      expect(call).toBeDefined();
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("the checkbox selects without navigating", async () => {
    renderMulti();
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    const browseCallsBefore = mockBrowse.mock.calls.length;
    fireEvent.click(screen.getByTestId("path-picker-check-/Users/robson/Project"));
    expect(onToggle).toHaveBeenCalledWith("/Users/robson/Project");
    // stopPropagation kept the row's descend handler from firing.
    expect(mockBrowse.mock.calls.length).toBe(browseCallsBefore);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("the checkbox carries its own accessible name and checked state", async () => {
    renderMulti(["/Users/robson/Project"]);
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    const cb = screen.getByTestId("path-picker-check-/Users/robson/Project");
    expect(cb.getAttribute("aria-label")).toMatch(/project/i);
    expect(cb.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByTestId("path-picker-check-/Users/robson/Desktop").getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("the trailing chevron descends", async () => {
    renderMulti();
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.click(screen.getByTestId("path-picker-open-/Users/robson/Project"));
    await waitFor(() => {
      const call = mockBrowse.mock.calls.find((c) => c[0] === "/Users/robson/Project");
      expect(call).toBeDefined();
    });
  });

  it("Space toggles selection on the highlighted row; Enter activates it", async () => {
    renderMulti();
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    const input = screen.getByRole("textbox");
    // Highlight the first child entry row (index 2 — index 0 is the current-dir
    // self-row, index 1 is the `..` parent row).
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: " " });
    expect(onToggle).toHaveBeenCalledWith("/Users/robson/Desktop");

    mockBrowse.mockResolvedValue(projectEntries);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      const call = mockBrowse.mock.calls.find((c) => c[0] === "/Users/robson/Desktop");
      expect(call).toBeDefined();
    });
  });

  it("single-select mode renders no checkboxes", async () => {
    render(<PathPicker initialPath="/Users/robson/" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("Project")).toBeTruthy());
    expect(screen.queryByTestId("path-picker-check-/Users/robson/Project")).toBeNull();
  });
});

// add-current-folder-to-add-flow — the multi-select picker gains a current-dir
// self-row (open-folder glyph, no chevron, same checkbox/basket grammar) above
// a presentational CONTENTS eyebrow. These cover the picker-level observables;
// basket-label / pill / commit-pin observables live in AddFoldersDialog.test.tsx.
// Reference: openspec/changes/add-current-folder-to-add-flow/mockups/self-row.html
describe("PathPicker self-row (add current folder)", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();

  const userHome = makeBrowseResult("/home/user", [{ name: "work" }, { name: "projects" }], "/home");

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(userHome);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });

  /** Stateful host mirroring AddFoldersDialog's basket contract (normalizePath
   * on toggle) so picker-level selection is observable. */
  function SelfHarness(props: {
    initialPath?: string;
    initialSelected?: string[];
    sessionCounts?: Map<string, number>;
  }) {
    const [selected, setSelected] = React.useState<string[]>(props.initialSelected ?? []);
    const toggle = (raw: string) => {
      const path = normalizePath(raw.trim(), inferPlatform([raw]));
      if (!path) return;
      setSelected((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
    };
    return (
      <>
        <PathPicker
          initialPath={props.initialPath ?? "/home/user/"}
          onSelect={onSelect}
          onCancel={onCancel}
          selection={{ selected: new Set(selected), onToggle: toggle }}
          sessionCounts={props.sessionCounts}
        />
        <div data-testid="harness-basket">{selected.join("|")}</div>
      </>
    );
  }
  const basket = () => screen.getByTestId("harness-basket").textContent ?? "";

  it("E2 — activation toggles the self-row OFF", async () => {
    render(<SelfHarness initialSelected={["/home/user"]} />);
    await waitFor(() => expect(screen.getByTestId("path-picker-self")).toBeTruthy());
    expect(basket()).toBe("/home/user");
    // Enter while the self-row is highlighted (index 0) toggles it off.
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(basket()).toBe("");
  });

  it("E3 — self-row uses the open-folder glyph and renders no chevron", async () => {
    render(<SelfHarness />);
    const selfRow = await screen.findByTestId("path-picker-self");
    const paths = Array.from(selfRow.querySelectorAll("svg path")).map((p) => p.getAttribute("d"));
    expect(paths).toContain(mdiFolderOpen);
    expect(paths).not.toContain(mdiChevronRight);
  });

  it("E6 — self-row + equivalent child do not double-count", async () => {
    // Browse a trailing-separator path, tick the self-row, navigate up: the
    // equivalent child renders checked and the basket holds it exactly once.
    mockBrowse.mockResolvedValue(makeBrowseResult("/home/user/work/", [], "/home/user"));
    render(<SelfHarness initialPath="/home/user/work/" />);
    await screen.findByTestId("path-picker-self");
    fireEvent.click(screen.getByTestId("path-picker-check-/home/user/work/"));
    expect(basket()).toBe("/home/user/work");

    mockBrowse.mockResolvedValue(userHome);
    const dotdot = screen.getAllByRole("option").find((o) => o.textContent?.includes(".."))!;
    fireEvent.click(dotdot);
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());

    expect(screen.getByTestId("path-picker-check-/home/user/work").getAttribute("aria-checked")).toBe("true");
    expect(basket()).toBe("/home/user/work");
  });

  it("E7 — current dir with live sessions is badged on the self-row", async () => {
    const counts = new Map([[pathKey("/home/user", inferPlatform(["/home/user"])), 2]]);
    render(<SelfHarness sessionCounts={counts} />);
    await screen.findByTestId("path-picker-self");
    expect(screen.getByTestId("path-picker-sessions-/home/user").textContent).toMatch(/2/);
  });

  it("E9 — self-row is absent while no current directory is resolved", async () => {
    mockBrowse.mockReturnValue(new Promise(() => { /* never resolves */ }));
    render(<SelfHarness />);
    expect(screen.getByText(/loading/i)).toBeTruthy();
    expect(screen.queryByTestId("path-picker-self")).toBeNull();
  });

  it("E9b — self-row absent when a resolved current path is empty or relative", async () => {
    // The render-gate requires an ABSOLUTE path, so a browse that resolves with
    // an empty or relative `current` must NOT produce a selectable self-row.
    for (const current of ["", "relative/dir"]) {
      mockBrowse.mockResolvedValue({ current, parent: null, entries: [{ name: "child", path: `${current}/child` }] });
      const { unmount } = render(<SelfHarness />);
      await waitFor(() => expect(screen.getByText("child")).toBeTruthy());
      expect(screen.queryByTestId("path-picker-self")).toBeNull();
      unmount();
    }
  });

  it("E10 — child-row activation still descends (regression)", async () => {
    render(<SelfHarness />);
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    mockBrowse.mockResolvedValue(makeBrowseResult("/home/user/work", [], "/home/user"));
    fireEvent.click(screen.getByText("work"));
    await waitFor(() => {
      expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/work")).toBe(true);
    });
    expect(basket()).toBe("");
  });

  it("E11 — single-select mode renders no self-row, CONTENTS label, or checkboxes", async () => {
    render(<PathPicker initialPath="/home/user/" onSelect={onSelect} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByText("work")).toBeTruthy());
    expect(screen.queryByTestId("path-picker-self")).toBeNull();
    expect(screen.queryByTestId("path-picker-contents-label")).toBeNull();
    expect(screen.queryByTestId("path-picker-check-/home/user/work")).toBeNull();
  });

  it("F1 — CONTENTS label is skipped by keyboard traversal", async () => {
    render(<SelfHarness />);
    await screen.findByTestId("path-picker-self");
    const label = screen.getByTestId("path-picker-contents-label");
    expect(label.getAttribute("role")).not.toBe("option");
    const input = screen.getByRole("textbox");
    // From the self-row (index 0), the next highlight lands on the `..` row.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = screen.getAllByRole("option");
    const selected = options.find((o) => o.getAttribute("aria-selected") === "true");
    expect(selected?.textContent).toContain("..");
    expect(label.hasAttribute("aria-selected")).toBe(false);
  });

  it("F2 — CONTENTS label sits below the self-row and above `..`", async () => {
    render(<SelfHarness />);
    const selfRow = await screen.findByTestId("path-picker-self");
    const label = screen.getByTestId("path-picker-contents-label");
    const listbox = screen.getByRole("listbox");
    const kids = Array.from(listbox.querySelectorAll("[data-testid='path-picker-self'], [data-testid='path-picker-contents-label'], [role='option']"));
    const selfIdx = kids.indexOf(selfRow);
    const labelIdx = kids.indexOf(label);
    const dotdotIdx = kids.findIndex((k) => k.getAttribute("role") === "option" && k.textContent?.includes(".."));
    expect(selfIdx).toBeLessThan(labelIdx);
    expect(labelIdx).toBeLessThan(dotdotIdx);
  });

  it("F3 — Space toggles the self-row and inserts no literal space", async () => {
    render(<SelfHarness />);
    await screen.findByTestId("path-picker-self");
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const before = input.value;
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight the self-row
    fireEvent.keyDown(input, { key: " " });
    expect(basket()).toBe("/home/user");
    expect(input.value).toBe(before);
  });
});

describe("PathPicker MDI iconography", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowse.mockResolvedValue(homeEntries);
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/Users/robson/new-thing" });
  });

  it("renders no emoji glyphs and gives every row an SVG path", async () => {
    const { container } = render(
      <PathPicker initialPath="/Users/robson/Desk" onSelect={onSelect} onCancel={onCancel} />,
    );
    await waitFor(() => expect(screen.getByText("Desktop")).toBeTruthy());
    // Create-here row is present too (partial "Desk" has no exact match here).
    for (const glyph of ["⬆", "📁", "＋"]) {
      expect(container.textContent).not.toContain(glyph);
    }
    for (const row of screen.getAllByRole("option")) {
      expect(row.querySelector("svg path")).toBeTruthy();
    }
  });

  it("keeps git / pi as text badges", async () => {
    mockBrowse.mockResolvedValue(projectEntries);
    mockClassify.mockResolvedValue(
      makeFlagMap("/Users/robson/Project", [{ name: "pi-tools", isGit: true }]),
    );
    render(
      <PathPicker initialPath="/Users/robson/Project/" onSelect={onSelect} onCancel={onCancel} />,
    );
    await waitFor(() => expect(screen.getByText("git")).toBeTruthy());
  });
});
