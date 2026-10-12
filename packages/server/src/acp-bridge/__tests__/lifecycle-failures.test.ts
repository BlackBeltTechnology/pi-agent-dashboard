/**
 * Startup / runtime failure surfacing. See change: add-acp-session-driver
 * (test-plan #X1–#X4).
 */
import { describe, expect, it } from "vitest";
import { makeHarness, startReady } from "./adapter-harness.js";

const endMessage = (h: ReturnType<typeof makeHarness>) =>
  JSON.stringify(h.events().find((e) => e.eventType === "agent_end")?.data ?? {});

describe("startup failures", () => {
  it("X1: init timeout → error in session, diagnostic, agent killed, non-zero exit", async () => {
    const h = makeHarness({ knobs: { withhold: ["initialize"] }, settings: { spawnTimeoutMs: 250 } });
    const t0 = Date.now();
    await h.adapter.start();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);
    expect(endMessage(h)).toContain("timeout");
    expect(h.of("bridge_diagnostic").some((d) => d.event === "acp" && d.detail.includes("timeout"))).toBe(true);
    expect(h.handle.killed).toContain("SIGTERM");
    await h.waitFor(() => h.exits.length === 1);
    expect(h.exits[0]).not.toBe(0);
    expect(h.sent.at(-1)).toMatchObject({ type: "session_unregister" });
  });

  it("X2: initialize error / session/new auth error → session error with cause, exit ≠ 0, agent not left running", async () => {
    for (const failing of ["initialize", "session/new"]) {
      const h = makeHarness({ silent: true });
      h.handle.stdin.on("data", (c: Buffer) => {
        for (const line of c.toString("utf8").split("\n").filter(Boolean)) {
          const msg = JSON.parse(line);
          const reply =
            msg.method === failing
              ? { error: { code: -32000, message: "auth required" } }
              : { result: msg.method === "initialize" ? { protocolVersion: 1 } : { sessionId: "s" } };
          h.agentOut.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, ...reply })}\n`);
        }
      });
      await h.adapter.start();
      expect(endMessage(h), failing).toContain("auth required");
      await h.waitFor(() => h.exits.length === 1);
      expect(h.exits[0]).not.toBe(0);
      expect(h.handle.killed.length).toBeGreaterThan(0);
    }
  });

  it("X3: agent binary missing → ENOENT cause in the session, exit ≠ 0", async () => {
    const h = makeHarness({ silent: true, launchThrows: Object.assign(new Error("spawn /nope/qmt ENOENT"), { code: "ENOENT" }) });
    await h.adapter.start();
    expect(endMessage(h)).toContain("ENOENT");
    await h.waitFor(() => h.exits.length === 1);
    expect(h.exits[0]).not.toBe(0);
  });

  it("an 'error' event from the child (async ENOENT) fails the session", async () => {
    const h = makeHarness({ silent: true, settings: { spawnTimeoutMs: 5000 } });
    const started = h.adapter.start();
    h.handle.emit("error", new Error("spawn qmtcode ENOENT"));
    await started;
    expect(endMessage(h)).toContain("ENOENT");
    expect(h.exits[0]).toBe(1);
  });
});

describe("runtime failures", () => {
  it("X4: agent SIGKILLed mid-turn → error naming the signal, permission cancelled, queue cleared, unregister + exit", async () => {
    const h = makeHarness({ protocol: 1, knobs: { permission: true } });
    await startReady(h);
    h.prompt("go");
    h.prompt("queued");
    await h.waitFor(() => h.of("prompt_request").length === 1);
    h.handle.emit("exit", null, "SIGKILL");
    await h.waitFor(() => h.exits.length === 1);
    expect(endMessage(h)).toContain("SIGKILL");
    expect(h.of("prompt_cancel")).toHaveLength(1);
    expect(h.of("queue_update").at(-1)).toBeDefined();
    expect(h.sent.some((m) => m.type === "session_unregister")).toBe(true);
    expect(h.exits[0]).toBe(1);
    // finished adapters ignore later prompts
    const n = h.sent.length;
    h.prompt("after");
    expect(h.sent.length).toBe(n);
  });

  it("agent exiting by itself while idle also ends the session", async () => {
    const h = makeHarness({ protocol: 2 });
    await startReady(h);
    h.handle.emit("exit", 3, null);
    await h.waitFor(() => h.exits.length === 1);
    expect(endMessage(h)).toContain("code 3");
  });

  it("shutdown request stops cleanly (exit 0) and kills the agent", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    h.send({ type: "shutdown" } as never);
    await h.waitFor(() => h.exits.length === 1);
    expect(h.exits[0]).toBe(0);
    expect(h.handle.killed).toContain("SIGTERM");
  });

  it("register_rejected by the gateway fails the session", async () => {
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    h.send({ type: "register_rejected", reason: "duplicate" } as never);
    await h.waitFor(() => h.exits.length === 1);
    expect(h.exits[0]).toBe(1);
  });
});
