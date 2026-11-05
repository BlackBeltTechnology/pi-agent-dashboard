import { describe, expect, it } from "vitest";
import { flowToMermaid, parseFlowYaml } from "../client/flow-yaml-parse.js";

const YAML = `
name: invoice-research
steps:
  - id: extract
    type: agent
    agent: extractor
    blockedBy: []
    on_complete: validate-nav
  - id: validate-nav
    type: code
    blockedBy: [extract]
    on_error: park
  - id: approve
    type: code-decision
    blockedBy: [validate-nav]
    branches:
      auto: export
      rework: extract
  - id: export
    type: agent
    agent: exporter
    blockedBy: [approve]
`;

describe("parseFlowYaml", () => {
  it("parses steps + counts", () => {
    const flow = parseFlowYaml(YAML)!;
    expect(flow.name).toBe("invoice-research");
    expect(flow.counts.total).toBe(4);
    expect(flow.counts.agents).toBe(2); // extract, export
    expect(flow.counts.code).toBe(2); // validate-nav, approve
    expect(flow.steps.find((s) => s.id === "approve")?.branches).toEqual({ auto: "export", rework: "extract" });
  });

  it("returns null on invalid YAML / no steps", () => {
    expect(parseFlowYaml(":::not yaml:::")).toBeNull();
    expect(parseFlowYaml("name: x")).toBeNull();
  });

  it("defaults missing type to agent", () => {
    const flow = parseFlowYaml("steps:\n  - id: a\n    blockedBy: []")!;
    expect(flow.steps[0].type).toBe("agent");
  });
});

describe("flowToMermaid", () => {
  it("emits graph LR with node shapes + forward and backward edges", () => {
    const flow = parseFlowYaml(YAML)!;
    const m = flowToMermaid(flow);
    expect(m.startsWith("graph LR")).toBe(true);
    expect(m).toContain('validate-nav[["⌗ validate-nav"]]'); // code shape
    expect(m).toContain('approve{"◈ approve"}'); // code-decision shape
    expect(m).toContain("approve -->|auto| export"); // forward branch
    expect(m).toContain('approve -. "rework ↺" .-> extract'); // backward branch (loop)
  });

  it("renders on_complete routing edges UNLABELED (happy-path default)", () => {
    // Policy (change: fix-flow-ui-graph-zoom-summary): an `on_complete` route is
    // the happy path — render as a plain arrow, never `|on_complete|`, so an
    // on_complete-wired flow's spine isn't labelled on every edge.
    const flow = parseFlowYaml(YAML)!;
    const m = flowToMermaid(flow);
    // extract.on_complete=validate-nav AND validate-nav.blockedBy=[extract] -> one route edge, unlabeled
    expect(m).toContain("extract --> validate-nav");
    expect(m).not.toContain("extract -->|on_complete| validate-nav");
    expect(m).not.toContain("|on_complete|");
    // on_error -> park, but no `park` step exists -> edge skipped
    expect(m).not.toContain("park");
  });

  it("renders on_error routes topology-distinctly (returning ↺ vs terminal ⊗)", () => {
    const flow = parseFlowYaml(`
name: topo
steps:
  - id: validate
    type: code-decision
    blockedBy: []
    on_error: fixup
  - id: transform
    type: agent
    blockedBy: [validate]
  - id: fixup
    type: agent
    blockedBy: []
    on_complete: validate
  - id: finalize
    type: agent
    blockedBy: [transform]
    on_error: notify
  - id: notify
    type: agent
    blockedBy: []
`)!;
    const m = flowToMermaid(flow);
    // returning handler (fixup rejoins validate) → dashed loop marker
    expect(m).toContain('validate -. "on_error ↺" .-> fixup');
    // terminal handler (notify is a sink) → dashed terminal marker
    expect(m).toContain('finalize -. "on_error ⊗" .-> notify');
    // an on_error route is never rendered as a solid labeled forward edge
    expect(m).not.toContain("-->|on_error|");
  });

  it("renders implicit-segment edges and emits no flow-ref shape", () => {
    const flow = parseFlowYaml(`
name: seg
steps:
  - id: decide
    type: fork
    branches: { go: end }
  - id: orphan
    type: agent
  - id: end
    type: agent
`)!;
    const m = flowToMermaid(flow);
    // `orphan` has no blockedBy and no incoming edge -> implicit edge from the
    // preceding separator `decide`.
    expect(m).toContain("decide --> orphan");
    expect(m).not.toContain("[[\"orphan");
  });
});

/** E32: object-form branches (pi-flows 0.10). See change: update-flows-plugin (G8). */
describe("parseFlowYaml object-form branches (E32)", () => {
  const OBJ = `
steps:
  - id: triage
    type: agent-decision
    blockedBy: []
    branches:
      bug: { to: fix, means: "bug found" }
      many: { to: review, for_each: "{{items}}" }
      legacy: doc
      broken: { means: "x" }
  - id: fix
    blockedBy: []
  - id: review
    blockedBy: []
  - id: doc
    blockedBy: []
`;
  it("keeps edges to each `to`; a branch without `to` yields none; no throw", () => {
    let flow: ReturnType<typeof parseFlowYaml> = null;
    expect(() => {
      flow = parseFlowYaml(OBJ);
    }).not.toThrow();
    const triage = flow!.steps.find((s) => s.id === "triage")!;
    expect(triage.branches).toEqual({ bug: "fix", many: "review", legacy: "doc" });
    const mermaid = flowToMermaid(flow!);
    expect(mermaid).toMatch(/triage[^\n]*-->[^\n]*fix/);
    expect(mermaid).toMatch(/triage[^\n]*-->[^\n]*review/);
    expect(mermaid).toMatch(/triage[^\n]*-->[^\n]*doc/);
    expect(mermaid).not.toContain("broken");
  });
});
