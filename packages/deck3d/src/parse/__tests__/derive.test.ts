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
