/**
 * shutdownSession delegates ONLY the kill ladder to the shared terminator and
 * keeps everything else, in order (test-plan #E32–#E34, design D7).
 * See change: fix-session-reclaim-tmux.
 */
import { describe, expect, it, vi } from "vitest";

const killProcess = vi.fn(async (pid: number) => {
  alive.delete(pid);
  return { ok: true, forced: false };
});
const alive = new Set<number>();

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return {
    ...actual,
    signalZero: (pid: number) => (alive.has(pid) ? "alive" : "esrch"),
    killProcess: (pid: number) => killProcess(pid),
  };
});

import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { type ShutdownSessionDeps, shutdownSession } from "../session-action-handler.js";

function make(record: Record<string, unknown> | undefined, order: string[], registryPid?: number) {
  const sent: ServerToBrowserMessage[] = [];
  const deps = {
    sessionManager: {
      get: () => record,
      update: vi.fn((_id: string, u: Record<string, unknown>) => order.push(`update:${JSON.stringify(u)}`)),
      unregister: vi.fn(() => order.push("unregister")),
    },
    piGateway: { sendToSession: vi.fn((_id: string, m: { type: string }) => order.push(`send:${m.type}`)) },
    headlessPidRegistry: {
      getPid: () => registryPid,
      killBySessionId: vi.fn(async () => {
        order.push("registry");
        return false;
      }),
    },
    broadcast: (m: ServerToBrowserMessage) => {
      sent.push(m);
      order.push(`broadcast:${m.type}`);
    },
  } as unknown as ShutdownSessionDeps;
  return { deps, sent };
}

describe("shutdownSession → shared terminator", () => {
  // E32 — a tmux-style session: pid held, no registry entry.
  it("keeps stamp → hint → ladder → unregister → session_removed, with one removal", async () => {
    alive.clear();
    alive.add(4242);
    killProcess.mockClear();
    const order: string[] = [];
    const { deps, sent } = make({ id: "s1", pid: 4242 }, order);
    await shutdownSession("s1", deps);
    expect(killProcess).toHaveBeenCalledWith(4242);
    expect(order).toEqual([
      'update:{"closedReason":"manual"}',
      "send:shutdown",
      "registry",
      "unregister",
      "broadcast:session_removed",
    ]);
    expect(sent.map((m) => m.type)).toEqual(["session_removed"]);
  }, 20_000);

  // E33 — no identity at all: log-only, no orphan signal.
  it("warns 'termination NOT verified' and sends no session_orphaned when no pid is held", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const order: string[] = [];
    const { deps, sent } = make({ id: "s2" }, order);
    await shutdownSession("s2", deps);
    const text = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(text).toContain("s2");
    expect(text).toContain("termination NOT verified");
    expect(sent.some((m) => m.type === "session_orphaned")).toBe(false);
    expect(sent.filter((m) => m.type === "session_removed")).toHaveLength(1);
    warn.mockRestore();
  });

  // E34 — already exited, shut down twice: no signal, no error.
  it("signals nothing and does not error for an already-exited session shut down twice", async () => {
    alive.clear();
    killProcess.mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    const { deps, sent } = make({ id: "s3", pid: 999 }, order);
    await shutdownSession("s3", deps);
    await shutdownSession("s3", deps);
    expect(killProcess).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(sent.some((m) => m.type === "session_orphaned")).toBe(false);
    error.mockRestore();
  });
});
