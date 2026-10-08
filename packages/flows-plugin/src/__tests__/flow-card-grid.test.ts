/**
 * Shared flow-card grid geometry (change: consolidate-flow-agent-cards, test-plan #E1).
 *
 * Pins the helper as the single geometry source: the numeric constants, the
 * classes they must appear in (as literals Tailwind's scanner can see), and that
 * BOTH grids consume it with no inline column minimum left behind. Pure source
 * scan — no DOM.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FLOW_CARD_COLUMN_MIN,
  FLOW_CARD_COMPACT_MAX_PX,
  FLOW_CARD_GAP,
  FLOW_CARD_GRID_CLASS,
  FLOW_CARD_GRID_CONTAINER_CLASS,
  FLOW_CARD_ROW_MIN,
  FLOW_CARD_ROW_MIN_COMPACT,
} from "../client/flow-card-grid.js";

const CLIENT_SRC = join(import.meta.dirname, "..", "client");
const PLUGIN_SRC = join(import.meta.dirname, "..");

function sources(dir: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    // Skip the tests themselves — their assertions name the retired literal.
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      out.push(...sources(full));
    } else if (/\.tsx?$/.test(entry.name)) out.push([full, readFileSync(full, "utf8")]);
  }
  return out;
}

describe("flow-card-grid helper (L1, #E1)", () => {
  it("declares the row-track, column and gap constants", () => {
    expect(FLOW_CARD_ROW_MIN).toBe(124);
    expect(FLOW_CARD_ROW_MIN_COMPACT).toBe(76);
    expect(FLOW_CARD_COLUMN_MIN).toBe(190);
    expect(FLOW_CARD_GAP).toBe(8);
    expect(FLOW_CARD_COMPACT_MAX_PX).toBe(480);
  });

  it("carries the constants as literals in the classes (Tailwind can scan them)", () => {
    expect(FLOW_CARD_GRID_CLASS).toContain(`minmax(${FLOW_CARD_ROW_MIN}px,auto)`);
    expect(FLOW_CARD_GRID_CLASS).toContain(`minmax(${FLOW_CARD_ROW_MIN_COMPACT}px,auto)`);
    expect(FLOW_CARD_GRID_CLASS).toContain(`minmax(${FLOW_CARD_COLUMN_MIN}px,1fr)`);
    expect(FLOW_CARD_GRID_CLASS).toContain("gap-2");
    expect(FLOW_CARD_GRID_CONTAINER_CLASS).toContain("@container");
    // Container-query variants key off the wrapper's own (PANE) width.
    expect(FLOW_CARD_GRID_CLASS).toContain(`@max-[${FLOW_CARD_COMPACT_MAX_PX}px]:grid-cols-1`);
    expect(FLOW_CARD_GRID_CLASS).toContain(
      `@max-[${FLOW_CARD_COMPACT_MAX_PX}px]:auto-rows-[minmax(${FLOW_CARD_ROW_MIN_COMPACT}px,auto)]`,
    );
  });

  it("both grid call sites spread the helper", () => {
    for (const file of ["FlowDashboard.tsx", "FlowSummary.tsx"]) {
      const src = readFileSync(join(CLIENT_SRC, file), "utf8");
      expect(src, `${file} must use the container class`).toContain("FLOW_CARD_GRID_CONTAINER_CLASS");
      expect(src, `${file} must use the grid class`).toContain("FLOW_CARD_GRID_CLASS");
      expect(src, `${file} must not inline a column minimum`).not.toContain("minmax(200px");
      expect(src, `${file} must not set gridTemplateColumns`).not.toContain("gridTemplateColumns");
    }
  });

  it("no inline minmax(200px column minimum survives anywhere in the plugin", () => {
    const hits = sources(PLUGIN_SRC).filter(([, src]) => src.includes("minmax(200px")).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it("does not import from packages/client", () => {
    const src = readFileSync(join(CLIENT_SRC, "flow-card-grid.ts"), "utf8");
    expect(src).not.toContain("packages/client");
  });
});
