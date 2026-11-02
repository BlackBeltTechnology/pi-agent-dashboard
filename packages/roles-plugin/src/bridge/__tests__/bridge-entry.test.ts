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
    /** pi >= 1.2.0 custom-message run (the dashboard Retry turn): no `prompt`, no `images`. */
    fireCustom(opts: Opts) {
      return beforeStart?.({
        type: "before_agent_start",
        messageType: "custom",
        message: { role: "custom", customType: "pi-dashboard:retry", content: "", display: false },
        systemPrompt: "body",
        systemPromptOptions: opts,
      });
    },
  };
}

const withAgent = (): Opts => ({ selectedTools: ["read", "Agent"], toolGuidelines: {} });

describe("roles-plugin bridge entry", () => {
  it("appends one pointer bullet to list_roles, listing no roles (E23)", () => {
    const pi = fakePi({ review: "openai-codex/gpt-6-sol", fast: "anthropic/claude-haiku-4-5" });
    activate(pi);
    const opts = withAgent();
    pi.fire(opts);
    expect(opts.toolGuidelines.Agent).toHaveLength(1);
    const bullet = opts.toolGuidelines.Agent[0];
    expect(bullet).toContain('model: "@<role>"');
    expect(bullet).toContain("list_roles");
    expect(bullet).not.toMatch(/@fast|@review|anthropic\/|openai-codex\//);
  });

  // test-plan #E21 — the handler reads only `systemPromptOptions`.
  // See change: update-pi-core-1-3-adopt-apis (design D2).
  it("E21 a custom-message start without `prompt` neither throws nor skips the guideline", () => {
    const pi = fakePi({ fast: "anthropic/claude-haiku-4-5" });
    activate(pi);
    const opts = withAgent();
    expect(() => pi.fireCustom(opts)).not.toThrow();
    expect(opts.toolGuidelines.Agent).toHaveLength(1);
    expect(opts.toolGuidelines.Agent[0]).toContain("list_roles");
  });

  it("never truncates: 14 roles yield the same pointer text as 1", () => {
    const roles = Object.fromEntries(
      Array.from({ length: 14 }, (_, i) => [`r${String(i).padStart(2, "0")}`, `p/m${i}`]),
    );
    expect(buildRoleGuideline(roles)).toBe(buildRoleGuideline({ fast: "p/m" }));
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

  it("accepts a :level suffix ref and appends after existing Agent guidelines", () => {
    const pi = fakePi({ deep: "anthropic/claude-opus-5-5:high" });
    activate(pi);
    const opts: Opts = { selectedTools: ["Agent"], toolGuidelines: { Agent: ["existing"] } };
    pi.fire(opts);
    expect(opts.toolGuidelines.Agent[0]).toBe("existing");
    expect(opts.toolGuidelines.Agent[1]).toContain("list_roles");
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
