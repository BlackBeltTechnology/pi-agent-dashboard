/**
 * Idle (not-started) flow state for the attach-before-run panel.
 *
 * The idle state is built by replaying a fake `flow_started` shaped exactly like
 * pi-flows 0.5.0 `onFlowStarted` through the real reducer, so the not-started
 * graph + cards equal what a real start shows. Also pins slot resolution and the
 * attachment-consumption boundary. See change: attach-flow-before-run (D1, D3, D4).
 */

import type { DashboardEvent, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { deriveFlowEdges } from "../client/flow-edges.js";
import {
  buildIdleFlowState,
  type IdleLoad,
  isAttachmentConsumed,
  resolveFlowSlot,
} from "../client/flow-idle-state.js";
import { reduceFlowEvent } from "../reducer.js";

function ev(type: string, data: Record<string, unknown>): DashboardEvent {
  return { seq: 1, timestamp: 0, sessionId: "s1", eventType: type, data } as unknown as DashboardEvent;
}

function ready(content: string, name = "test:kinds", source = "/p/.pi/flows/flows/test/kinds/flow.yaml"): FlowState {
  const r = buildIdleFlowState(content, { name, source });
  if (r.kind !== "ready") throw new Error(`expected ready, got ${r.message}`);
  return r.flowState;
}

function edgesOf(s: FlowState) {
  return deriveFlowEdges(
    (s.dagSteps ?? []).map((d) => ({
      id: d.id,
      type: d.stepType,
      blockedBy: d.blockedBy,
      branches: d.branches,
      onComplete: d.onComplete,
      onError: d.onError,
    })),
  );
}

// Every kind declares every routing key; the 0.5.0 parser keeps only its subset.
const KINDS_YAML = `
name: kinds
description: all node kinds
steps:
  - id: a
    type: agent
    agent: alpha
    blockedBy: []
    branches: { x: b }
    on_error: fix
  - id: fk
    type: fork
    question: Which?
    options: [one, two]
    blockedBy: [a]
    on_error: fix
    branches: { one: c, two: cd }
  - id: c
    type: code
    blockedBy: [fk]
    branches: { y: a }
    on_error: fix
  - id: cd
    type: code-decision
    blockedBy: [c]
    on_error: fix
    branches: { again: a, done: ad }
  - id: ad
    type: agent-decision
    agent: judge
    task: decide
    blockedBy: [cd]
    on_error: fix
    branches: { ok: fix }
  - id: fix
    type: agent
    agent: fixer
`;

// What pi-flows 0.5.0 onFlowStarted would emit for KINDS_YAML (flow-tui.ts):
// `blockedBy: step.blockedBy || []`, `branches: step.branches`, `onError: step.on_error`
// over the per-kind parsed step.
const KINDS_STARTED_PAYLOAD = {
  flowName: "test:kinds",
  task: "",
  source: "/p/.pi/flows/flows/test/kinds/flow.yaml",
  autonomousMode: true,
  steps: [
    { id: "a", stepType: "agent", agent: "alpha", blockedBy: [], onError: "fix" },
    { id: "fk", stepType: "fork", blockedBy: [], branches: { one: "c", two: "cd" } },
    { id: "c", stepType: "code", blockedBy: ["fk"], onError: "fix" },
    { id: "cd", stepType: "code-decision", blockedBy: ["c"], branches: { again: "a", done: "ad" } },
    { id: "ad", stepType: "agent-decision", agent: "judge", blockedBy: [], branches: { ok: "fix" } },
    { id: "fix", stepType: "agent", agent: "fixer", blockedBy: [] },
  ],
};

describe("buildIdleFlowState — topology matches a real 0.5.0 start (E1)", () => {
  it("dagSteps, agents order and derived edges equal the live start", () => {
    const idle = ready(KINDS_YAML);
    const live = reduceFlowEvent(null, ev("flow_started", KINDS_STARTED_PAYLOAD))!;
    expect(idle.dagSteps).toEqual(live.dagSteps);
    expect(Array.from(idle.agents.keys())).toEqual(Array.from(live.agents.keys()));
    expect(Array.from(idle.agents.values())).toEqual(Array.from(live.agents.values()));
    expect(edgesOf(idle)).toEqual(edgesOf(live));
  });

  it("drops the per-kind fields the 0.5.0 parser drops", () => {
    const d = new Map(ready(KINDS_YAML).dagSteps!.map((s) => [s.id, s]));
    expect(d.get("a")?.branches).toBeUndefined();
    expect(d.get("c")?.branches).toBeUndefined();
    expect(d.get("fk")?.blockedBy).toEqual([]);
    expect(d.get("fk")?.onError).toBeUndefined();
    expect(d.get("ad")?.blockedBy).toEqual([]);
    expect(d.get("ad")?.onError).toBeUndefined();
    expect(d.get("cd")?.onError).toBeUndefined();
  });
});

describe("buildIdleFlowState — parser coercions (E2)", () => {
  it("wraps scalar blockedBy, stringifies branch targets, defaults blockedBy to []", () => {
    const s = ready(`
name: co
description: d
steps:
  - id: alpha
    type: agent
    agent: a
  - id: "2"
    type: agent
    agent: b
    blockedBy: alpha
  - id: dec
    type: code-decision
    branches: { go: 2 }
`);
    const d = new Map(s.dagSteps!.map((x) => [x.id, x]));
    expect(d.get("2")?.blockedBy).toEqual(["alpha"]);
    expect(d.get("dec")?.branches).toEqual({ go: "2" });
    expect(d.get("alpha")?.blockedBy).toEqual([]);
  });
});

describe("buildIdleFlowState — routing keys the engine does not emit (E3)", () => {
  it("never sets onComplete and draws no on_complete route edge", () => {
    const s = ready(`
name: oc
description: d
steps:
  - id: alpha
    type: agent
    agent: a
    on_complete: beta
  - id: beta
    type: agent
    agent: b
`);
    for (const step of s.dagSteps!) expect(step.onComplete).toBeUndefined();
    const routes = edgesOf(s).filter((e) => e.kind === "route" || e.label === "on_complete");
    expect(routes).toEqual([]);
  });
});

describe("buildIdleFlowState — definition cannot be loaded (E4)", () => {
  const head = "name: f\ndescription: d\nsteps:\n";
  const cases: Array<[string, string]> = [
    ["missing type", `${head}  - id: a\n    agent: x\n`],
    ["unknown type", `${head}  - id: a\n    type: shell\n`],
    ["missing id", `${head}  - type: agent\n    agent: x\n`],
    ["agent without agent", `${head}  - id: a\n    type: agent\n`],
    ["agent-decision without task", `${head}  - id: a\n    type: agent-decision\n    agent: j\n`],
    ["fork without question", `${head}  - id: a\n    type: fork\n    options: [x]\n`],
    ["fork without options", `${head}  - id: a\n    type: fork\n    question: q\n`],
    ["missing flow name", "description: d\nsteps:\n  - id: a\n    type: agent\n    agent: x\n"],
    ["steps not an array", "name: f\ndescription: d\nsteps: nope\n"],
  ];
  for (const [label, yaml] of cases) {
    it(`${label} → error`, () => {
      const r = buildIdleFlowState(yaml, { name: "f", source: "/x/flow.yaml" });
      expect(r.kind).toBe("error");
      if (r.kind === "error") expect(r.message.length).toBeGreaterThan(0);
      expect((r as { flowState?: unknown }).flowState).toBeUndefined();
    });
  }

  it("invalid YAML → error", () => {
    expect(buildIdleFlowState("a: [", { name: "f", source: "/x" }).kind).toBe("error");
  });
});

const SYNTHETIC_YAML = `
name: synthetic
description: Synthetic 2-agent e2e flow
task_required: false
max_concurrent: 2
steps:
  - id: alpha
    type: agent
    agent: e2e-alpha
    task: "alpha"
  - id: beta
    type: agent
    agent: e2e-beta
    blockedBy: [alpha]
    task: "beta"
`;

describe("buildIdleFlowState — nominal (E5)", () => {
  it("builds pending cards named by the FlowInfo name + source", () => {
    const source = "/x/.pi/flows/flows/e2e/synthetic/flow.yaml";
    const s = ready(SYNTHETIC_YAML, "e2e:synthetic", source);
    expect(Array.from(s.agents.keys())).toEqual(["alpha", "beta"]);
    for (const a of s.agents.values()) expect(a.status).toBe("pending");
    expect(s.agents.get("beta")?.blockedBy).toEqual(["alpha"]);
    expect(s.flowName).toBe("e2e:synthetic");
    expect(s.flowSource).toBe(source);
  });
});

describe("resolveFlowSlot — decision table (E6)", () => {
  const idleState = ready(SYNTHETIC_YAML, "A", "/a");
  const completed: FlowState = { ...ready(SYNTHETIC_YAML, "B", "/b"), status: "success" };
  const running: FlowState = ready(SYNTHETIC_YAML, "R", "/r");
  const att = { id: "t1", name: "A", source: "/a", baselineStartedAt: 100 };
  const readyLoad: IdleLoad = { kind: "ready", flowState: idleState };
  const base = {
    live: null as FlowState | null,
    liveStates: new Map<string, FlowState>() as ReadonlyMap<string, FlowState>,
    attachment: att as typeof att | null,
    idle: readyLoad,
    lastFlowStartedAt: 50 as number | undefined,
    flowsList: [{ name: "A" }] as Array<{ name: string }>,
  };

  it("running wins over an attachment and consumes it", () => {
    const r = resolveFlowSlot({ ...base, live: running, liveStates: new Map([["R", running]]) });
    expect(r.mode).toBe("live");
    expect(r.flowState).toBe(running);
    expect(r.attachmentConsumed).toBe(true);
  });

  it("running in flowStates (not the latest flowState) still wins", () => {
    const r = resolveFlowSlot({ ...base, live: completed, liveStates: new Map([["R", running], ["B", completed]]) });
    expect(r.mode).toBe("live");
    expect(r.flowState).toBe(running);
  });

  it("attached + unconsumed + ready → idle (over a completed summary)", () => {
    const r = resolveFlowSlot({ ...base, live: completed, liveStates: new Map([["B", completed]]) });
    expect(r.mode).toBe("idle");
    expect(r.flowState).toBe(idleState);
    expect(r.attachmentConsumed).toBe(false);
  });

  it("loading → loading, error → error", () => {
    expect(resolveFlowSlot({ ...base, idle: { kind: "loading" } }).mode).toBe("loading");
    const e = resolveFlowSlot({ ...base, idle: { kind: "error", message: "boom" } });
    expect(e.mode).toBe("error");
    expect(e.error).toEqual({ kind: "load", message: "boom" });
  });

  it("non-empty flowsList lacking the name → unavailable error", () => {
    const r = resolveFlowSlot({ ...base, flowsList: [{ name: "B" }] });
    expect(r.mode).toBe("error");
    expect(r.error).toEqual({ kind: "unavailable" });
  });

  it("empty flowsList → still idle", () => {
    expect(resolveFlowSlot({ ...base, flowsList: [] }).mode).toBe("idle");
  });

  it("consumed + completed → live summary", () => {
    const r = resolveFlowSlot({
      ...base,
      live: completed,
      liveStates: new Map([["B", completed]]),
      lastFlowStartedAt: 200,
    });
    expect(r.mode).toBe("live");
    expect(r.flowState).toBe(completed);
    expect(r.attachmentConsumed).toBe(true);
  });

  it("nothing → none", () => {
    expect(resolveFlowSlot({ ...base, attachment: null }).mode).toBe("none");
  });
});

describe("isAttachmentConsumed — boundary (E7)", () => {
  it("null baseline never consumes", () => {
    expect(isAttachmentConsumed(null, 5000)).toBe(false);
  });
  it("strict > against the baseline", () => {
    expect(isAttachmentConsumed(1000, 999)).toBe(false);
    expect(isAttachmentConsumed(1000, 1000)).toBe(false);
    expect(isAttachmentConsumed(1000, 1001)).toBe(true);
  });
  it("coerces ISO timestamps; NaN counts as 0", () => {
    expect(isAttachmentConsumed(1000, "1970-01-01T00:00:01.001Z")).toBe(true);
    expect(isAttachmentConsumed(1000, Number.NaN)).toBe(false);
  });
});
