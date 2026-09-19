import { describe, expect, it } from "vitest";
import { mapEdgeKind, mapMessageKind, mapNodeShape } from "../shapes.js";

describe("mapNodeShape", () => {
  it.each([
    ["square", "rect"],
    ["rect", "rect"],
    ["round", "round"],
    ["stadium", "stadium"],
    ["circle", "circle"],
    ["doublecircle", "doublecircle"],
    ["diamond", "diamond"],
    ["question", "diamond"],
    ["hexagon", "hexagon"],
    ["cylinder", "cylinder"],
    [undefined, "rect"],
    ["something-else", "rect"],
  ])("maps %s → %s", (input, expected) => {
    expect(mapNodeShape(input as string | undefined)).toBe(expected);
  });
});

describe("mapEdgeKind", () => {
  it("maps thick and dotted, defaults to normal", () => {
    expect(mapEdgeKind("thick")).toBe("thick");
    expect(mapEdgeKind("dotted")).toBe("dotted");
    expect(mapEdgeKind("normal")).toBe("normal");
    expect(mapEdgeKind(undefined)).toBe("normal");
  });
});

describe("mapMessageKind", () => {
  it("maps solid and dotted message types, rejects non-messages", () => {
    expect(mapMessageKind(0)).toBe("solid");
    expect(mapMessageKind(1)).toBe("dotted");
    expect(mapMessageKind(24)).toBe("solid");
    expect(mapMessageKind(25)).toBe("dotted");
    expect(mapMessageKind(2)).toBeUndefined();
    expect(mapMessageKind(undefined)).toBeUndefined();
  });
});
