/**
 * roles-plugin bridge entry: Agent-tool role guidance (test-plan #E23, #E24, #X7).
 * See change: add-plugin-bridge-contributions (D12).
 */
import { describe, expect, it } from "vitest";
import activate, { buildRoleGuideline, ROLES_GET_ALL_CHANNEL } from "../index.js";

type Opts = { selectedTools: string[]; toolGuidelines: Record<string, string[]> };

function fakePi(roles: Record<string, unknown> | "throw" | "none") {
  let beforeStart: ((event: unknown) => unknown) | undefined;
  return {
    on: (name: string, h: (event: unknown) => unknown) => {
      if (name === "before_agent_start") beforeStart = h;
    },
    events: {
      emit: (channel: string, data: Record<string, unknown>) => {
        if (channel !== ROLES_GET_ALL_CHANNEL || roles === "none") return;
        if (roles === "throw") throw new Error("listener boom");
        data.roles = roles;
      },
    },
    fire(opts: Opts) {
      return beforeStart?.({ type: "before_agent_start", prompt: "hi", systemPromptOptions: opts });
    },
  };
}

const withAgent = (): Opts => ({ selectedTools: ["read", "Agent"], toolGuidelines: {} });

describe("roles-plugin bridge entry", () => {
  it("appends one sorted bullet naming roles and models (E23)", () => {
    const pi = fakePi({ review: "openai-codex/gpt-6-sol", fast: "anthropic/claude-haiku-4-5" });
    activate(pi);
    const opts = withAgent();
    pi.fire(opts);
    expect(opts.toolGuidelines.Agent).toHaveLength(1);
    const bullet = opts.toolGuidelines.Agent[0];
    expect(bullet).toContain('model: "@<role>"');
    expect(bullet.indexOf("@fast → anthropic/claude-haiku-4-5")).toBeGreaterThan(-1);
    expect(bullet.indexOf("@fast")).toBeLessThan(bullet.indexOf("@review"));
  });

  it("lists at most 12 roles, sorted (E23)", () => {
    const roles = Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [`r${String(i).padStart(2, "0")}`, `p/m${i}`]),
    );
    const g = buildRoleGuideline(roles);
    expect(g).toBeDefined();
    expect(g!.match(/@r\d\d/g)).toEqual(Array.from({ length: 12 }, (_, i) => `@r${String(i).padStart(2, "0")}`));
  });

  it("adds nothing for empty-valued built-ins or no roles (E23)", () => {
    for (const roles of [{}, { fast: "", default: "", naming: "  " }, { bad: "not-a-ref" }]) {
      const pi = fakePi(roles);
      activate(pi);
      const opts = withAgent();
      pi.fire(opts);
      expect(opts.toolGuidelines.Agent).toBeUndefined();
    }
  });

  it("keeps a :level suffix ref and appends after existing Agent guidelines", () => {
    const pi = fakePi({ deep: "anthropic/claude-opus-5-5:high" });
    activate(pi);
    const opts: Opts = { selectedTools: ["Agent"], toolGuidelines: { Agent: ["existing"] } };
    pi.fire(opts);
    expect(opts.toolGuidelines.Agent[0]).toBe("existing");
    expect(opts.toolGuidelines.Agent[1]).toContain("@deep → anthropic/claude-opus-5-5:high");
  });

  it("does nothing without the Agent tool or without a roles listener (E24)", () => {
    const a = fakePi({ fast: "p/m" });
    activate(a);
    const noAgent: Opts = { selectedTools: ["read"], toolGuidelines: {} };
    a.fire(noAgent);
    expect(noAgent.toolGuidelines).toEqual({});

    const b = fakePi("none");
    activate(b);
    const opts = withAgent();
    b.fire(opts);
    expect(opts.toolGuidelines).toEqual({});
  });

  it("swallows a throwing roles listener (X7)", () => {
    const pi = fakePi("throw");
    activate(pi);
    const opts = withAgent();
    expect(() => pi.fire(opts)).not.toThrow();
    expect(opts.toolGuidelines).toEqual({});
  });
});
