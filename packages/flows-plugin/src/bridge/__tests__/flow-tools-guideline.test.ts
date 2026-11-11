/**
 * flows-plugin `flow_write` guideline for the flow-tools facade.
 * test-plan #E17, #E18, #E19, #X5. See change: add-flow-code-node-tools (D5).
 */
import { describe, expect, it } from "vitest";
import { FLOW_TOOLS_GUIDELINE, FLOW_WRITE_TOOL, startFlowToolsGuideline } from "../flow-tools-guideline.js";

type Opts = { selectedTools: string[]; toolGuidelines: Record<string, string[]> };

function fakePi() {
  const handlers: Array<(e: unknown) => unknown> = [];
  return {
    on: (name: string, h: (e: unknown) => unknown) => {
      if (name === "before_agent_start") handlers.push(h);
    },
    fire: (event: unknown) => {
      for (const h of handlers) h(event);
    },
  };
}
const ev = (systemPromptOptions: unknown) => ({ type: "before_agent_start", prompt: "hi", systemPromptOptions });

describe("flow_write facade guideline", () => {
  it("E17: added exactly once when flow_write is selected, with the guard snippet", () => {
    const pi = fakePi();
    startFlowToolsGuideline(pi);
    const opts: Opts = { selectedTools: ["read", FLOW_WRITE_TOOL], toolGuidelines: {} };
    pi.fire(ev(opts));
    pi.fire(ev(opts));
    expect(opts.toolGuidelines.flow_write).toHaveLength(1);
    const g = opts.toolGuidelines.flow_write[0];
    expect(g).toContain('Symbol.for("pi-dashboard.flow-tools")');
    expect(g).toContain("if (tools)");
  });

  it("E18: nothing added when flow_write is not selected", () => {
    const pi = fakePi();
    startFlowToolsGuideline(pi);
    const opts: Opts = { selectedTools: ["read", "bash"], toolGuidelines: { bash: ["keep"] } };
    pi.fire(ev(opts));
    expect(opts.toolGuidelines).toEqual({ bash: ["keep"] });
  });

  it("E19: appends after existing flow_write guidelines", () => {
    const pi = fakePi();
    startFlowToolsGuideline(pi);
    const opts: Opts = { selectedTools: [FLOW_WRITE_TOOL], toolGuidelines: { flow_write: ["existing"] } };
    pi.fire(ev(opts));
    expect(opts.toolGuidelines.flow_write).toEqual(["existing", FLOW_TOOLS_GUIDELINE]);
  });

  it("X5: malformed or frozen prompt options never throw", () => {
    const pi = fakePi();
    startFlowToolsGuideline(pi);
    expect(() => pi.fire(ev(undefined))).not.toThrow();
    expect(() => pi.fire({})).not.toThrow();
    const frozen = { selectedTools: [FLOW_WRITE_TOOL], toolGuidelines: Object.freeze({}) };
    expect(() => pi.fire(ev(frozen))).not.toThrow();
  });
});
