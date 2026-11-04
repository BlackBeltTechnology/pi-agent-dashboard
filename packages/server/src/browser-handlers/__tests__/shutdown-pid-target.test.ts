/**
 * Shutdown is an operator path: it passes `operator: true`, and a `not-local`
 * result is an UNCONFIRMED termination — `session_orphaned` alongside
 * `session_removed`, a log line, no signal. Both entry points (browser
 * `shutdown`, `POST /api/session/:id/shutdown`) share `shutdownSession`.
 * Test-plan rows X20–X24. See change: scope-pids-to-namespace.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const killProcess = vi.fn(async (_pid: number) => ({ ok: true, forced: false }));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, signalZero: () => "alive", killProcess: (pid: number) => killProcess(pid) };
});

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { Terminate } from "../../spawn-process/session-terminator.js";
import { type ShutdownSessionDeps, shutdownSession } from "../session-action-handler.js";

function make(record: Record<string, unknown> | undefined, terminate?: Terminate) {
  const sent: ServerToBrowserMessage[] = [];
  const deps = {
    sessionManager: { get: () => record, update: vi.fn(), unregister: vi.fn() },
    piGateway: { sendToSession: vi.fn() },
    headlessPidRegistry: { getPid: () => undefined, killBySessionId: vi.fn(async () => false) },
    broadcast: (m: ServerToBrowserMessage) => sent.push(m),
    ...(terminate ? { terminate } : {}),
  } as unknown as ShutdownSessionDeps;
  return { deps, sent };
}

/**
 * @structural-pin X24 pins that the REST shutdown route delegates to the same shutdownSession body; the route needs a full server to drive
 */
describe("shutdown — pid target", () => {
  it("X20: a remote-origin session is an unconfirmed termination, never signalled", async () => {
    killProcess.mockClear();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, sent } = make({ id: "s1", pid: 4242, originDeviceId: "dev-remote-1" });
    await shutdownSession("s1", deps);
    expect(killProcess).not.toHaveBeenCalled();
    expect(sent).toEqual([
      { type: "session_orphaned", sessionId: "s1", pid: 4242 },
      { type: "session_removed", sessionId: "s1" },
    ]);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/not on this host/);
    err.mockRestore();
  });

  it("X21: shutdown passes operator:true to the terminator", async () => {
    const terminate = vi.fn<Terminate>(async () => ({ outcome: "confirmed-dead", terminated: true, pid: 1 }));
    await shutdownSession("s1", make({ id: "s1", pid: 1 }, terminate).deps);
    expect(terminate).toHaveBeenCalledWith("s1", expect.objectContaining({ operator: true }));
  });

  it("X22: a host target confirmed dead — no orphan signal", async () => {
    const terminate = vi.fn<Terminate>(async () => ({ outcome: "confirmed-dead", terminated: true, pid: 4242 }));
    const { deps, sent } = make({ id: "s1", pid: 4242 }, terminate);
    await shutdownSession("s1", deps);
    expect(sent.map((m) => m.type)).toEqual(["session_removed"]);
  });

  it("X23: unknown on win32 — the terminator signals, confirmed ⇒ no orphan", async () => {
    // The Q8 signal decision itself is the terminator's (session-terminator-pid-target X9);
    // here: the handler forwards to it and reports a confirmed death cleanly.
    const terminate = vi.fn<Terminate>(async () => ({ outcome: "confirmed-dead", terminated: true, pid: 4242 }));
    const { deps, sent } = make({ id: "s1", pid: 4242, cwd: "C:\\p" }, terminate);
    await shutdownSession("s1", deps);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(sent.some((m) => m.type === "session_orphaned")).toBe(false);
  });

  it("X24: the REST shutdown route shares the same body", () => {
    const api = readFileSync(join(__dirname, "..", "..", "session", "session-api.ts"), "utf8");
    expect(api).toMatch(/browserGateway\.shutdownSession\(id\)/);
    const gw = readFileSync(join(__dirname, "..", "..", "pairing", "browser-gateway.ts"), "utf8");
    expect(gw).toMatch(/shutdownSession\(sessionId: string\) \{\s*return shutdownSessionImpl\(/);
  });
});
