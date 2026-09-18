/**
 * E13 — harvest: flowchart shapes + edge kinds (test-plan #E13, tasks 10.13).
 *
 * Observable: node `shape` values are exactly
 * `rect,stadium,circle,diamond,hexagon,doublecircle`; edge `kind` values are
 * exactly `normal,dotted,thick`; the labelled edge keeps its label text.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagram } from "../../../ir/types.js";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";

const BIN = new URL("../../../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

const MERMAID = [
  "flowchart LR",
  "  A[rect] --> B([stadium])",
  "  B --> C((circle))",
  "  C --> D{diamond}",
  "  D --> E{{hex}}",
  "  E --> F(((double)))",
  "  A -.-> C",
  "  C ==>|heavy| E",
].join("\n");

const SLIDE_ID = "shapes";

function parseFixture(dir: string): Diagram {
  writeFileSync(join(dir, "shapes.md"), `# Shapes\n\n\`\`\`mermaid\n${MERMAID}\n\`\`\`\n`);
  const r = spawnSync(BIN, ["parse", "shapes.md", "-o", "shapes.json"], { cwd: dir, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const ir = JSON.parse(readFileSync(join(dir, "shapes.json"), "utf8")) as {
    slides: Array<{ id: string; diagram: Diagram }>;
  };
  const slide = ir.slides.find((s) => s.id === SLIDE_ID);
  expect(slide, `slide ${SLIDE_ID} missing from deck.json`).toBeDefined();
  return slide!.diagram;
}

describe.skipIf(!hasChromium)("harvest: flowchart shapes + edge kinds (E13)", () => {
  it("maps every shape and edge kind and preserves the edge label", () => {
    const diagram = parseFixture(mkdtempSync(join(tmpdir(), "deck3d-harvest-e13-")));
    expect(diagram.kind).toBe("flowchart");

    // Exactly these six shapes — no fallback `rect` leaking in, none missing.
    const shapes = [...new Set((diagram.nodes ?? []).map((n) => n.shape))].sort();
    expect(shapes).toEqual(["circle", "diamond", "doublecircle", "hexagon", "rect", "stadium"]);
    expect(Object.fromEntries((diagram.nodes ?? []).map((n) => [n.id, n.shape]))).toEqual({
      A: "rect",
      B: "stadium",
      C: "circle",
      D: "diamond",
      E: "hexagon",
      F: "doublecircle",
    });

    const kinds = [...new Set((diagram.edges ?? []).map((e) => e.kind))].sort();
    expect(kinds).toEqual(["dotted", "normal", "thick"]);

    const labelled = (diagram.edges ?? []).filter((e) => e.label !== undefined);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toMatchObject({ from: "C", to: "E", kind: "thick", label: "heavy" });
  }, 90_000);
});
