/**
 * Pure atlas client helpers. test-plan #E26 (mutual merge), #E29 (layout
 * determinism + labels), #E30 (top by degree), hop focus. P4 is the e2e render
 * budget; this asserts the layout share stays well under it.
 * See change: add-skill-atlas-screen.
 */
import { describe, expect, it } from "vitest";
import type { SkillLink, SkillNode } from "../../shared/types.js";
import { fitTransform, hopSet, labelBox, layoutGraph, neighbourRows, placeLabels, topByDegree } from "../graph-layout.js";

function graph(n: number) {
  const skills: SkillNode[] = Array.from({ length: n }, (_, i) => ({
    id: `skill-${String(i).padStart(3, "0")}`,
    description: "",
    filePath: `/s/${i}/SKILL.md`,
    origin: "global",
    degree: 0,
  }));
  const links: SkillLink[] = [];
  for (let i = 1; i < n; i += 2) links.push({ source: skills[i].id, target: skills[(i * 7) % n].id, type: "references", why: "" });
  return { skills, links };
}

describe("layoutGraph (#E29)", () => {
  it("is deterministic and normalized", () => {
    const g = graph(91);
    const a = layoutGraph(g.skills, g.links);
    const b = layoutGraph(g.skills, g.links);
    expect([...a]).toEqual([...b]);
    for (const p of a.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("300 nodes lays out well within the render budget", () => {
    const g = graph(300);
    const t0 = performance.now();
    layoutGraph(g.skills, g.links);
    expect(performance.now() - t0).toBeLessThan(400);
  });
});

describe("placeLabels (#E29)", () => {
  it("never overlaps and always places priority 0", () => {
    const g = graph(91);
    const pts = layoutGraph(g.skills, g.links);
    const at = fitTransform(pts, [], { w: 900, h: 600 });
    const cands = g.skills.map((s, i) => ({ id: s.id, ...at(s.id), priority: i === 50 ? 0 : 4 }));
    const placed = placeLabels(cands);
    expect(placed.has(g.skills[50].id)).toBe(true);
    const boxes = cands.filter((c) => placed.has(c.id) && c.priority > 0).map(labelBox);
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
  });
});

describe("fitTransform", () => {
  it("re-fits to a focus subset (subset spans the viewport)", () => {
    const pts = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 0.1, y: 0 }],
      ["c", { x: 1, y: 1 }],
    ]);
    const all = fitTransform(pts, [], { w: 1000, h: 1000 }, 1, { x: 0, y: 0 }, 0);
    const focus = fitTransform(pts, ["a", "b"], { w: 1000, h: 1000 }, 1, { x: 0, y: 0 }, 0);
    expect(focus("b").x - focus("a").x).toBeGreaterThan(all("b").x - all("a").x);
  });
});

describe("selection helpers", () => {
  const links: SkillLink[] = [
    { source: "plan-proposal", target: "ship-it", type: "references", why: "p names s" },
    { source: "ship-it", target: "plan-proposal", type: "references", why: "s names p" },
    { source: "plan-proposal", target: "scenario-design", type: "references", why: "p names sd" },
    { source: "scenario-design", target: "x-far", type: "bundle", why: "pkg" },
  ];
  it("mutual references merge into one ↔ row (#E26)", () => {
    const rows = neighbourRows("plan-proposal", links, "references");
    expect(rows.map((r) => `${r.direction}${r.id}`)).toEqual(["→scenario-design", "↔ship-it"]);
  });
  it("hopSet grows by hop", () => {
    expect([...hopSet(links, "plan-proposal", 1)].sort()).toEqual(["plan-proposal", "scenario-design", "ship-it"]);
    expect(hopSet(links, "plan-proposal", 2).has("x-far")).toBe(true);
  });
  it("topByDegree: degree desc, id asc, zero-degree excluded (#E30)", () => {
    const n = (id: string, degree: number) => ({ id, degree, description: "", filePath: "", origin: "global" as const });
    expect(topByDegree([n("b", 3), n("a", 3), n("c", 5), n("z", 0)], 5).map((s) => s.id)).toEqual(["c", "a", "b"]);
  });
});
