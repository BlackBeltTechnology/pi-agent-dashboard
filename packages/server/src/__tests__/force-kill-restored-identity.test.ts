/**
 * Operator force-kill / shutdown against a RESTORED headless registry entry.
 * See change: guard-restored-headless-identity (test-plan E15 / G2, E34).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const killProcessSpy = vi.hoisted(() => vi.fn(async (_pid: number, _opts?: unknown) => ({ ok: true, forced: false })));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => ({
  ...(await orig<object>()),
  killProcess: (pid: number, opts?: unknown) => killProcessSpy(pid, opts),
}));

const { handleForceKill } = await import("../browser-handlers/session-action-handler.js");
const { createHeadlessPidRegistry } = await import("../spawn-process/headless-pid-registry.js");

const PID = 4242;
const S = Date.now() - 24 * 60 * 60 * 1000;

async function restoredRegistry(start: number | null) {
  const file = join(mkdtempSync(join(tmpdir(), "fk-ident-")), "pids.json");
  writeFileSync(file, JSON.stringify({ entries: [{ pid: PID, cwd: "/test", spawnedAt: new Date(S).toISOString(), spawnToken: "tok" }] }));
  let probeStart: number | null = S; // match at startup
  const reg = createHeadlessPidRegistry({ pidFilePath: file, probe: () => probeStart, isGone: () => false });
  await reg.cleanupOrphans();
  reg.linkByToken("tok", "sess-1");
  probeStart = start; // the pid's identity at kill time
  return reg;
}

function ctxFor(registry: unknown) {
  const sent: Array<Record<string, unknown>> = [];
  return {
    ws: {},
    sessionManager: { get: vi.fn().mockReturnValue({ id: "sess-1", cwd: "/test", status: "idle", pid: PID }), update: vi.fn() },
    piGateway: { closeSession: vi.fn().mockReturnValue(true), sendToSession: vi.fn() },
    headlessPidRegistry: registry,
    sendTo: vi.fn((_ws: unknown, msg: Record<string, unknown>) => sent.push(msg)),
    broadcast: vi.fn(),
    sent,
  } as never as Parameters<typeof handleForceKill>[1] & { sent: Array<Record<string, unknown>> };
}

describe("operator paths × restored entry identity", () => {
  let warn: MockInstance<typeof console.warn>;
  beforeEach(() => {
    killProcessSpy.mockClear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("E15: mismatch — killBySessionId returns false, force-kill refuses naming identity reuse, no signal", async () => {
    const reg = await restoredRegistry(Date.now());
    expect(await reg.killBySessionId("sess-1")).toBe(false);
    const ctx = ctxFor(reg);
    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);
    const result = ctx.sent.find((m) => m.type === "force_kill_result");
    expect(result).toMatchObject({ success: false });
    expect(String(result?.message)).toMatch(/identity reuse/i);
    expect(killProcessSpy).not.toHaveBeenCalled();
    expect((ctx as never as { piGateway: { closeSession: ReturnType<typeof vi.fn> } }).piGateway.closeSession).not.toHaveBeenCalled();
  });

  it("E34: unverifiable — force-kill signals once and logs that the identity was unverifiable", async () => {
    const reg = await restoredRegistry(null);
    const ctx = ctxFor(reg);
    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);
    expect(ctx.sent.find((m) => m.type === "force_kill_result")).toMatchObject({ success: true });
    expect(killProcessSpy.mock.calls.filter((c) => c[0] === PID).length).toBeGreaterThanOrEqual(1);
    expect(warn.mock.calls.some((c) => String(c[0]).includes(`identity unverifiable pid=${PID}`))).toBe(true);
  });
});
