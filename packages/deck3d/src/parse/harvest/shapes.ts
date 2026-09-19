/**
 * Pure mappings from mermaid's semantic model to the Deck IR enums.
 *
 * Kept browser-free so both the harvest harness (bundled by esbuild) and the
 * unit tests can import them. Mermaid's `vertex.type`, edge `stroke` and
 * sequence message `type` numbers are the pinned scheme (see design D2).
 */
import type { EdgeKind, NodeShape } from "../../ir/types.js";

/** Mermaid `vertex.type` → IR `NodeShape`. Unknown shapes fall back to `rect`. */
export function mapNodeShape(mermaidType: string | undefined): NodeShape {
  switch (mermaidType) {
    case "square":
    case "rect":
    case "rect_left_inv_arrow":
    case "lean_right":
    case "lean_left":
    case "trapezoid":
    case "inv_trapezoid":
    case "subroutine":
    case "data_rect":
    case "fork":
    case "join":
      return "rect";
    case "round":
      return "round";
    case "stadium":
      return "stadium";
    case "circle":
      return "circle";
    case "doublecircle":
      return "doublecircle";
    case "diamond":
    case "question":
      return "diamond";
    case "hexagon":
      return "hexagon";
    case "cylinder":
    case "cyl":
      return "cylinder";
    default:
      return "rect";
  }
}

/** Mermaid edge `stroke` → IR `EdgeKind`. */
export function mapEdgeKind(stroke: string | undefined): EdgeKind {
  if (stroke === "thick") return "thick";
  if (stroke === "dotted") return "dotted";
  return "normal";
}

/**
 * Mermaid sequence message `type` → IR `kind`, or `undefined` for entries that
 * are not drawable messages (notes, activations, loops, …). The numeric map is
 * the pinned v11 scheme.
 */
export function mapMessageKind(mermaidType: number | undefined): "solid" | "dotted" | undefined {
  switch (mermaidType) {
    case 0:
    case 3:
    case 5:
    case 24:
    case 33:
      return "solid";
    case 1:
    case 4:
    case 6:
    case 25:
    case 34:
      return "dotted";
    default:
      return undefined;
  }
}
