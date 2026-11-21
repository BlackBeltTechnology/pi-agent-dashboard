/**
 * Subagent re-entry guard (test-plan X4): a second `pi` instance loading the extension in the
 * same process (a subagent) must NOT bump the generation or register listeners.
 *
 * Imports the real entry point (`bridge.ts`): the guard lives in `initBridge`, which this change
 * did not move. `shouldActivateBridge` is forced on and the process-global state pre-seeded.
 *
 * See change: test-trust-audit (design D2: the guard stays in the entry point).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real bridge builds its `ConnectionManager` in `initBridge`; swap it for a recording fake so no
// socket opens and the `session_register` frames the bridge sends are observable (E6).
const fakeConnections = vi.hoisted(() => ({ instances: [] as Array<{ sent: Array<Record<string, unknown>> }> }));
vi.mock("../connection.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../connection.js")>();
  class FakeConnectionManager {
    sent: Array<Record<string, unknown>> = [];
    constructor() {
      fakeConnections.instances.push(this);
      // Every other member the bridge touches is an inert stub.
      return new Proxy(this, {
        get: (t, prop) => (prop in t ? (t as never)[prop] : prop === "isConnected" ? false : vi.fn()),
      });
    }
    send(m: Record<string, unknown>) {
      this.sent.push(m);
    }
  }
  return { ...actual, ConnectionManager: FakeConnectionManager };
});

const BRIDGE_KEY = "__pi_dashboard_bridge__";
const g = process as unknown as Record<string, unknown>;

/** A `pi` whose every method is a recording stub; `on` calls are inspectable. */
function recordingPi() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const handlers = new Map<string, (e: unknown, c: unknown) => unknown>();
  const pi = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === "events") return { on: vi.fn(), emit: vi.fn() };
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        if (prop === "on") handlers.set(String(args[0]), args[1] as (e: unknown, c: unknown) => unknown);
      };
    },
  });
  return { pi, calls, handlers };
}

describe("X4: subagent re-entry guard is unchanged", () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.PI_DASHBOARD_BRIDGE;
    process.env.PI_DASHBOARD_BRIDGE = "on";
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.PI_DASHBOARD_BRIDGE;
    else process.env.PI_DASHBOARD_BRIDGE = prevEnv;
    delete g[BRIDGE_KEY];
  });

  it("a different pi under an active bridge leaves the generation alone and registers no bridge handler", async () => {
    const owner = recordingPi();
    const intruder = recordingPi();
    g[BRIDGE_KEY] = { generation: 1, pi: owner.pi };
    const { default: bridge } = await import("../bridge.js");
    bridge(intruder.pi as never);
    expect((g[BRIDGE_KEY] as { generation: number }).generation).toBe(1);
    expect((g[BRIDGE_KEY] as { pi: unknown }).pi).toBe(owner.pi);
    // `activateProviderRegister` / `activateRoleManager` run BEFORE initBridge and legitimately
    // register on any pi; everything initBridge registers (commands, turn/shutdown handlers,
    // the dashboard forwarders) must be absent.
    const bridgeRegistrations = intruder.calls.filter(
      (c) =>
        (c.method === "registerCommand" && String(c.args[0]).startsWith("dashboard-")) ||
        (c.method === "on" && ["turn_end", "session_shutdown", "agent_start", "tool_call"].includes(String(c.args[0]))),
    );
    expect(bridgeRegistrations).toEqual([]);
  });
});

