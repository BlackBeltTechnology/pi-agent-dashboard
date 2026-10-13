/**
 * `driver` / `acpAgentId` survive meta save → restart. See change:
 * add-acp-session-driver (test-plan #E42, D12).
 */
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { sessionFromMeta } from "../session/session-scanner.js";
import { sessionToMeta } from "../session/session-to-meta.js";

const base = (over: Partial<DashboardSession>): DashboardSession =>
  ({ id: "s1", cwd: "/w", status: "ended", source: "dashboard", startedAt: 1, ...over }) as DashboardSession;

describe("driver persistence (E42)", () => {
  it("an ACP session round-trips driver + acpAgentId through the sidecar", () => {
    const sessionFile = path.join(mkdtempSync(path.join(os.tmpdir(), "drv-")), "s1.jsonl");
    writeSessionMeta(sessionFile, sessionToMeta(base({ driver: "acp", acpAgentId: "qmt" })));
    const meta = readSessionMeta(sessionFile);
    expect(meta).toMatchObject({ driver: "acp", acpAgentId: "qmt" });
    const restored = sessionFromMeta("s1", sessionFile, path.dirname(sessionFile), meta as never, 1);
    expect(restored).toMatchObject({ driver: "acp", acpAgentId: "qmt" });
  });

  it("a pi session carries no driver key at all", () => {
    expect(JSON.parse(JSON.stringify(sessionToMeta(base({}))))).not.toHaveProperty("driver");
    expect(JSON.parse(JSON.stringify(sessionToMeta(base({}))))).not.toHaveProperty("acpAgentId");
  });

  it("register: driver acp is stored; a pi register without driver stays absent; a re-register never downgrades", () => {
    const sm = createMemorySessionManager();
    sm.register({ id: "a", cwd: "/w", source: "dashboard", driver: "acp", acpAgentId: "qmt" } as never);
    expect(sm.get("a")).toMatchObject({ driver: "acp", acpAgentId: "qmt" });
    sm.register({ id: "a", cwd: "/w", source: "dashboard", registerReason: "reattach" } as never);
    expect(sm.get("a")).toMatchObject({ driver: "acp", acpAgentId: "qmt" });
    sm.register({ id: "p", cwd: "/w", source: "tui" } as never);
    expect(sm.get("p")?.driver).toBeUndefined();
  });
});
