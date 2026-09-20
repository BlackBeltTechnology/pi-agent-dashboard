import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../ir/hash.js";
import type { DeckIR } from "../../ir/types.js";
import { deriveDeckIR, type Harvester, parseDeck } from "../derive.js";

const stubHarvest: Harvester = async () => ({
  diagram: {
    kind: "flowchart",
    dir: "LR",
    nodes: [
      { id: "A", label: "A", shape: "rect", x: 0, y: 0, w: 100, h: 40 },
      { id: "B", label: "B", shape: "rect", x: 200, y: 0, w: 100, h: 40 },
    ],
    edges: [{ id: "A->B#0", from: "A", to: "B", kind: "normal", path: [[50, 0], [175, 0]] }],
    groups: [],
  },
});
const OPTS = { harvest: stubHarvest } as const;

const MD = `# Intro

First talk slide.

- one
- two

# Architektúra {#arch}

- bullet

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`;

describe("parseDeck", () => {
  it("is byte-identical for the same input (E2 case A/C)", async () => {
    const a = await parseDeck(MD, OPTS);
    const b = await parseDeck(MD, OPTS);
    expect(canonicalJson(a.ir)).toBe(canonicalJson(b.ir));
  });

  it("derives stable slide ids (E3)", async () => {
    const { ir } = await parseDeck(MD, OPTS);
    expect(ir.slides.map((s) => s.id)).toEqual(["intro", "arch"]);
    expect(ir.meta.derivedHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * test-plan #E37 — the D2 built-kind table, evaluated in order, first match
 * wins. A bare content slide should already carry a 3D object; a bullet-less
 * section slide never should.
 */
describe("E37 built-kind table", () => {
  const CASES: Array<[string, string, string[], string]> = [
    ["years", "Rollout", ["2026: MVP", "2027: GA"], "timeline-rail"],
    ["percentages", "Adoption", ["88% adoption", "12% none"], "bars"],
    ["funnel", "Deal pipeline review", ["a", "b"], "funnel"],
    ["swarm", "Our agents", ["a", "b"], "swarm"],
    ["loop", "Feedback loop", ["a", "b"], "loop"],
    ["brain", "The LLM", ["a", "b"], "brain"],
    ["globe", "Global trade", ["a", "b"], "globe"],
    ["orbit-cluster", "Partner ecosystem", ["a", "b"], "orbit-cluster"],
    ["stack", "Compute layers", ["a", "b"], "stack"],
    ["no match", "Lunch menu", ["a", "b"], "none"],
    ["section slide (no bullets)", "Timeline", [], "none"],
  ];

  it.each(CASES)("%s: %s → %j yields the built kind", async (_name, title, bullets, expected) => {
    const md = `# ${title}\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n`;
    const { ir } = await parseDeck(md, OPTS);
    expect(ir.slides[0].diagram.kind).toBe(expected);
  });

  it("assigns no built kind when autoStyle is off", async () => {
    const md = "---\nautoStyle: false\n---\n\n# Global trade\n\n- a\n- b\n";
    const { ir } = await parseDeck(md, OPTS);
    expect(ir.slides[0].diagram.kind).toBe("none");
  });

  it("lets a supported mermaid block win and warns that the override is inert", async () => {
    const md = "# Global trade\n\n- a\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    const { ir } = await parseDeck(md, OPTS);
    expect(ir.slides[0].diagram.kind).toBe("flowchart");
  });
});

/**
 * test-plan #E38 — bullets drive the geometry. A leading year is a caption,
 * never a magnitude, and a partially numeric series carries no values at all
 * (equal heights beat silently inventing a number).
 */
describe("E38 diagram.data harvest", () => {
  it("strips leading magnitudes into labels and omits a partial value series", async () => {
    const md = "# Mixed\n\n- 88% adoption\n- 2026: MVP\n- 0 churn\n- plain\n";
    const { ir } = await parseDeck(md, OPTS);
    const data = ir.slides[0].diagram.data;
    expect(data?.labels).toEqual(["adoption", "2026: MVP", "churn", "plain"]);
    expect(data).not.toHaveProperty("values");
  });

  it("keeps values when every bullet carries a non-year magnitude", async () => {
    const md = "# Adoption\n\n- 88% adoption\n- 12% none\n";
    const { ir } = await parseDeck(md, OPTS);
    expect(ir.slides[0].diagram.data).toEqual({ labels: ["adoption", "none"], values: [88, 12] });
  });
});

describe("deriveDeckIR override preservation", () => {
  it("keeps a prior override while derived bullets change (E5)", async () => {
    const first = await parseDeck(MD, OPTS);
    const withOverride: DeckIR = structuredClone(first.ir);
    withOverride.overrides.slides = { intro: { mode: "light" } };
    withOverride.overrides.nodes = { "arch/A": { shape: "hexagon" } };

    const edited = MD.replace("- two", "- two\n- three");
    const second = await deriveDeckIR(
      (await import("../markdown.js")).parseMarkdown(edited),
      { previous: withOverride, harvest: stubHarvest },
    );
    const intro = second.ir.slides.find((s) => s.id === "intro")!;
    expect(intro.bullets).toEqual(["one", "two", "three"]);
    expect(second.ir.overrides.slides?.intro).toEqual({ mode: "light" });
    expect(second.ir.overrides.nodes?.["arch/A"]).toEqual({ shape: "hexagon" });
  });

  it("warns with a pin suggestion on an orphaned slide override (E7)", async () => {
    const first = await parseDeck(MD, OPTS);
    const withOverride = structuredClone(first.ir);
    withOverride.overrides.slides = { "old-title": { mode: "light" } };
    const renamed = MD.replace("# Intro", "# Bevezetés");
    const { parseMarkdown } = await import("../markdown.js");
    const second = await deriveDeckIR(parseMarkdown(renamed), { previous: withOverride, harvest: stubHarvest });
    expect(second.warnings.some((w) => w.includes('overrides.slides["old-title"]'))).toBe(true);
    expect(second.warnings.some((w) => w.includes("{#old-title}"))).toBe(true);
    expect(second.ir.slides[0].id).toBe("bevezetes");
  });

  it("lets an inline override win over deck.json and warns (E8)", async () => {
    const first = await parseDeck(MD, OPTS);
    const withOverride = structuredClone(first.ir);
    withOverride.overrides.slides = { intro: { mode: "dark", scene: "orbits" } };
    const inline = MD.replace("First talk slide.", 'First talk slide.\n\n<!-- deck3d: {"mode":"light"} -->');
    const { parseMarkdown } = await import("../markdown.js");
    const second = await deriveDeckIR(parseMarkdown(inline), { previous: withOverride, harvest: stubHarvest });
    expect(second.ir.overrides.slides?.intro).toMatchObject({ mode: "light", scene: "orbits" });
    expect(second.warnings.some((w) => w.includes('overrides.slides["intro"].mode'))).toBe(true);
  });

  it("drops prior overrides under `fresh` (E2 case C)", async () => {
    const first = await parseDeck(MD, OPTS);
    const withOverride = structuredClone(first.ir);
    withOverride.overrides.slides = { intro: { mode: "light" } };
    const fresh = await deriveDeckIR((await import("../markdown.js")).parseMarkdown(MD), {
      previous: withOverride,
      fresh: true,
      harvest: stubHarvest,
    });
    expect(fresh.ir.overrides.slides).toEqual({});
  });
});
