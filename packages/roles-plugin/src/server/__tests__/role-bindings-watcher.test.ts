/**
 * X8: a role change written by the agent `update_roles` writer (extension
 * `saveRoleConfig`, tmp+rename into ~/.pi/agent/providers.json) is picked up by
 * the watcher and re-projects the bound target.
 * See change: add-role-aware-model-refs.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { loadRoleConfig, saveRoleConfig } from "../../../../extension/src/role-manager.js";
import { createRoleBindings, type Concrete } from "../role-bindings.js";
import { startRoleWatcher } from "../role-watcher.js";

describe("X8 agent tool writer → watcher → projection", () => {
  it("re-projects a bound target", async () => {
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    const cfg = loadRoleConfig();
    cfg.roles.fast = "anthropic/claude-haiku-4-5";
    saveRoleConfig(cfg);

    const target: Record<string, Concrete> = { observerModel: { provider: "anthropic", id: "claude-haiku-4-5" } };
    const logger = { info() {}, warn() {}, error() {} };
    const engine = createRoleBindings({
      storePath: join(mkdtempSync(join(tmpdir(), "x8-")), "b.json"),
      readRoleConfig: () => readRoleConfigFromDisk(),
      logger,
    });
    engine.service.registerProjector({
      owner: "blackhole",
      acceptsField: (f) => f === "observerModel",
      read: (f) => target[f],
      write: (f, r) => {
        target[f] = r;
      },
    });
    await engine.idle();
    engine.service.replaceBindings("blackhole", [
      { field: "observerModel", ref: "@fast", projected: target.observerModel! },
    ]);

    let passDone!: () => void;
    const done = new Promise<void>((r) => (passDone = r));
    const watcher = startRoleWatcher({
      dir: join(homedir(), ".pi", "agent"),
      debounceMs: 50,
      readRoles: () => readRoleConfigFromDisk().roles,
      onChange: async () => {
        await engine.runPass("change");
        passDone();
      },
    });
    const next = loadRoleConfig();
    next.roles.fast = "openai/gpt-5-mini";
    saveRoleConfig(next);
    await done;
    watcher.close();
    expect(target.observerModel).toEqual({ provider: "openai", id: "gpt-5-mini" });
  });
});
