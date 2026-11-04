/**
 * WorktreeSpawnDialog model · thinking · role chip.
 * test-plan: E30–E35. See change: add-spawn-model-choice.
 * Exemplar: WorktreeSpawnDialog.test.tsx (git-api mocks).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setAcpAgentsForTests } from "../../hooks/useAcpAgents.js";
import { getRememberedSpawnChoice, setSpawnDefaults, spawnChoiceKey } from "../../lib/spawn/spawn-choice-memory.js";
import { WorktreeSpawnDialog } from "../worktree/WorktreeSpawnDialog.js";

const git = vi.hoisted(() => ({
  fetchGitHead: vi.fn(),
  fetchWorktrees: vi.fn(),
  fetchBranches: vi.fn(),
  createWorktree: vi.fn(),
  probePathExists: vi.fn(),
  cleanupOrphanWorktreePath: vi.fn(),
}));
vi.mock("../../lib/git/git-api.js", async () => ({
  ...(await vi.importActual<object>("../../lib/git/git-api.js")),
  ...git,
}));
vi.mock("../../hooks/useModelCatalogue.js", () => ({
  useModelCatalogue: () => ({
    models: [
      { provider: "anthropic", id: "claude-opus-5-5", name: "Opus" },
      { provider: "anthropic", id: "claude-sonnet-5-5", name: "Sonnet" },
    ],
    catalogue: null,
    fetching: false,
    loading: false,
    unavailable: false,
    refetch: async () => {},
  }),
}));

let store: Record<string, string>;
beforeEach(() => {
  store = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  });
  Object.defineProperty(window, "localStorage", { value: globalThis.localStorage, configurable: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ preset: null, roles: [{ role: "planning", assigned: true, model: "anthropic/claude-opus-5-5" }, { role: "review", assigned: true, model: "anthropic/claude-sonnet-5-5" }] }] }),
    })),
  );
  git.fetchGitHead.mockResolvedValue({ branch: "main", detached: false, sha: "abc" });
  git.fetchWorktrees.mockResolvedValue([
    { path: "/repo", branch: "main", isMain: true, sha: "", bare: false, detached: false },
    { path: "/repo/.worktrees/feat-x", branch: "feat/x", isMain: false, sha: "", bare: false, detached: false },
  ]);
  git.fetchBranches.mockResolvedValue({ current: "main", detached: false, branches: [{ name: "main", isRemote: false, isCurrent: true }] });
  git.probePathExists.mockResolvedValue(false);
  git.cleanupOrphanWorktreePath.mockResolvedValue({ ok: true });
  setSpawnDefaults({});
  _setAcpAgentsForTests([]);
});
afterEach(() => {
  cleanup();
  _setAcpAgentsForTests(null);
  setSpawnDefaults({});
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const featRow = () => screen.getByTestId(`worktree-row-${encodeURIComponent("/repo/.worktrees/feat-x")}`);
const chip = () => screen.getByTestId("worktree-dialog-model-choice");
const openChip = () => fireEvent.click(within(chip()).getByTestId("model-selector-button"));

async function mount(props: Partial<React.ComponentProps<typeof WorktreeSpawnDialog>> = {}) {
  const onSpawn = vi.fn();
  render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} {...props} />);
  await waitFor(() => expect(screen.queryByTestId("worktree-dialog-loading")).toBeNull());
  return onSpawn;
}

describe("worktree dialog model choice", () => {
  it("E30: create-new carries the picked model + thinking level", async () => {
    git.createWorktree.mockResolvedValue({ ok: true, path: "/repo/.worktrees/feat-y", branch: "feat/y", excludeAppended: true });
    const onSpawn = await mount();
    openChip();
    fireEvent.click(screen.getAllByTestId("model-row").find((r) => r.textContent?.includes("claude-opus-5-5")) as HTMLElement);
    openChip();
    fireEvent.click(screen.getByRole("radio", { name: "high" }));
    fireEvent.click(screen.getByTestId("worktree-source-fork"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), { target: { value: "feat/y" } });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-y", {
      gitWorktreeBase: "main",
      model: "anthropic/claude-opus-5-5",
      thinkingLevel: "high",
    });
  });

  it("E31: an existing worktree row carries a picked role", async () => {
    const onSpawn = await mount();
    openChip();
    await waitFor(() => screen.getByTestId("model-tab-role"));
    fireEvent.click(screen.getByTestId("model-tab-role"));
    fireEvent.click(screen.getAllByTestId("role-row").find((r) => r.getAttribute("data-role") === "planning") as HTMLElement);
    fireEvent.click(featRow());
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-x", { model: "@planning" });
    expect(getRememberedSpawnChoice("/repo")).toEqual({ model: "@planning" });
  });

  it("E32: preselects folder memory, else the Settings default tagged default", async () => {
    store[spawnChoiceKey("/repo")] = JSON.stringify({ model: "@review" });
    await mount();
    expect(within(chip()).getByTestId("model-trigger-role-ref").textContent).toContain("@review");
    expect(within(chip()).queryByTestId("model-tag")).toBeNull();
    cleanup();
    delete store[spawnChoiceKey("/repo")];
    setSpawnDefaults({ defaultModel: "anthropic/claude-sonnet-5-5" });
    await mount();
    expect(within(chip()).getByTestId("model-selector-button").textContent).toContain("anthropic/claude-sonnet-5-5");
    expect(within(chip()).getByTestId("model-tag").textContent).toBe("default");
  });

  it("E33: the model default entry clears the remembered model only", async () => {
    store[spawnChoiceKey("/repo")] = JSON.stringify({ model: "@review", thinkingLevel: "high" });
    setSpawnDefaults({ defaultModel: "anthropic/claude-sonnet-5-5" });
    await mount();
    openChip();
    fireEvent.click(screen.getByTestId("model-default-entry"));
    expect(getRememberedSpawnChoice("/repo")).toEqual({ thinkingLevel: "high" });
    expect(within(chip()).getByTestId("model-selector-button").textContent).toContain("anthropic/claude-sonnet-5-5");
    expect(within(chip()).getByTestId("model-tag").textContent).toBe("default");
  });

  it("E34: hidden mode renders no chip and sends no model", async () => {
    store[spawnChoiceKey("/repo")] = JSON.stringify({ model: "@review", thinkingLevel: "high" });
    const onSpawn = await mount({ modelChoice: "hidden" });
    expect(screen.queryByTestId("worktree-dialog-model-choice")).toBeNull();
    fireEvent.click(featRow());
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-x", undefined);
  });

  it("E35: an ACP agent disables the chip and drops the model", async () => {
    _setAcpAgentsForTests([{ id: "qmt", name: "querymt" }]);
    store[spawnChoiceKey("/repo")] = JSON.stringify({ model: "@fast" });
    const onSpawn = await mount();
    fireEvent.change(screen.getByTestId("worktree-dialog-agent"), { target: { value: "qmt" } });
    expect(chip().getAttribute("aria-disabled")).toBe("true");
    expect((within(chip()).getByTestId("model-selector-button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(featRow());
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-x", { agent: "qmt" });
  });
});
