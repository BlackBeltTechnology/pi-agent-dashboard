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

const BRIDGE_KEY = "__pi_dashboard_bridge__";
const g = process as unknown as Record<string, unknown>;

/** A `pi` whose every method is a recording stub; `on` calls are inspectable. */
function recordingPi() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const pi = new Proxy({} as Record<string, unknown>, {
    get(_t, prop: string) {
      if (prop === "events") return { on: vi.fn(), emit: vi.fn() };
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
      };
    },
  });
  return { pi, calls };
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
