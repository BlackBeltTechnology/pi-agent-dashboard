/**
 * X8: a role change written by the agent `update_roles` writer (extension
 * `saveRoleConfig`, tmp+rename into ~/.pi/agent/providers.json) is picked up by
 * the watcher and re-projects the bound target.
 * See change: add-role-aware-model-refs.
 */

import { mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { describe, expect, it, vi } from "vitest";
import { loadRoleConfig, saveRoleConfig } from "../../../../extension/src/role-manager.js";
import { type Concrete, createRoleBindings } from "../role-bindings.js";
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

// See change: default-model-follows-role (test-plan #E16).
describe("E16 watcher change → host re-mirror", () => {
  it("calls host.remirrorPiDefaults once per change; absent service → no throw", async () => {
    const { remirrorPiDefaults } = await import("../host-default-model.js");
    mkdirSync(join(homedir(), ".pi", "agent"), { recursive: true });
    const stub = vi.fn(async () => {});
    const services: Record<string, unknown> = { "host.remirrorPiDefaults": stub };
    const consume = <T>(k: string) => services[k] as T | undefined;

    let changes = 0;
    let onChanged!: () => void;
    let changed = new Promise<void>((r) => (onChanged = r));
    const watcher = startRoleWatcher({
      dir: join(homedir(), ".pi", "agent"),
      debounceMs: 30,
      readRoles: () => readRoleConfigFromDisk().roles,
      onChange: () => {
        changes++;
        remirrorPiDefaults(consume);
        onChanged();
      },
    });
    const write = (model: string) => {
      const c = loadRoleConfig();
      c.roles.planning = model;
      saveRoleConfig(c);
    };
    write("anthropic/claude-sonnet-5-5");
    await changed;
    changed = new Promise<void>((r) => (onChanged = r));
    write("proxy/cc/claude-sonnet-5-5");
    await changed;
    watcher.close();
    expect(stub).toHaveBeenCalledTimes(changes);
    expect(changes).toBeGreaterThanOrEqual(2);

    delete services["host.remirrorPiDefaults"];
    expect(() => remirrorPiDefaults(consume)).not.toThrow();
  });
});
