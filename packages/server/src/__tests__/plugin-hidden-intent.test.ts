/**
 * A plugin-declared hide (`lifecycle.hidden`) must SURVIVE a dashboard restart.
 *
 * Observed on a live Discord gateway session: after `/api/restart` the session
 * re-registers with `registerReason:"spawn"` (no spawn token, dashboardSpawned,
 * hasUI undefined). A non-reattach register re-decides `hidden` from the
 * headless heuristic → false, and the next sidecar save wrote `hidden:false`.
 * The fix persists a core-owned intent `pluginHidden` (like `recover`) that the
 * register decision honours on every non-reattach re-register.
 * See change: fix-plugin-hidden-across-restart.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { sessionFromMeta } from "../session/session-scanner.js";
import { sessionToMeta } from "../session/session-to-meta.js";

const restored = (over: Partial<DashboardSession>): DashboardSession =>
  ({ id: "s1", cwd: "/w", source: "dashboard", status: "ended", startedAt: 1, ...over }) as DashboardSession;

const respawnRegister = { id: "s1", cwd: "/w", source: "dashboard", registerReason: "spawn", dashboardSpawned: true } as const;

describe("plugin-declared hidden survives a restart re-register", () => {
  it("a respawn re-register keeps a pluginHidden session hidden (and carries the intent)", () => {
    const m = createMemorySessionManager();
    m.restore(restored({ hidden: true, pluginHidden: true }));
    m.register({ ...respawnRegister });
    expect(m.get("s1")?.hidden).toBe(true);
    expect(m.get("s1")?.pluginHidden).toBe(true);
  });

  it("without the intent the existing heuristic is unchanged (dashboard spawn → visible)", () => {
    const m = createMemorySessionManager();
    m.restore(restored({ hidden: true }));
    m.register({ ...respawnRegister });
    expect(m.get("s1")?.hidden).toBe(false);
  });

  it("an explicit visible intent still wins over pluginHidden", () => {
    const m = createMemorySessionManager();
    m.restore(restored({ hidden: true, pluginHidden: true }));
    m.register({ ...respawnRegister, visibilityIntent: "visible" });
    expect(m.get("s1")?.hidden).toBe(false);
  });

  it("pluginHidden round-trips through .meta.json; a user session carries no key", () => {
    const meta = sessionToMeta(restored({ hidden: true, pluginHidden: true }));
    expect(meta.pluginHidden).toBe(true);
    expect(sessionFromMeta("s1", "/w/s1.jsonl", "/w", { ...meta, cwd: "/w" }, 1).pluginHidden).toBe(true);
    expect(JSON.stringify(sessionToMeta(restored({})))).not.toContain("pluginHidden");
  });

  it("event-wiring records the intent when it applies lifecycle.hidden", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.resolve(here, "..", "event-wiring.ts"), "utf8");
    expect(src).toMatch(/sessionManager\.update\(sessionId, \{ hidden: true, pluginHidden: true \}\)/);
  });
});
