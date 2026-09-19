import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";
import { harvestDiagram, toDiagram } from "../index.js";

const hasChromium = await chromiumAvailable();

describe("toDiagram (browser-free)", () => {
  it("assigns stable edge ids `from->to#k` with parallel-edge ordinals", () => {
    const { diagram } = toDiagram(
      {
        kind: "flowchart",
        dir: "LR",
        nodes: [
          { id: "A", label: "A", shape: "rect", x: 0, y: 0, w: 10, h: 10 },
          { id: "B", label: "B", shape: "rect", x: 20, y: 0, w: 10, h: 10 },
        ],
        edges: [
          { from: "A", to: "B", kind: "normal", path: [[0, 0], [1, 1]] },
          { from: "A", to: "B", kind: "dotted", path: [[0, 1], [1, 2]] },
        ],
        groups: [],
      },
      "s1",
    );
    expect(diagram.edges?.map((e) => e.id)).toEqual(["A->B#0", "A->B#1"]);
  });

  it("assigns contiguous `m<i>` message ids and keeps self-messages", () => {
    const { diagram } = toDiagram(
      {
        kind: "sequence",
        actors: [{ id: "U", label: "User" }],
        messages: [
          { from: "U", to: "U", text: "retry", kind: "solid" },
          { from: "U", to: "U", text: "again", kind: "dotted" },
        ],
      },
      "s1",
    );
    expect(diagram.messages?.map((m) => m.id)).toEqual(["m0", "m1"]);
    expect(diagram.messages?.[0].from).toBe(diagram.messages?.[0].to);
  });

  it("warns on an unsupported diagram type with the slide id", () => {
    const { diagram, warnings } = toDiagram({ kind: "none", unsupported: "gantt" }, "plan");
    expect(diagram.kind).toBe("none");
    expect(warnings).toEqual(["warn unsupported diagram gantt slide plan"]);
  });
});

describe.skipIf(!hasChromium)("harvestDiagram (chromium)", () => {
  it("maps flowchart shapes, edge kinds, labels and direction", async () => {
    const source = [
      "flowchart LR",
      "  A[rect] --> B([stadium])",
      "  B --> C((circle))",
      "  C --> D{diamond}",
      "  D --> E{{hexagon}}",
      "  A -.-> C",
      "  C ==>|heavy| E",
    ].join("\n");
    const { diagram } = await harvestDiagram(source, "shapes");
    expect(diagram.kind).toBe("flowchart");
    expect(diagram.dir).toBe("LR");
    const shapes = Object.fromEntries((diagram.nodes ?? []).map((n) => [n.id, n.shape]));
    expect(shapes).toMatchObject({
      A: "rect",
      B: "stadium",
      C: "circle",
      D: "diamond",
      E: "hexagon",
    });
    const kinds = new Set((diagram.edges ?? []).map((e) => e.kind));
    expect(kinds.has("normal")).toBe(true);
    expect(kinds.has("dotted")).toBe(true);
    expect(kinds.has("thick")).toBe(true);
    expect((diagram.edges ?? []).some((e) => e.label === "heavy")).toBe(true);
  }, 90_000);

  it("round-trips Hungarian labels and preserves subgraph membership", async () => {
    const source = [
      "flowchart TB",
      "  subgraph Core",
      "    A[Felhasználó őrült űrhajó] --> B[Megfigyelés]",
      "  end",
      "  B --> C[Külső]",
    ].join("\n");
    const { diagram } = await harvestDiagram(source, "hu");
    const a = diagram.nodes?.find((n) => n.id === "A");
    expect(a?.label).toBe("Felhasználó őrült űrhajó");
    expect(a?.group).toBe("Core");
    expect(diagram.nodes?.find((n) => n.id === "C")?.group).toBeUndefined();
    expect(diagram.groups).toHaveLength(1);
    expect(diagram.groups?.[0].id).toBe("Core");
    expect([...(diagram.groups?.[0].nodes ?? [])].sort()).toEqual(["A", "B"]);
  }, 90_000);

  it("converts a sequence diagram: actors in order, messages with kinds", async () => {
    const source = [
      "sequenceDiagram",
      "  actor U as User",
      "  participant S as Server",
      "  participant D as DB",
      "  U->>S: request",
      "  S-->>U: response",
      "  S->>D: query",
      "  D-->>S: rows",
      "  S->>S: retry",
    ].join("\n");
    const { diagram } = await harvestDiagram(source, "seq");
    expect(diagram.kind).toBe("sequence");
    expect(diagram.actors?.map((a) => a.id)).toEqual(["U", "S", "D"]);
    expect(diagram.messages).toHaveLength(5);
    expect(diagram.messages?.map((m) => m.id)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(diagram.messages?.[1].kind).toBe("dotted");
    const self = diagram.messages?.[4];
    expect(self?.from).toBe(self?.to);
  }, 90_000);

  it("reports an unsupported type as a warning and `none`", async () => {
    const { diagram, warnings } = await harvestDiagram("gantt\n  title x\n  section s\n  task t: 1, 2", "plan");
    expect(diagram.kind).toBe("none");
    expect(warnings).toEqual(["warn unsupported diagram gantt slide plan"]);
  }, 90_000);

  it("is deterministic: same source twice → identical diagram JSON", async () => {
    const source = ["flowchart TD", "  A --> B", "  B --> C"].join("\n");
    const first = await harvestDiagram(source, "det");
    const second = await harvestDiagram(source, "det");
    expect(JSON.stringify(second.diagram)).toBe(JSON.stringify(first.diagram));
  }, 120_000);

  it("times out with the slide id and closes the browser", async () => {
    await expect(harvestDiagram("flowchart TD\n  A --> B", "hang", { timeoutMs: 300, stall: true })).rejects.toThrow(
      /slide "hang".*timeout/,
    );
  }, 30_000);
});

describe.skipIf(hasChromium)("harvestDiagram (no chromium)", () => {
  it("fails with an install hint", async () => {
    await expect(harvestDiagram("flowchart TD\n  A --> B", "x")).rejects.toMatchObject({
      message: expect.stringContaining("npx playwright install chromium"),
    });
  }, 30_000);
});
