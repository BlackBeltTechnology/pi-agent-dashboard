/**
 * Plugin-owned session refs are DURABLE (upstream report
 * UPSTREAM-PLUGIN-REF-PERSISTENCE, 2026-09-24).
 *
 * Before: a key a plugin stamped (spawn `pluginRef` / `assignSessionRef`) hit
 * `.meta.json` once via `mergeSessionMeta`, then the next routine save —
 * `sessionToMeta` → FULL overwrite from a fixed field list — wiped it; the boot
 * scan restored only named fields; key ownership lived in a process Map.
 *
 * Now: core keeps an owner-namespaced bag `pluginRefs[pluginId]` on the session,
 * serializes it verbatim, restores + re-projects it on boot and on a bridge
 * reattach, and rebuilds key ownership from it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingPluginRefRegistry } from "../pending/pending-plugin-ref-registry.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { applyPluginRef, PLUGIN_REF_BAG_MAX_BYTES } from "../session/plugin-refs.js";
import { sessionFromMeta } from "../session/session-scanner.js";
import { sessionToMeta } from "../session/session-to-meta.js";

const OWNER = { iss: "https://idp.example/realms/r", sub: "anna-sub" };

describe("plugin-owned session refs survive saves, restarts and reattach", () => {
  let tmpDir: string;
  let sessionFile: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-ref-"));
    sessionFile = path.join(tmpDir, "s1.jsonl");
  });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  function setup() {
    const sessionManager = createMemorySessionManager();
    const persistence = createMetaPersistence();
    const registry = createPendingPluginRefRegistry({ warn: () => {} });
    sessionManager.register({ id: "s1", cwd: "/w", source: "dashboard" } as never);
    sessionManager.update("s1", { sessionFile });
    /** The server's routine save (server.ts: metaPersistence.save(sessionToMeta(s))). */
    const routineSave = () => {
      const s = sessionManager.get("s1") as DashboardSession;
      persistence.save(sessionFile, sessionToMeta(s));
      persistence.flush(sessionFile);
    };
    const apply = (ownerId: string, ref: Record<string, unknown>, persist = true) =>
      applyPluginRef({ sessionManager, sanitize: registry.sanitize }, "s1", ownerId, ref, { persist });
    /** Boot-scan restore from disk into a fresh process. */
    const restart = () => {
      const meta = readSessionMeta(sessionFile) ?? {};
      const restored = sessionFromMeta("s1", sessionFile, tmpDir, meta, Date.now());
      const mgr2 = createMemorySessionManager();
      mgr2.restore(restored);
      const reg2 = createPendingPluginRefRegistry({ warn: () => {} });
      reg2.claimPersisted(mgr2.listAll());
      return { mgr2, reg2 };
    };
    return { sessionManager, registry, routineSave, apply, restart };
  }

  it("1. a spawn-time / assigned ref survives a routine save (namespaced under the owner)", () => {
    const { routineSave, apply, sessionManager } = setup();
    apply("demo-plugin", { demoKey: "x" });
    sessionManager.update("s1", { status: "idle", tokensIn: 5 });
    routineSave();
    const meta = readSessionMeta(sessionFile) as Record<string, unknown>;
    expect(meta.pluginRefs).toEqual({ "demo-plugin": { demoKey: "x" } });
  });

  it("2+3. restart restores the key onto the session (no live keeper needed)", () => {
    const { routineSave, apply, restart } = setup();
    apply("demo-plugin", { demoKey: "x" });
    routineSave();
    const { mgr2 } = restart();
    const s = mgr2.get("s1") as unknown as Record<string, unknown>;
    expect(s.demoKey).toBe("x");
    expect(s.pluginRefs).toEqual({ "demo-plugin": { demoKey: "x" } });
  });

  it("4. undefined clears the key from memory and from disk on the next save", () => {
    const { routineSave, apply, sessionManager } = setup();
    apply("demo-plugin", { demoKey: "x", keep: 1 });
    routineSave();
    apply("demo-plugin", { demoKey: undefined });
    routineSave();
    expect((sessionManager.get("s1") as unknown as Record<string, unknown>).demoKey).toBeUndefined();
    expect((readSessionMeta(sessionFile) as Record<string, unknown>).pluginRefs).toEqual({ "demo-plugin": { keep: 1 } });
  });

  it("persist:false stays memory-only (not in the bag, not on disk)", () => {
    const { routineSave, apply, sessionManager } = setup();
    apply("demo-plugin", { transient: true }, false);
    routineSave();
    expect((sessionManager.get("s1") as unknown as Record<string, unknown>).transient).toBe(true);
    expect((readSessionMeta(sessionFile) as Record<string, unknown>).pluginRefs).toBeUndefined();
  });

  it("5. key ownership survives a restart (another plugin is still refused)", () => {
    const { routineSave, apply, restart } = setup();
    apply("plugin-a", { k: "a" });
    routineSave();
    const { mgr2, reg2 } = restart();
    const r = applyPluginRef({ sessionManager: mgr2, sanitize: reg2.sanitize }, "s1", "plugin-b", { k: "b" }, { persist: true });
    expect(r).toEqual({});
    expect((mgr2.get("s1") as unknown as Record<string, unknown>).k).toBe("a");
  });

  it("6. reserved keys (incl. the bag itself) are dropped, before and after a restart", () => {
    const { routineSave, apply, restart, sessionManager } = setup();
    apply("demo-plugin", { status: "hacked", pluginRefs: { x: 1 }, ok: 1 });
    expect(sessionManager.get("s1")?.status).not.toBe("hacked");
    routineSave();
    expect((readSessionMeta(sessionFile) as Record<string, unknown>).pluginRefs).toEqual({ "demo-plugin": { ok: 1 } });
    const { mgr2 } = restart();
    expect(mgr2.get("s1")?.status).not.toBe("hacked");
  });

  it("6b. a tampered sidecar cannot inject reserved keys through the bag on restore", () => {
    const { routineSave, apply } = setup();
    apply("demo-plugin", { ok: 1 });
    routineSave();
    const raw = JSON.parse(fs.readFileSync(sessionFile.replace(/\.jsonl$/, ".meta.json"), "utf8"));
    raw.pluginRefs["demo-plugin"].cwd = "/evil";
    raw.pluginRefs["demo-plugin"].sessionFile = "/evil.jsonl";
    fs.writeFileSync(sessionFile.replace(/\.jsonl$/, ".meta.json"), JSON.stringify(raw));
    const meta = readSessionMeta(sessionFile) ?? {};
    const restored = sessionFromMeta("s1", sessionFile, tmpDir, meta, Date.now());
    expect(restored.cwd).not.toBe("/evil");
    expect(restored.sessionFile).toBe(sessionFile);
  });

  it("7 (option b). a trusted plugin MAY set principalOwner; it survives a save and a restart", () => {
    const { routineSave, apply, restart } = setup();
    apply("on-behalf-plugin", { principalOwner: OWNER });
    routineSave();
    expect(readSessionMeta(sessionFile)?.principalOwner).toEqual(OWNER);
    const { mgr2, reg2 } = restart();
    expect(mgr2.get("s1")?.principalOwner).toEqual(OWNER);
    // First-writer-wins also holds for the owner key across plugins, after restart.
    const r = applyPluginRef({ sessionManager: mgr2, sanitize: reg2.sanitize }, "s1", "other-plugin", { principalOwner: { iss: "x", sub: "y" } }, { persist: true });
    expect(r).toEqual({});
    expect(mgr2.get("s1")?.principalOwner).toEqual(OWNER);
  });

  it("8. an oversized or non-serializable ref is dropped for THAT plugin only", () => {
    const { routineSave, apply, sessionManager } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    apply("good", { g: 1 });
    expect(apply("huge", { blob: "x".repeat(PLUGIN_REF_BAG_MAX_BYTES + 1) })).toEqual({});
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(apply("cyclic", { c: cyc })).toEqual({});
    expect(apply("fn", { f: () => 1 })).toEqual({});
    sessionManager.update("s1", { tokensIn: 9 });
    routineSave();
    const meta = readSessionMeta(sessionFile) as Record<string, unknown>;
    expect(meta.pluginRefs).toEqual({ good: { g: 1 } });
    expect(meta.tokensIn).toBe(9);
    warn.mockRestore();
  });

  it("a bridge reattach (re-register) keeps plugin keys + the bag in memory", () => {
    const { apply, sessionManager } = setup();
    apply("demo-plugin", { demoKey: "x" });
    sessionManager.register({ id: "s1", cwd: "/w", source: "dashboard" } as never);
    const s = sessionManager.get("s1") as unknown as Record<string, unknown>;
    expect(s.demoKey).toBe("x");
    expect(s.pluginRefs).toEqual({ "demo-plugin": { demoKey: "x" } });
  });
});
