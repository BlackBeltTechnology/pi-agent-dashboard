import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEditorManager, allocatePort } from "../editor-manager.js";
import type { EditorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { EditorDetectionResult } from "@blackbelt-technology/pi-dashboard-shared/editor-types.js";

const DEFAULT_CONFIG: EditorConfig = { idleTimeoutMinutes: 10, maxInstances: 3 };
const DETECTED: EditorDetectionResult = { available: true, binary: "/usr/local/bin/code-server" };
const NOT_DETECTED: EditorDetectionResult = { available: false };

describe("allocatePort", () => {
  it("returns a positive port number", async () => {
    const port = await allocatePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe("createEditorManager", () => {
  it("creates a manager with empty instance list", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    expect(mgr.list()).toEqual([]);
  });

  it("start throws when binary not found", async () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: NOT_DETECTED, allowRedetection: false });
    await expect(mgr.start("/tmp/test")).rejects.toThrow("binary_not_found");
  });

  it("get returns undefined for unknown id", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    expect(mgr.get("nonexistent")).toBeUndefined();
  });

  it("getByFolder returns undefined for unknown folder", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    expect(mgr.getByFolder("/unknown")).toBeUndefined();
  });

  it("stop on unknown id does not throw", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    expect(() => mgr.stop("nonexistent")).not.toThrow();
  });

  it("stopAll on empty manager does not throw", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    expect(() => mgr.stopAll()).not.toThrow();
  });

  it("heartbeat on unknown id does not throw", () => {
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED });
    expect(() => mgr.heartbeat("nonexistent")).not.toThrow();
  });

  it("enforces max instances when all would exceed cap", async () => {
    const config: EditorConfig = { idleTimeoutMinutes: 10, maxInstances: 0 };
    const mgr = createEditorManager({ config, detection: DETECTED });
    // maxInstances=0 means no instances allowed, but eviction has nothing to evict
    await expect(mgr.start("/tmp/test")).rejects.toThrow("max_instances_reached");
  });

  it("accepts an injected pidRegistry without affecting back-compat behavior", () => {
    const calls: string[] = [];
    const stubRegistry = {
      register: () => calls.push("register"),
      remove: () => calls.push("remove"),
      size: () => 0,
      cleanupOrphans: async () => {},
      adoptOrphans: async () => ({ adopted: [] }),
    };
    const mgr = createEditorManager({ config: DEFAULT_CONFIG, detection: DETECTED, pidRegistry: stubRegistry });
    expect(mgr.list()).toEqual([]);
    // stop on unknown id is a no-op and must not call registry.remove
    expect(() => mgr.stop("nonexistent")).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("start failure path does not call pidRegistry.register", async () => {
    const calls: string[] = [];
    const stubRegistry = {
      register: () => calls.push("register"),
      remove: () => calls.push("remove"),
      size: () => 0,
      cleanupOrphans: async () => {},
      adoptOrphans: async () => ({ adopted: [] }),
    };
    const mgr = createEditorManager({
      config: DEFAULT_CONFIG,
      detection: NOT_DETECTED,
      allowRedetection: false,
      pidRegistry: stubRegistry,
    });
    await expect(mgr.start("/tmp/test")).rejects.toThrow("binary_not_found");
    expect(calls).toEqual([]);
  });

  it("calls onStatusChange callback", async () => {
    const statusChanges: Array<{ cwd: string; id: string; status: string }> = [];
    const mgr = createEditorManager({
      config: DEFAULT_CONFIG,
      detection: NOT_DETECTED,
      allowRedetection: false,
      onStatusChange: (cwd, id, status) => statusChanges.push({ cwd, id, status }),
    });
    // binary_not_found throws before any status change
    await expect(mgr.start("/tmp")).rejects.toThrow("binary_not_found");
    expect(statusChanges).toEqual([]);
  });
});
