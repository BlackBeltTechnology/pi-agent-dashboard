/**
 * Pure atlas client helpers + the d3-force simulation.
 * add-skill-atlas-screen: #E26 (mutual merge), #E30 (top by degree), hop focus.
 * add-skill-atlas-forest-aura: #E1 #E2 #E3 #E4 #E5 #E7 #E8 #E9 #X1 #X2 #P1
 * #F5 #F6 #F13 (#E5 replaces the old layoutGraph determinism test E29).
 * See change: add-skill-atlas-forest-aura.
 */
import { describe, expect, it, vi } from "vitest";
import pkg from "../../../package.json";
import type { SkillLink, SkillNode } from "../../shared/types.js";
import {
  createAtlasSimulation,
  discsDisjoint,
  dragEnd,
  dragMove,
  dragStart,
  forestDiscs,
  presettle,
  type SimNode,
} from "../atlas-simulation.js";
import {
  type Box,
  fitView,
  forests,
  hopSet,
  LABEL_H,
  type LabelCandidate,
  neighbourRows,
  OUTLINE_PAD,
  outlinePath,
  type Point,
  placeLabels,
  topByDegree,
} from "../graph-layout.js";
import fixtureJson from "./fixtures/graph.fixture.json";

const node = (id: string, degree = 0): SkillNode => ({ id, description: "", filePath: "", origin: "global", degree });
const link = (source: string, target: string, type: SkillLink["type"] = "references"): SkillLink => ({ source, target, type, why: "" });
const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (b: Box, f: Box) => b.x >= f.x && b.y >= f.y && b.x + b.w <= f.x + f.w && b.y + b.h <= f.y + f.h;

const fixture = fixtureJson as unknown as { skills: SkillNode[]; links: SkillLink[] };

/** `n` disjoint two-skill forests (references), plus `extra` singletons. */
function pairs(n: number, extra = 0) {
  const skills: SkillNode[] = [];
  const links: SkillLink[] = [];
  for (let i = 0; i < n; i++) {
    const a = `p${String(i).padStart(3, "0")}a`;
    const b = `p${String(i).padStart(3, "0")}b`;
    skills.push(node(a, 1), node(b, 1));
    links.push(link(a, b));
  }
  for (let i = 0; i < extra; i++) skills.push(node(`s${String(i).padStart(3, "0")}`));
  return { skills, links };
}

/** Separation disc per drawn forest: centroid, max dist + 20 + node r (test-plan #E4). */
function drawnDiscsDisjoint(skills: readonly SkillNode[], links: readonly SkillLink[], sim: ReturnType<typeof createAtlasSimulation>) {
  const byId = new Map(sim.nodes().map((n) => [n.id, n]));
  const groups = forests(
    skills.map((s) => s.id),
    links,
  ).map((g) => g.map((id) => byId.get(id) as SimNode));
  return discsDisjoint(forestDiscs(groups, OUTLINE_PAD));
}

describe("forests (#E1 #E2)", () => {
  it("one array per connected group, largest first, every id once (#E1)", () => {
    const ids = "abcdefghijkl".split("");
    const links = [link("a", "b"), link("b", "c"), link("c", "d"), link("d", "e"), link("f", "g"), link("g", "h"), link("i", "j")];
    const out = forests(ids, links);
    expect(out.map((g) => g.length)).toEqual([5, 3, 2, 1, 1]);
    expect(out.flat().sort()).toEqual(ids);
  });

  it("relation filter re-forms forests (#E2)", () => {
    const links = [link("x", "y", "bundle"), link("y", "z", "references")];
    const refsOnly = forests(
      ["x", "y", "z"],
      links.filter((l) => l.type === "references"),
    );
    expect(refsOnly).toContainEqual(["x"]);
    expect(refsOnly.find((g) => g.includes("y"))?.sort()).toEqual(["y", "z"]);
    expect(forests(["x", "y", "z"], links)).toHaveLength(1);
  });
});

