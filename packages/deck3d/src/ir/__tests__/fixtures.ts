import type { DeckIR } from "../types.js";

/** A minimal schema-valid IR: one slide, no diagram, no overrides. */
export function validIR(): DeckIR {
  return {
    meta: { engine: "test", mermaid: "11.17.2" },
    defaults: {
      mode: "dark",
      palette: "blackbelt",
      material: "glass",
      quality: "high",
      depthRelief: 0.7,
      camera: { distance: 7 },
      labels: { size: 0.28 },
      check: { ignore: [] },
    },
    slides: [
      {
        index: 1,
        id: "intro",
        title: "Intro",
        bullets: [],
        scene: "tokens",
        diagram: { kind: "none" },
        camera: { distance: 7 },
        labels: { size: 0.28 },
        check: { ignore: [] },
        effects: [],
      },
    ],
    overrides: {},
  };
}

/** An IR with a small flowchart: nodes A, B and one edge. */
export function flowchartIR(): DeckIR {
  const ir = validIR();
  ir.slides[0].diagram = {
    kind: "flowchart",
    dir: "LR",
    scale: 1,
    offset: { x: 0, y: 0 },
    nodes: [
      { id: "A", label: "Alpha", shape: "rect", x: 0, y: 0, w: 100, h: 40 },
      { id: "B", label: "Beta", shape: "circle", x: 200, y: 0, w: 50, h: 50 },
    ],
    edges: [{ id: "A->B#0", from: "A", to: "B", kind: "normal", path: [[50, 0], [175, 0]] }],
    groups: [],
  };
  return ir;
}
