/**
 * Every path that would start pi for an existing ACP session is refused with
 * `unsupported_for_acp` BEFORE any side effect. See change: add-acp-session-driver
 * (test-plan #E55, #E56).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../spawn-process/process-manager.js", () => ({ spawnPiSession: vi.fn() }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@blackbelt-technology/pi-dashboard-shared/config.js")>()),
  loadConfig: () => ({ spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30_000, acpAgents: [] }),
}));

import { handleHeadlessReload, handleResumeSession, handleSendPrompt } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

function makeCtx(sessions: Record<string, any>) {
  const events: Array<{ eventType: string; data: any }> = [];
  const sent: any[] = [];
  const spies = {
    killBySessionId: vi.fn(),
    sessionUpdate: vi.fn(),
    pendingResumeRecord: vi.fn(),
    intentRecord: vi.fn(),
    sendToSession: vi.fn().mockReturnValue(true),
  };
  const ctx = {
    ws: {},
    sessionManager: { get: (id: string) => sessions[id], update: spies.sessionUpdate, unregister: vi.fn() },
    piGateway: { sendToSession: spies.sendToSession, isSessionConnected: () => true },
    headlessPidRegistry: { getPid: () => undefined, killBySessionId: spies.killBySessionId, register: vi.fn(), listSessions: () => [] },
    pendingResumeRegistry: { record: spies.pendingResumeRecord, consume: vi.fn() },
    pendingResumeIntents: { record: spies.intentRecord },
    pendingDashboardSpawns: new Map(),
    pendingForkRegistry: { record: vi.fn() },
    pendingClientCorrelations: undefined,
    pendingArchiveIntents: undefined,
    eventStore: { insertEvent: (_id: string, event: any) => (events.push(event), events.length) },
    broadcast: vi.fn(),
    sendTo: (_ws: unknown, m: unknown) => sent.push(m),
  } as any;
  return { ctx, events, sent, spies };
}

const acp = (status: "ended" | "active") => ({ id: "S", cwd: "/w", status, driver: "acp", acpAgentId: "qmt", sessionFile: "/x/S.jsonl", source: "dashboard" });

beforeEach(() => vi.clearAllMocks());

describe("continue-session guards (E55)", () => {
  it("reload of a running ACP session: refused, nothing killed or spawned", async () => {
    const { ctx, events, spies } = makeCtx({ S: acp("active") });
    await handleHeadlessReload({ type: "send_prompt", sessionId: "S", text: "/reload" } as never, ctx);
    expect(events.at(-1)?.data).toMatchObject({ status: "error", message: expect.stringContaining("unsupported_for_acp") });
    expect(spies.killBySessionId).not.toHaveBeenCalled();
    expect(spawnPiSession).not.toHaveBeenCalled();
  });

  it("bare /reload typed into an ACP session: refused, not forwarded", async () => {
    const { ctx, events, spies } = makeCtx({ S: acp("active") });
    await handleSendPrompt({ type: "send_prompt", sessionId: "S", text: "/reload" } as never, ctx);
    expect(events.at(-1)?.data.message).toContain("unsupported_for_acp");
    expect(spies.sendToSession).not.toHaveBeenCalled();
  });

  it("prompt to an ENDED ACP session: refused with a start-a-new-session hint; no resume side effects", async () => {
    const { ctx, events, spies } = makeCtx({ S: acp("ended") });
    await handleSendPrompt({ type: "send_prompt", sessionId: "S", text: "hello" } as never, ctx);
    const msg = events.at(-1)?.data.message as string;
    expect(msg).toContain("start a new session");
    expect(msg).toContain("qmt");
    expect(spawnPiSession).not.toHaveBeenCalled();
    expect(spies.sessionUpdate).not.toHaveBeenCalled(); // no `resuming` flag
    expect(spies.pendingResumeRecord).not.toHaveBeenCalled();
    expect(spies.intentRecord).not.toHaveBeenCalled();
  });

  it("slash text to a running ACP session is plain prompt text (not dispatched, not refused)", async () => {
    const { ctx, spies } = makeCtx({ S: acp("active") });
    await handleSendPrompt({ type: "send_prompt", sessionId: "S", text: "/review" } as never, ctx);
    expect(spies.sendToSession).toHaveBeenCalledWith("S", expect.objectContaining({ type: "send_prompt", text: "/review" }));
  });

  it("resume / fork over WS: typed refusal, no spawn, no resuming flag, no intent", async () => {
    for (const mode of ["continue", "fork"] as const) {
      const { ctx, sent, spies } = makeCtx({ S: acp("ended") });
      await handleResumeSession({ type: "resume_session", sessionId: "S", mode, requestId: "r" } as never, ctx);
      expect(sent.at(-1)).toMatchObject({ type: "resume_result", success: false, code: "unsupported_for_acp", requestId: "r" });
      expect(spawnPiSession).not.toHaveBeenCalled();
      expect(spies.sessionUpdate).not.toHaveBeenCalled();
      expect(spies.intentRecord).not.toHaveBeenCalled();
    }
  });

  it("the same ops on a pi session are unchanged (prompt forwards to the bridge)", async () => {
    const { ctx, spies } = makeCtx({ S: { id: "S", cwd: "/w", status: "active", sessionFile: "/x/S.jsonl", source: "dashboard" } });
    await handleSendPrompt({ type: "send_prompt", sessionId: "S", text: "hello" } as never, ctx);
    expect(spies.sendToSession).toHaveBeenCalledWith("S", expect.objectContaining({ text: "hello" }));
  });
});

describe("boot recovery skips ACP (E56)", () => {
  it("scanAcpSessions restores ended ACP sessions with driver and never marks them recoverable", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { scanAcpSessions } = await import("../acp-bridge/acp-restore.js");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-restore-"));
    const id = "11111111-2222-4333-8444-555555555555";
    fs.writeFileSync(path.join(dir, `${id}.meta.json`), JSON.stringify({ driver: "acp", acpAgentId: "qmt", cwd: "/w", status: "active", live: true, source: "dashboard", name: "N" }));
    fs.writeFileSync(path.join(dir, "22222222-2222-4333-8444-555555555555.meta.json"), JSON.stringify({ cwd: "/w", status: "ended" })); // a non-ACP sidecar is ignored
    fs.writeFileSync(path.join(dir, "not-a-uuid.meta.json"), JSON.stringify({ driver: "acp", cwd: "/w" }));
    const found = scanAcpSessions(dir);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id, driver: "acp", acpAgentId: "qmt", status: "ended", name: "N" });
    expect(found[0]?.live).not.toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
