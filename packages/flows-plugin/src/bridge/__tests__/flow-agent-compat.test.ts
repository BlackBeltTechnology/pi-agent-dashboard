/**
 * Flow agents receive the Claude compat rewrite through pi-flows' spawn hook
 * (`flow:register-agent-extension`), announced by the flows-plugin bridge.
 * pi-flows agents never load the settings packages, so the dashboard
 * extension's own registration does not reach them.
 *
 * See change: restore-flow-agent-claude-compat (test-plan #F1 #F2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import activate from "../index.js";

const BRIDGE_KEY = "__pi_dashboard_bridge__";
const g = process as unknown as Record<string, unknown>;

const SYSTEM = "<docs>\nPi documentation (read only when the user asks about pi itself; pi packages (docs/packages.md))\n</docs>";

type Handler = (e: unknown, c: unknown) => unknown;

function fakeParentPi() {
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const handlers = new Map<string, Handler[]>();
  return {
    emitted,
    events: {
      emit: (channel: string, data: unknown) => { emitted.push({ channel, data }); },
      on: () => {},
    },
    on: (name: string, h: Handler) => { handlers.set(name, [...(handlers.get(name) ?? []), h]); },
    fire: (name: string) => { for (const h of handlers.get(name) ?? []) h({ type: name }, {}); },
  };
}

function announcedFactories(parent: ReturnType<typeof fakeParentPi>): unknown[] {
  return parent.emitted
    .filter((e) => e.channel === "flow:register-agent-extension")
    .map((e) => (e.data as { factory: unknown }).factory);
}

let prevState: unknown;
beforeEach(() => {
  prevState = g[BRIDGE_KEY];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  if (prevState === undefined) delete g[BRIDGE_KEY];
  else g[BRIDGE_KEY] = prevState;
  vi.restoreAllMocks();
});

describe("flow agent compat via pi-flows spawn hook", () => {
  it.each([
    [true, "anthropic", true],
    [true, "openai", false],
    [false, "anthropic", false],
    [undefined, "anthropic", false],
  ] as const)("F1: switch=%s provider=%s → rewritten=%s; agent bus untouched", (sw, provider, rewritten) => {
    if (sw === undefined) delete g[BRIDGE_KEY];
    else g[BRIDGE_KEY] = { claudeSubscriptionCompat: sw };
    const parent = fakeParentPi();
    activate(parent);
    const [factory] = announcedFactories(parent);
    expect(typeof factory).toBe("function");

    const agentEmit = vi.fn();
    let send: Handler | undefined;
    const agentPi = {
      events: { emit: agentEmit, on: () => {} },
      on: (name: string, h: Handler) => { if (name === "before_provider_request") send = h; },
    };
    (factory as (pi: unknown) => void)(agentPi);
    const out = send?.({ type: "before_provider_request", payload: { system: SYSTEM, messages: [] } }, { model: { provider } }) as
      | { system: string }
      | undefined;
    if (rewritten) {
      expect(out?.system).toContain("the cli itself");
      expect(out?.system).not.toContain("pi packages");
    } else {
      expect(out).toBeUndefined();
    }
    expect(agentEmit).not.toHaveBeenCalled();
  });

  it("F2: announces the same factory on activate and on every session_start", () => {
    const parent = fakeParentPi();
    activate(parent);
    parent.fire("session_start");
    parent.fire("session_start");
    parent.fire("session_start");
    const factories = announcedFactories(parent);
    expect(factories).toHaveLength(4);
    expect(new Set(factories).size).toBe(1);
  });
});