/** Sample an `outlinePath` (M/L/A commands) to a polygon. */
function samplePath(d: string): Point[] {
  const tokens = d.match(/[MLAZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const pts: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  for (let i = 0; i < tokens.length; ) {
    const cmd = tokens[i++];
    const num = () => Number(tokens[i++]);
    if (cmd === "M" || cmd === "L") {
      cur = { x: num(), y: num() };
      pts.push(cur);
    } else if (cmd === "A") {
      const r = num();
      num(); // ry
      num(); // x-axis rotation
      const large = num();
      const sweep = num();
      const end = { x: num(), y: num() };
      // Pick the centre whose arc runs in the sweep direction with the right size (large flag).
      const mx = (cur.x + end.x) / 2;
      const my = (cur.y + end.y) / 2;
      const dx = end.x - cur.x;
      const dy = end.y - cur.y;
      const q = Math.hypot(dx, dy) || 1;
      const h = Math.sqrt(Math.max(0, r * r - (q / 2) ** 2));
      const TAU = 2 * Math.PI;
      const arc = (c: Point) => {
        const a0 = Math.atan2(cur.y - c.y, cur.x - c.x);
        let delta = Math.atan2(end.y - c.y, end.x - c.x) - a0;
        if (sweep) delta = ((delta % TAU) + TAU) % TAU;
        else delta = -((((-delta) % TAU) + TAU) % TAU);
        return { c, a0, delta };
      };
      const cands = [1, -1].map((sg) => arc({ x: mx + (sg * h * -dy) / q, y: my + (sg * h * dx) / q }));
      const chosen = cands.find((k) => Math.abs(k.delta) > Math.PI - 1e-9 === !!large) ?? cands[0];
      for (let st = 1; st <= 24; st++) {
        const ang = chosen.a0 + (chosen.delta * st) / 24;
        pts.push({ x: chosen.c.x + r * Math.cos(ang), y: chosen.c.y + r * Math.sin(ang) });
      }
      cur = end;
    }
  }
  return pts;
}

/** Distance from `p` to the closest polygon edge (positive when inside). */
function insideDistance(poly: readonly Point[], p: Point): number {
  let inside = false;
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
    min = Math.min(min, Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))));
  }
  return inside ? min : -min;
}

describe("outlinePath (#E3)", () => {
  it("1 point → circle of radius pad", () => {
    const poly = samplePath(outlinePath([{ x: 10, y: 10 }], 20));
    for (const p of poly) expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(20, 5);
  });

  it("2 points and 3 collinear → capsule over the endpoints", () => {
    for (const pts of [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
      ],
    ]) {
      const poly = samplePath(outlinePath(pts, 20));
      for (const p of poly) {
        const t = Math.max(0, Math.min(100, p.x));
        expect(Math.hypot(p.x - t, p.y)).toBeCloseTo(20, 5);
      }
      for (const p of pts) expect(insideDistance(poly, p)).toBeGreaterThanOrEqual(19.5);
    }
  });

  it("6 seeded points: every point ≥ 19.5 px inside", () => {
    let s = 42;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const pts = Array.from({ length: 6 }, () => ({ x: rnd() * 200, y: rnd() * 150 }));
    const poly = samplePath(outlinePath(pts, 20));
    for (const p of pts) expect(insideDistance(poly, p)).toBeGreaterThanOrEqual(19.5);
  });
});

describe("fitView", () => {
  it("fits bounds centred in the viewport, scale capped by kMax", () => {
    const v = fitView({ x: 0, y: 0, w: 100, h: 50 }, { w: 1000, h: 1000 }, 0, 100);
    expect(v.k).toBeCloseTo(10);
    expect(50 * v.k + v.x).toBeCloseTo(500);
    expect(25 * v.k + v.y).toBeCloseTo(500);
    expect(fitView({ x: 0, y: 0, w: 1, h: 1 }, { w: 1000, h: 1000 }, 0, 3).k).toBe(3);
  });

  it("a focus subset fits tighter than the whole set", () => {
    const all = fitView({ x: 0, y: 0, w: 1000, h: 1000 }, { w: 800, h: 600 });
    const focus = fitView({ x: 0, y: 0, w: 100, h: 100 }, { w: 800, h: 600 });
    expect(focus.k).toBeGreaterThan(all.k);
  });
});

