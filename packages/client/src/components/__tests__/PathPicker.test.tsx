import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
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

// simplify-add-folder-picker — the multi-select picker behaves like an OS file
// manager: click selects, the platform modifier toggles, Shift ranges,
// double-click (or a touch tap) opens, long-press selects on touch. The picker
// owns the selection and reports `{ selected, current, isHome }` upward.
// Ids map to openspec/changes/simplify-add-folder-picker/test-plan.md.
describe("PathPicker file-manager multi-select", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const onChange = vi.fn();
  const USER = makeBrowseResult("/home/user", [
    { name: "a" }, { name: "b" }, { name: "c" }, { name: "d" },
    { name: "notes" }, { name: "projects" }, { name: "work" },
  ], "/home");
  const WORK = makeBrowseResult("/home/user/work", [{ name: "src" }], "/home/user");
  const PROJ = makeBrowseResult("/home/user/projects", [{ name: "alpha" }], "/home/user");

  let platformDesc: PropertyDescriptor | undefined;
  function setPlatform(p: string) {
    Object.defineProperty(window.navigator, "platform", { value: p, configurable: true });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    platformDesc = Object.getOwnPropertyDescriptor(window.navigator, "platform");
    setPlatform("Win32");
    mockBrowse.mockImplementation(async (dir?: string) => {
      if (dir === "/home/user/work" || dir === "/home/user/work/") return WORK;
      if (dir === "/home/user/projects") return PROJ;
      return USER;
    });
    mockClassify.mockResolvedValue({});
    mockMkdir.mockResolvedValue({ path: "/home/user/new" });
  });
  afterEach(() => {
    if (platformDesc) Object.defineProperty(window.navigator, "platform", platformDesc);
    else delete (window.navigator as unknown as Record<string, unknown>).platform;
    vi.useRealTimers();
  });

  function renderMulti(props: { initialPath?: string; selection?: { pinnedKeys?: Set<string> }; onOpenServers?: () => void } = {}) {
    const { selection, ...rest } = props;
    return render(
      <PathPicker
        initialPath="/home/user/"
        onSelect={onSelect}
        onCancel={onCancel}
        {...rest}
        selection={{ onChange, ...selection }}
      />,
    );
  }
  const row = (name: string) => screen.getByTestId(`path-picker-row-/home/user/${name}`);
  const selectedNames = () =>
    screen.getAllByRole("option")
      .filter((o) => o.getAttribute("aria-selected") === "true")
      .map((o) => o.textContent?.trim());
  const lastChange = () => onChange.mock.calls.at(-1)?.[0];
  const ready = async () => waitFor(() => expect(screen.getByText("work")).toBeTruthy());
  const touchDown = (el: HTMLElement, x = 0, y = 0) =>
    fireEvent.pointerDown(el, { pointerType: "touch", clientX: x, clientY: y });

  it("F1 — single click selects one row without navigating or committing", async () => {
    renderMulti();
    await ready();
    const calls = mockBrowse.mock.calls.length;
    fireEvent.click(row("work"));
    expect(selectedNames()).toEqual(["work"]);
    expect(mockBrowse.mock.calls.length).toBe(calls);
    expect(onSelect).not.toHaveBeenCalled();
    expect(lastChange()).toMatchObject({ selected: ["/home/user/work"], current: "/home/user" });
  });

  it("F2 — double click opens the folder; dialog stays mounted", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    fireEvent.doubleClick(row("work"));
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/work")).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("F3 — selecting a row does not remount it (dblclick needs the same node)", async () => {
    renderMulti();
    await ready();
    const before = row("work");
    fireEvent.click(before);
    expect(row("work")).toBe(before);
  });

  it("F5 — clicking empty list space clears the selection", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    fireEvent.click(screen.getByRole("listbox"));
    expect(selectedNames()).toEqual([]);
  });

  it("F6 — `..` navigates up on a single click", async () => {
    renderMulti();
    await ready();
    const dotdot = screen.getAllByRole("option").find((o) => o.textContent?.includes(".."))!;
    fireEvent.click(dotdot);
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home")).toBe(true));
  });

  it("F7 — opening a folder clears the selection and reports the new folder", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    fireEvent.click(row("notes"), { ctrlKey: true });
    fireEvent.doubleClick(row("projects"));
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    expect(selectedNames()).toEqual([]);
    expect(lastChange()).toMatchObject({ selected: [], current: "/home/user/projects" });
  });

  it("F8 — typed navigation clears the selection", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    mockBrowse.mockResolvedValue(makeBrowseResult("/tmp", [{ name: "x" }], "/"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "/tmp/" } });
    await waitFor(() => expect(screen.getByText("x")).toBeTruthy());
    expect(lastChange()).toMatchObject({ selected: [], current: "/tmp" });
  });

  it("F10 — a stale fetch never overrides the latest navigation", async () => {
    renderMulti();
    await ready();
    let releaseWork: (v: unknown) => void = () => {};
    mockBrowse.mockImplementation((dir?: string) => {
      if (dir === "/home/user/work") return new Promise((r) => { releaseWork = r; });
      if (dir === "/home") return Promise.resolve(makeBrowseResult("/home", [{ name: "user" }], "/"));
      return Promise.resolve(USER);
    });
    fireEvent.doubleClick(row("work"));
    // Rows are hidden while `work` loads; go up with the keyboard (Alt↑ on Windows).
    // `..` targets the last resolved parent (/home) and supersedes the work fetch.
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(lastChange()?.current).toBe("/home"));
    await act(async () => { releaseWork(WORK); });
    expect(lastChange()?.current).toBe("/home");
    expect(screen.queryByText("src")).toBeNull();
  });

  it("F11 — touch tap opens the folder and selects nothing", async () => {
    renderMulti();
    await ready();
    touchDown(row("work"));
    fireEvent.pointerUp(row("work"), { pointerType: "touch" });
    fireEvent.click(row("work"));
    await waitFor(() => expect(screen.getByText("src")).toBeTruthy());
    expect(lastChange()?.selected).toEqual([]);
  });

  it("F12 — long-press boundary: 399 ms is a tap, 400 ms selects and swallows the click", async () => {
    renderMulti();
    await ready();
    vi.useFakeTimers();
    touchDown(row("notes"));
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(row("notes"), { pointerType: "touch" });
    fireEvent.click(row("notes")); // swallowed
    expect(selectedNames()).toEqual(["notes"]);
    expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/notes")).toBe(false);

    // Fresh render for the 399 ms half.
    cleanup();
    onChange.mockClear();
    renderMulti();
    vi.useRealTimers();
    await ready();
    vi.useFakeTimers();
    touchDown(row("work"));
    act(() => { vi.advanceTimersByTime(399); });
    fireEvent.pointerUp(row("work"), { pointerType: "touch" });
    fireEvent.click(row("work"));
    vi.useRealTimers();
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/work")).toBe(true));
  });

  it("F13 — finger travel beyond 10 px cancels the long-press", async () => {
    renderMulti();
    await ready();
    vi.useFakeTimers();
    touchDown(row("notes"), 0, 0);
    fireEvent.pointerMove(row("notes"), { pointerType: "touch", clientX: 0, clientY: 10 });
    act(() => { vi.advanceTimersByTime(400); });
    expect(selectedNames()).toEqual(["notes"]);
    fireEvent.pointerUp(row("notes"), { pointerType: "touch" });
    fireEvent.click(row("notes")); // swallowed
    touchDown(row("a"), 0, 0);
    fireEvent.pointerMove(row("a"), { pointerType: "touch", clientX: 0, clientY: 11 });
    act(() => { vi.advanceTimersByTime(400); });
    expect(selectedNames()).toEqual(["notes"]);
  });

  it("F14 — in select mode taps toggle; deselecting the last row leaves select mode", async () => {
    renderMulti();
    await ready();
    vi.useFakeTimers();
    touchDown(row("work"));
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(row("work"), { pointerType: "touch" });
    fireEvent.click(row("work")); // swallowed
    const tap = (n: string) => {
      touchDown(row(n));
      fireEvent.pointerUp(row(n), { pointerType: "touch" });
      fireEvent.click(row(n));
    };
    tap("notes");
    expect(selectedNames()).toEqual(["notes", "work"]);
    tap("notes");
    expect(selectedNames()).toEqual(["work"]);
    tap("work");
    expect(selectedNames()).toEqual([]);
    vi.useRealTimers();
    tap("notes"); // select mode is off → opens
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/notes")).toBe(true));
  });

  it("F15 — grammar follows the latest pointerdown, not a media query", async () => {
    renderMulti();
    await ready();
    fireEvent.pointerDown(row("work"), { pointerType: "mouse" });
    fireEvent.click(row("work"));
    expect(selectedNames()).toEqual(["work"]);
    touchDown(row("notes"));
    fireEvent.pointerUp(row("notes"), { pointerType: "touch" });
    fireEvent.click(row("notes"));
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/notes")).toBe(true));
  });

  it("F16 — row contextmenu is suppressed for touch only", async () => {
    renderMulti();
    await ready();
    touchDown(row("work"));
    const touchEvt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    row("work").dispatchEvent(touchEvt);
    expect(touchEvt.defaultPrevented).toBe(true);
    fireEvent.pointerUp(row("work"), { pointerType: "touch" });
    fireEvent.pointerDown(row("work"), { pointerType: "mouse" });
    const mouseEvt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    row("work").dispatchEvent(mouseEvt);
    expect(mouseEvt.defaultPrevented).toBe(false);
  });

  it("F20 — Tab is not trapped in the path input in multi-select", async () => {
    renderMulti();
    await ready();
    const evt = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    screen.getByRole("textbox").dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });

  it("F21 — arrows move/extend, Enter opens, platform go-up returns (Windows: Alt↑)", async () => {
    renderMulti();
    await ready();
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selectedNames()).toEqual(["a"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selectedNames()).toEqual(["b"]);
    fireEvent.keyDown(input, { key: "ArrowDown", shiftKey: true });
    expect(selectedNames()).toEqual(["b", "c"]);
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(selectedNames()).toEqual(["b"]);
    fireEvent.keyDown(input, { key: "ArrowUp", metaKey: true }); // mac chord: no-op on Windows
    expect(mockBrowse.mock.calls.some((c) => c[0] === "/home")).toBe(false);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/b")).toBe(true));
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user")).toBe(true));
  });

  it("F21b — macOS: ⌘↓ opens, ⌘↑ goes up, Alt↑ does nothing", async () => {
    setPlatform("MacIntel");
    renderMulti();
    await ready();
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp", altKey: true });
    expect(mockBrowse.mock.calls.some((c) => c[0] === "/home")).toBe(false);
    fireEvent.keyDown(input, { key: "ArrowDown", metaKey: true });
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/a")).toBe(true));
    fireEvent.keyDown(input, { key: "ArrowUp", metaKey: true });
    await waitFor(() => expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user")).toBe(true));
  });

  it("E6m — macOS: ⌘-click toggles, Ctrl-click does not add", async () => {
    setPlatform("MacIntel");
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    fireEvent.click(row("notes"), { metaKey: true });
    expect(selectedNames()).toEqual(["notes", "work"]);
    fireEvent.click(row("a"), { ctrlKey: true });
    expect(selectedNames()).toEqual(["a"]);
  });

  it("F22 — Space does not toggle selection", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    const evt = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    screen.getByRole("textbox").dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
    expect(selectedNames()).toEqual(["work"]);
  });

  it("F23 — a11y: multiselectable listbox, activedescendant, no checkbox or chevron", async () => {
    renderMulti();
    await ready();
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    const input = screen.getByRole("textbox");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    fireEvent.click(row("work"));
    expect(input.getAttribute("aria-activedescendant")).toBe(row("work").id);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByTestId("path-picker-open-/home/user/work")).toBeNull();
    expect(screen.queryByTestId("path-picker-self")).toBeNull();
    expect(screen.queryByTestId("path-picker-contents-label")).toBeNull();
  });

  it("F23b — selected rows carry a check mark (shape, not colour only)", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    expect(screen.getByTestId("path-picker-check-mark-/home/user/work")).toBeTruthy();
    expect(screen.queryByTestId("path-picker-check-mark-/home/user/notes")).toBeNull();
  });

  it("F23c — an empty folder explains the next step", async () => {
    mockBrowse.mockResolvedValue(makeBrowseResult("/home/user", [], null));
    renderMulti();
    const empty = await screen.findByTestId("path-picker-empty");
    expect(empty.textContent).toMatch(/No subfolders here/);
    expect(empty.textContent).toMatch(/New folder/);
  });

  it("F24 — the live region announces the selected count", async () => {
    renderMulti();
    await ready();
    const live = screen.getByTestId("path-picker-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    fireEvent.click(row("work"), { ctrlKey: true });
    expect(live.textContent).toMatch(/1/);
    fireEvent.click(row("notes"), { ctrlKey: true });
    expect(live.textContent).toMatch(/2/);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(live.textContent).toBe("");
  });

  it("F28 — activation (dblclick, Enter) browses and never calls onSelect", async () => {
    renderMulti();
    await ready();
    fireEvent.doubleClick(row("projects"));
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    const input = screen.getByRole("textbox");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(mockBrowse.mock.calls.some((c) => c[0] === "/home/user/projects/alpha")).toBe(true),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("E10 — `added` marker joins pinned keys by pathKey (trailing separator drift)", async () => {
    const pinnedKeys = new Set([pathKey("/home/user/work/", inferPlatform(["/home/user/work/"]))]);
    renderMulti({ selection: { pinnedKeys } });
    await ready();
    expect(screen.getByTestId("path-picker-added-/home/user/work")).toBeTruthy();
    expect(screen.queryByTestId("path-picker-added-/home/user/notes")).toBeNull();
  });

  it("E10b — `added` marker collapses Windows case drift", async () => {
    mockBrowse.mockResolvedValue({
      current: "c:\\users\\me",
      parent: "c:\\users",
      entries: [{ name: "Work", path: "c:\\users\\me\\Work" }],
    });
    const p = "C:\\Users\\ME\\Work";
    renderMulti({ initialPath: "c:\\users\\me\\", selection: { pinnedKeys: new Set([pathKey(p, inferPlatform([p]))]) } });
    await waitFor(() => expect(screen.getByText("Work")).toBeTruthy());
    expect(screen.getByTestId("path-picker-added-c:\\users\\me\\Work")).toBeTruthy();
  });

  it("E11 — modifier+A selects every row, added ones included", async () => {
    renderMulti();
    await ready();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "a", ctrlKey: true });
    expect(selectedNames()).toHaveLength(7);
  });

  it("E12 — Backspace and modifier+A edit text while the input has a pending edit", async () => {
    renderMulti();
    await ready();
    const input = screen.getByRole("textbox") as HTMLInputElement;
    const calls = mockBrowse.mock.calls.length;
    const bs = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    input.dispatchEvent(bs);
    expect(bs.defaultPrevented).toBe(true); // input == browsed dir → acts on the list (go up)
    await waitFor(() => expect(mockBrowse.mock.calls.length).toBeGreaterThan(calls));

    cleanup();
    renderMulti();
    await ready();
    const input2 = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input2, { target: { value: "/home/user/wo" } });
    const bs2 = new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    input2.dispatchEvent(bs2);
    expect(bs2.defaultPrevented).toBe(false);
    const selAll = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true });
    input2.dispatchEvent(selAll);
    expect(selAll.defaultPrevented).toBe(false);
    expect(selectedNames()).toEqual([]);
  });

  it("E13 — isHome is true only for the first no-path browse result", async () => {
    render(<PathPicker onSelect={onSelect} onCancel={onCancel} selection={{ onChange }} />);
    await ready();
    expect(lastChange()).toMatchObject({ current: "/home/user", isHome: true });
    fireEvent.doubleClick(row("work"));
    await waitFor(() => expect(lastChange()).toMatchObject({ current: "/home/user/work", isHome: false }));
    fireEvent.click(screen.getAllByRole("option").find((o) => o.textContent?.includes(".."))!);
    await waitFor(() => expect(lastChange()).toMatchObject({ current: "/home/user", isHome: true }));
  });

  it("E14 — with an explicit initialPath no folder is treated as home", async () => {
    renderMulti();
    await ready();
    expect(lastChange()).toMatchObject({ current: "/home/user", isHome: false });
  });

  it("X1 — a failed open keeps the folder and the selection", async () => {
    renderMulti();
    await ready();
    fireEvent.click(row("work"));
    fireEvent.click(row("notes"), { ctrlKey: true });
    mockBrowse.mockRejectedValueOnce(new Error("boom"));
    fireEvent.doubleClick(row("projects"));
    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
    expect(lastChange()).toMatchObject({
      selected: ["/home/user/work", "/home/user/notes"],
      current: "/home/user",
    });
  });

  it("X2 — network-guard denial still renders the remedy in multi-select", async () => {
    mockBrowse.mockRejectedValue(Object.assign(new Error("denied"), { code: "network_not_allowed", hint: "add it" }));
    renderMulti({ onOpenServers: vi.fn() });
    await waitFor(() => expect(screen.getByText("add it")).toBeTruthy());
    expect(lastChange()?.current ?? null).toBeNull();
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
