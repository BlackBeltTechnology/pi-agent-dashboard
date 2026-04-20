import { describe, it, expect, vi, beforeEach } from "vitest";
import { PackageManagerWrapper, PackageOperationBusyError } from "../package-manager-wrapper.js";
import { ToolRegistry, OverridesStore } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { registerDefaultTools } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/definitions.js";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";

// Track mock functions
const installAndPersist = vi.fn().mockResolvedValue(undefined);
const removeAndPersist = vi.fn().mockResolvedValue(undefined);
const update = vi.fn().mockResolvedValue(undefined);
const listConfiguredPackages = vi.fn().mockReturnValue([
  { source: "npm:pi-doom", scope: "user", filtered: false },
  { source: "npm:pi-local", scope: "project", filtered: false },
]);
const checkForAvailableUpdates = vi.fn().mockResolvedValue([
  { source: "npm:pi-doom", displayName: "pi-doom", type: "npm" },
]);
const setProgressCallback = vi.fn();

// The PiModule returned by registry.resolveModule (bypasses vi.mock).
const fakePiModule = {
  DefaultPackageManager: function() {
    return {
      installAndPersist,
      removeAndPersist,
      update,
      listConfiguredPackages,
      checkForAvailableUpdates,
      setProgressCallback,
    };
  },
  SettingsManager: { create: () => ({}) },
};

/**
 * Build a ToolRegistry whose pi-coding-agent resolution is a no-op lookup
 * (any path) and whose importModule() returns the in-memory fake module.
 * This sidesteps the whole resolution chain so tests run without a
 * pi-coding-agent install.
 */
function makeTestRegistry(): ToolRegistry {
  // Per-test ephemeral overrides file so each test gets a fresh registry.
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "pmw-test-"));
  const overrides = new OverridesStore({
    filePath: path.join(tmpDir, "tool-overrides.json"),
  });
  overrides.set("pi-coding-agent", "/stub/pi-coding-agent/dist/index.js");

  // Inject importModule that always returns the fake pi module, bypassing
  // any real dynamic import. The override above ensures the strategy chain's
  // first step (overrideStrategy) returns the synthetic path, which
  // importModule then maps to our fakePiModule.
  const registry = new ToolRegistry({
    overrides,
    importModule: async () => fakePiModule,
  });
  registerDefaultTools(registry);
  return registry;
}

describe("PackageManagerWrapper", () => {
  let wrapper: PackageManagerWrapper;

  beforeEach(() => {
    installAndPersist.mockReset().mockResolvedValue(undefined);
    removeAndPersist.mockReset().mockResolvedValue(undefined);
    update.mockReset().mockResolvedValue(undefined);
    listConfiguredPackages.mockReset().mockReturnValue([
      { source: "npm:pi-doom", scope: "user", filtered: false },
      { source: "npm:pi-local", scope: "project", filtered: false },
    ]);
    checkForAvailableUpdates.mockReset().mockResolvedValue([
      { source: "npm:pi-doom", displayName: "pi-doom", type: "npm" },
    ]);
    setProgressCallback.mockReset();
    wrapper = new PackageManagerWrapper(makeTestRegistry());
  });

  it("returns operationId on run", async () => {
    const id = await wrapper.run({ action: "install", source: "npm:test", scope: "global" });
    expect(id).toMatch(/^[0-9a-f-]+$/);
  });

  it("throws PackageOperationBusyError on concurrent operations", async () => {
    let resolveInstall!: () => void;
    installAndPersist.mockImplementation(() => new Promise<void>((r) => { resolveInstall = r; }));

    await wrapper.run({ action: "install", source: "npm:a", scope: "global" });
    // Wait for the dynamic import + installAndPersist to be called
    await vi.waitFor(() => expect(installAndPersist).toHaveBeenCalled());

    await expect(
      wrapper.run({ action: "install", source: "npm:b", scope: "global" }),
    ).rejects.toThrow(PackageOperationBusyError);

    resolveInstall();
    await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));
  });

  it("forwards progress events via listener", async () => {
    const progressEvents: any[] = [];

    let capturedCallback: any;
    setProgressCallback.mockImplementation((cb: any) => { capturedCallback = cb; });
    installAndPersist.mockImplementation(async () => {
      capturedCallback?.({ type: "start", action: "install", source: "npm:test" });
      capturedCallback?.({ type: "complete", action: "install", source: "npm:test" });
    });

    wrapper.setProgressListener((opId, event) => {
      progressEvents.push({ opId, event });
    });

    const opId = await wrapper.run({ action: "install", source: "npm:test", scope: "global" });
    await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

    expect(progressEvents.length).toBe(2);
    expect(progressEvents[0].opId).toBe(opId);
    expect(progressEvents[0].event.type).toBe("start");
    expect(progressEvents[1].event.type).toBe("complete");
  });

  it("calls reloadSessions on success", async () => {
    const reloadFn = vi.fn().mockResolvedValue(3);
    wrapper.setReloadSessions(reloadFn);

    const completions: any[] = [];
    wrapper.setCompleteListener((result) => completions.push(result));

    await wrapper.run({ action: "install", source: "npm:test", scope: "global" });
    await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

    expect(reloadFn).toHaveBeenCalledOnce();
    expect(completions[0].success).toBe(true);
    expect(completions[0].sessionsReloaded).toBe(3);
  });

  it("does NOT call reloadSessions on failure", async () => {
    installAndPersist.mockRejectedValue(new Error("npm exploded"));

    const reloadFn = vi.fn().mockResolvedValue(0);
    wrapper.setReloadSessions(reloadFn);

    const completions: any[] = [];
    wrapper.setCompleteListener((result) => completions.push(result));

    await wrapper.run({ action: "install", source: "npm:test", scope: "global" });
    await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

    expect(reloadFn).not.toHaveBeenCalled();
    expect(completions[0].success).toBe(false);
    expect(completions[0].error).toBe("npm exploded");
  });

  it("listInstalled filters by scope", async () => {
    const global = await wrapper.listInstalled("global");
    expect(global).toEqual([{ source: "npm:pi-doom", scope: "user", filtered: false }]);

    const local = await wrapper.listInstalled("local");
    expect(local).toEqual([{ source: "npm:pi-local", scope: "project", filtered: false }]);
  });

  it("checkUpdates delegates to PackageManager", async () => {
    const updates = await wrapper.checkUpdates();
    expect(updates).toEqual([{ source: "npm:pi-doom", displayName: "pi-doom", type: "npm" }]);
  });

  it("calls remove for remove action", async () => {
    const completions: any[] = [];
    wrapper.setCompleteListener((result) => completions.push(result));

    await wrapper.run({ action: "remove", source: "npm:test", scope: "local", cwd: "/tmp" });
    await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

    expect(removeAndPersist).toHaveBeenCalledWith("npm:test", { local: true });
    expect(completions[0].success).toBe(true);
  });

  it("calls update for update action", async () => {
    const completions: any[] = [];
    wrapper.setCompleteListener((result) => completions.push(result));

    await wrapper.run({ action: "update", source: "npm:test", scope: "global" });
    await vi.waitFor(() => expect(wrapper.isBusy()).toBe(false));

    expect(update).toHaveBeenCalledWith("npm:test");
    expect(completions[0].success).toBe(true);
  });
});