// #1175 / test-plan #E6: when pi replaces the session (new / resume / fork) it loads a FRESH
// `ExtensionAPI` into the same process. The shutdown of the outgoing owner must release the guard so
// the replacement initialises and registers the NEW session. The existing bridge-resume-disconnect
// suite reuses one `pi` object and so cannot see this.
describe("E6: a distinct pi loaded after session_shutdown{new|resume|fork} re-initialises", () => {
  let prevEnv: string | undefined;

  beforeEach(() => {
    prevEnv = process.env.PI_DASHBOARD_BRIDGE;
    process.env.PI_DASHBOARD_BRIDGE = "on";
    fakeConnections.instances.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.PI_DASHBOARD_BRIDGE;
    else process.env.PI_DASHBOARD_BRIDGE = prevEnv;
    delete g[BRIDGE_KEY];
    vi.restoreAllMocks();
  });

  function makeCtx(sessionId: string) {
    return {
      cwd: process.cwd(),
      hasUI: false,
      model: { provider: "anthropic", id: "claude-sonnet-4-6" },
      sessionManager: {
        getSessionId: () => sessionId,
        getSessionFile: () => undefined,
        getSessionDir: () => undefined,
        getCwd: () => process.cwd(),
        getBranch: () => [],
        getEntries: () => [],
      },
      ui: {},
    };
  }

  for (const reason of ["new", "resume", "fork"] as const) {
    it(`${reason}: generation bumps, handlers land on pi2, session_register carries the new session id`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      const pi1 = recordingPi();
      const pi2 = recordingPi();
      const { default: bridge } = await import("../bridge.js");

      // Owner pi1 is live, then pi shuts it down for a session replacement.
      bridge(pi1.pi as never);
      const state = g[BRIDGE_KEY] as { generation: number; pi: unknown };
      expect(state.pi).toBe(pi1.pi);
      expect(state.generation).toBe(1);
      await pi1.handlers.get("session_shutdown")?.({ type: "session_shutdown", reason }, makeCtx("old-session"));
      expect(state.pi).toBeUndefined();

      // pi then loads a DISTINCT ExtensionAPI for the replacement session.
      bridge(pi2.pi as never);
      expect(state.generation).toBe(2);
      expect(state.pi).toBe(pi2.pi);
      expect(pi2.handlers.has("session_start")).toBe(true);
      expect(pi2.handlers.has("session_shutdown")).toBe(true);

      await pi2.handlers.get("session_start")?.({ type: "session_start", reason }, makeCtx("new-session"));
      const conn = fakeConnections.instances[fakeConnections.instances.length - 1];
      const registers = conn.sent.filter((m) => m.type === "session_register");
      expect(registers.map((m) => m.sessionId)).toContain("new-session");
    });
  }
});

// The dashboard extension registers the Claude subscription compat rewrite on
// EVERY pi it loads into — a subagent child included, even though initBridge
// returns early there — reading the value the parent mirrors process-globally.
// See change: seed-claude-compat-on-upgrade (test-plan #P3).
describe("P3: subagent child gets the compat rewrite from the extension", () => {
  let prevEnv: string | undefined;
  beforeEach(() => {
    prevEnv = process.env.PI_DASHBOARD_BRIDGE;
    process.env.PI_DASHBOARD_BRIDGE = "on";
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.PI_DASHBOARD_BRIDGE;
    else process.env.PI_DASHBOARD_BRIDGE = prevEnv;
    delete g[BRIDGE_KEY];
  });

  function childPi() {
    const handlers = new Map<string, (e: unknown, c: unknown) => unknown>();
    const pi = new Proxy({} as Record<string, unknown>, {
      get(_t, prop: string) {
        if (prop === "events") return { on: vi.fn(), emit: vi.fn() };
        if (prop === "on") return (name: string, h: (e: unknown, c: unknown) => unknown) => handlers.set(name, h);
        return () => undefined;
      },
    });
    const send = (): unknown =>
      handlers.get("before_provider_request")?.(
        { type: "before_provider_request", payload: { system: "<docs>\nPi documentation (about pi itself and pi packages)\n</docs>" } },
        { model: { provider: "anthropic" } },
      );
    return { pi, send };
  }

  it("rewrites while the process-global switch is on, and follows later changes", async () => {
    const state: Record<string, unknown> = { generation: 1, pi: recordingPi().pi, claudeSubscriptionCompat: true };
    g[BRIDGE_KEY] = state;
    const child = childPi();
    const { default: bridge } = await import("../bridge.js");
    bridge(child.pi as never);
    expect((child.send() as { system: string }).system).toContain("the cli itself");
    state.claudeSubscriptionCompat = false;
    expect(child.send()).toBeUndefined();
  });

  it("parent never received a value → off", async () => {
    g[BRIDGE_KEY] = { generation: 1, pi: recordingPi().pi };
    const child = childPi();
    const { default: bridge } = await import("../bridge.js");
    bridge(child.pi as never);
    expect(child.send()).toBeUndefined();
  });
});