describe("placeLabels (#E7 #E8 #E9 #X1)", () => {
  const frame = { x: 0, y: 0, w: 400, h: 300 };
  const nodeBox = (c: { x: number; y: number }, r = 5): Box => ({ x: c.x - r, y: c.y - r, w: 2 * r, h: 2 * r });

  it("dense cluster: no overlaps, no box over a node, all in frame (#E7)", () => {
    const cands: LabelCandidate[] = [];
    for (let i = 0; i < 17; i++) cands.push({ id: `skill-${i}`, x: 150 + (i % 6) * 18, y: 120 + Math.floor(i / 6) * 18, r: 5 });
    const nodes = cands.map((c) => nodeBox(c));
    const out = placeLabels(cands, nodes, frame);
    const boxes = [...out.values()];
    expect(boxes.length).toBeGreaterThan(0);
    for (let i = 0; i < boxes.length; i++) {
      expect(inside(boxes[i], frame)).toBe(true);
      for (const n of nodes) expect(hit(boxes[i], n)).toBe(false);
      for (let j = i + 1; j < boxes.length; j++) expect(hit(boxes[i], boxes[j])).toBe(false);
    }
  });

  it("hovered placed first, may cover a node; conflicting selected hidden (#E8)", () => {
    // A 16 px tall frame leaves only the right/left anchors; nodes on both sides block the hovered label.
    const strip = { x: 0, y: 142, w: 400, h: 16 };
    const h = { id: "hovered-skill", x: 100, y: 150, r: 5, hovered: true };
    const sel = { id: "selected-skill", x: 150, y: 150, r: 5, selected: true };
    const nodes = [nodeBox(h), nodeBox({ x: 130, y: 150 }), nodeBox({ x: 70, y: 150 }), nodeBox(sel)];
    const out = placeLabels([sel, h], nodes, strip);
    const hb = out.get("hovered-skill") as Box;
    expect(out.has("hovered-skill")).toBe(true);
    expect(inside(hb, strip)).toBe(true);
    expect(nodes.some((n) => hit(hb, n))).toBe(true); // covers a node: allowed for hovered
    expect(out.has("selected-skill")).toBe(false);
  });

  it("hovered label is clamped inside the frame (#E9)", () => {
    const id = "x".repeat(19); // 19·6.3 + 2 ≈ 122 px
    const out = placeLabels([{ id, x: frame.w - 2, y: frame.h / 2, r: 5, hovered: true }], [], frame);
    const b = out.get(id) as Box;
    expect(out.has(id)).toBe(true);
    expect(inside(b, frame)).toBe(true);
  });

  it("no canvas: 6.3 px/char + 2 fallback, no throw, no overlaps (#X1)", async () => {
    vi.resetModules();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const fresh = await import("../graph-layout.js");
    const cands = [
      { id: "aaa", x: 100, y: 100, r: 5 },
      { id: "bbbbbb", x: 110, y: 100, r: 5 },
      { id: "cc", x: 100, y: 112, r: 5 },
    ];
    const out = fresh.placeLabels(cands, [], frame);
    for (const [id, b] of out) expect(b.w).toBeCloseTo(id.length * 6.3 + 2);
    const boxes = [...out.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(hit(boxes[i], boxes[j])).toBe(false);
    expect(boxes.every((b) => b.h === LABEL_H)).toBe(true);
    spy.mockRestore();
  });
});

describe("atlas simulation (#E4 #E5 #P1 #F5 #F6 #F13)", () => {
  it("presettle is deterministic for the 49-skill fixture (#E5)", () => {
    const a = createAtlasSimulation({ skills: fixture.skills, links: fixture.links });
    const b = createAtlasSimulation({ skills: fixture.skills, links: fixture.links });
    presettle(a);
    presettle(b);
    expect(a.nodes().map((n) => [n.id, n.x, n.y])).toEqual(b.nodes().map((n) => [n.id, n.x, n.y]));
  });

  it("no outline overlap on open: fixture and 150 two-skill forests (#E4)", () => {
    const sim = createAtlasSimulation({ skills: fixture.skills, links: fixture.links });
    presettle(sim);
    expect(drawnDiscsDisjoint(fixture.skills, fixture.links, sim)).toBe(true);
    const p = pairs(150);
    const sim2 = createAtlasSimulation(p);
    presettle(sim2);
    expect(drawnDiscsDisjoint(p.skills, p.links, sim2)).toBe(true);
  });

  it("presettle at 300 skills / 300 links stays in budget (#P1)", () => {
    const p = pairs(150);
    // 150 more links inside the pair set's id space keep 300 links total but add chains.
    const extra: SkillLink[] = [];
    for (let i = 0; i < 150; i++) extra.push(link(`p${String(i).padStart(3, "0")}b`, `p${String(i).padStart(3, "0")}a`, "shares-tool"));
    const times: number[] = [];
    for (let run = 0; run < 3; run++) {
      const sim = createAtlasSimulation({ skills: p.skills, links: [...p.links, ...extra] });
      const t0 = performance.now();
      presettle(sim);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    expect(times[1]).toBeLessThan(350);
  });

  /** a — b, a — c, optionally plus an unrelated pair x — y. */
  function small(withPair = false) {
    const skills = [node("a", 2), node("b", 1), node("c", 1), ...(withPair ? [node("x", 1), node("y", 1)] : [])];
    const links = [link("a", "b"), link("a", "c"), ...(withPair ? [link("x", "y")] : [])];
    const sim = createAtlasSimulation({ skills, links });
    presettle(sim);
    const byId = new Map(sim.nodes().map((n) => [n.id, n]));
    return { sim, byId };
  }

  it("neighbours follow a drag (#F5)", () => {
    const { sim, byId } = small();
    const a = byId.get("a") as SimNode;
    const b0 = byId.get("b")?.x as number;
    const c0 = byId.get("c")?.x as number;
    dragStart(sim, a);
    sim.stop();
    const target = { x: (a.x as number) + 60, y: a.y as number };
    dragMove(a, target);
    for (let i = 0; i < 30; i++) sim.tick();
    expect(a.x).toBe(target.x);
    expect(a.fx).toBe(target.x);
    expect(byId.get("b")?.x as number).toBeGreaterThan(b0);
    expect(byId.get("c")?.x as number).toBeGreaterThan(c0);
  });

  it("release settles gradually (#F6)", () => {
    const { sim, byId } = small();
    const a = byId.get("a") as SimNode;
    const rest = { x: a.x as number, y: a.y as number };
    dragStart(sim, a);
    sim.stop();
    dragMove(a, { x: rest.x + 60, y: rest.y });
    for (let i = 0; i < 30; i++) sim.tick();
    dragEnd(sim, a);
    expect(a.fx).toBe(null);
    expect(sim.alphaTarget()).toBe(0);
    const dist = () => Math.hypot((a.x as number) - rest.x, (a.y as number) - rest.y);
    const ds = [dist()];
    for (let i = 0; i < 4; i++) {
      sim.tick();
      ds.push(dist());
    }
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeLessThan(ds[i - 1]);
    expect(ds[1]).toBeGreaterThan(5); // not a single-tick arrival
  });

  it("a pinned node ignores forest separation (#F13)", () => {
    const { sim, byId } = small(true);
    const x = byId.get("x") as SimNode;
    const a = byId.get("a") as SimNode;
    const pin = { x: a.x as number, y: (a.y as number) + 8 }; // inside a's forest disc
    dragStart(sim, x);
    sim.stop();
    dragMove(x, pin);
    for (let i = 0; i < 20; i++) {
      sim.tick();
      expect([x.x, x.y]).toEqual([pin.x, pin.y]);
    }
  });
});

describe("dependency (#X2)", () => {
  it("d3-force and @types/d3-force are declared at ^3", () => {
    expect((pkg.dependencies as Record<string, string>)["d3-force"]).toMatch(/^\^3(\.|$)/);
    expect((pkg.devDependencies as Record<string, string>)["@types/d3-force"]).toMatch(/^\^3(\.|$)/);
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
