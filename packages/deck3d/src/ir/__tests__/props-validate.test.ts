import { describe, expect, it } from "vitest";
import { defaultEffectsFor } from "../../fx/defaults.js";
import { deriveDeckIR } from "../../parse/derive.js";
import { parseMarkdown } from "../../parse/markdown.js";
import type { DeckIR, PropOverride } from "../types.js";
import { validate } from "../validate.js";

const MD = "# Arch\n\n```mermaid\nflowchart LR\n  A[X] --> B[Y]\n```\n";
const stub = async () => ({
  diagram: {
    kind: "flowchart" as const,
    dir: "LR" as const,
    nodes: [
      { id: "A", label: "X", shape: "rect" as const, x: 0, y: 0, w: 10, h: 10 },
      { id: "B", label: "Y", shape: "rect" as const, x: 20, y: 0, w: 10, h: 10 },
    ],
    edges: [{ id: "A->B#0", from: "A", to: "B", kind: "normal" as const, path: [[0, 0], [1, 1]] as Array<[number, number]> }],
    groups: [],
  },
});

async function deck(): Promise<DeckIR> {
  const { ir } = await deriveDeckIR(parseMarkdown(MD), { harvest: stub, effectsForSlide: defaultEffectsFor });
  return ir;
}

function prop(overrides: Partial<PropOverride> = {}): PropOverride {
  return {
    source: "vendored",
    id: "robot",
    licence: "CC0-1.0",
    author: "deck3d corpus",
    sha256: "a".repeat(64),
    slide: "arch",
    role: "illustration",
    ...overrides,
  };
}

describe("prop overrides (7b.1)", () => {
  it("rejects an unknown role", async () => {
    const ir = await deck();
    ir.overrides.props = [prop({ role: "wizard" })];
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.path.includes("role"))).toBe(true);
  });

  it("rejects a missing sha256", async () => {
    const ir = await deck();
    const p = prop();
    delete (p as { sha256?: string }).sha256;
    ir.overrides.props = [p];
    const result = validate(ir);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.message.includes("sha256") && e.message.includes("required"))).toBe(true);
  });

  it("warns (exit 0) on a node role with no such node, naming prop + node", async () => {
    const ir = await deck();
    ir.overrides.props = [prop({ role: "node:Foo" })];
    const result = validate(ir);
    expect(result.ok).toBe(true);
    const warning = result.warnings.find((w) => w.path === "overrides.props[0].role");
    expect(warning?.message).toContain("robot");
    expect(warning?.message).toContain("Foo");
  });

  it("accepts a node role that resolves", async () => {
    const ir = await deck();
    ir.overrides.props = [prop({ role: "node:A" })];
    expect(validate(ir).warnings.filter((w) => w.path === "overrides.props[0].role")).toHaveLength(0);
  });

  it("warns over the count and byte budgets but exits 0 (E32)", async () => {
    const ir = await deck();
    ir.overrides.props = Array.from({ length: 5 }, () => prop());
    expect(validate(ir, { propBytes: { "vendored-robot": 2 * 1024 * 1024 } }).warnings.filter((w) => w.path === "overrides.props")).toHaveLength(0);

    ir.overrides.props = Array.from({ length: 6 }, () => prop());
    const six = validate(ir, { propBytes: { "vendored-robot": 2 * 1024 * 1024 } });
    expect(six.ok).toBe(true);
    expect(six.warnings.some((w) => w.message.includes("6 props"))).toBe(true);

    ir.overrides.props = [prop(), prop()];
    const heavy = validate(ir, { propBytes: { "vendored-robot": 6 * 1024 * 1024 } });
    expect(heavy.ok).toBe(true);
    expect(heavy.warnings.some((w) => w.message.includes("bytes exceed"))).toBe(true);
  });
});
