/**
 * SkillGraphView interaction model. test-plan #E6 #E10–#E16 #F1–#F4 #F7–#F12 #X3.
 * Harness: shell context + ResizeObserver stub from atlas-ui.test.tsx; the
 * `onSimulation` seam exposes the d3 simulation for manual ticks.
 * See change: add-skill-atlas-forest-aura.
 */
import { CurrentPluginLayer, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalog } from "../../i18n.js";
import type { SkillLink, SkillLinkType, SkillNode, SkillOrigin } from "../../shared/types.js";
import type { AtlasSimulation } from "../atlas-simulation.js";
import { SkillGraphView } from "../SkillGraphView.js";

let roCallbacks: ResizeObserverCallback[] = [];
let reduce = true;
beforeEach(() => {
  roCallbacks = [];
  reduce = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: ResizeObserverCallback) {
        roCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") ? reduce : false, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const resize = (w: number, h: number) =>
  act(() => {
    for (const cb of roCallbacks) cb([{ contentRect: { width: w, height: h } } as ResizeObserverEntry], {} as ResizeObserver);
  });

const node = (id: string, degree: number, origin: SkillOrigin = "global"): SkillNode => ({ id, description: "", filePath: "", origin, degree });
const link = (source: string, target: string, type: SkillLinkType = "references"): SkillLink => ({ source, target, type, why: "" });

/** Forest A (5, references chain), forest B (3, bundle), two singletons. */
const ALL_LINKS = [link("a1", "a2"), link("a2", "a3"), link("a3", "a4"), link("a4", "a5"), link("b1", "b2", "bundle"), link("b2", "b3", "bundle")];
const deg = (id: string) => ALL_LINKS.filter((l) => l.source === id || l.target === id).length;
const ALL_SKILLS = ["a1", "a2", "a3", "a4", "a5", "b1", "b2", "b3", "s1", "s2"].map((id) => node(id, deg(id), id === "a2" ? "package" : "global"));
const ALL_REL: SkillLinkType[] = ["references", "bundle", "shares-tool"];

interface Opts {
  skills?: SkillNode[];
  links?: SkillLink[];
  relations?: SkillLinkType[];
  selected?: string | null;
  hops?: number;
  origins?: SkillOrigin[];
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <PluginContextProvider send={() => {}} ws={new EventTarget() as unknown as WebSocket} connectionStatus="connected">
      <CurrentPluginLayer pluginId="skill-atlas">{children}</CurrentPluginLayer>
    </PluginContextProvider>
  );
}

function setup(initial: Opts = {}) {
  const onSelect = vi.fn();
  const sims: AtlasSimulation[] = [];
  const onSimulation = (s: AtlasSimulation) => {
    if (!sims.includes(s)) sims.push(s);
  };
  const el = (o: Opts) => {
    const allSkills = o.skills ?? ALL_SKILLS;
    const allLinks = o.links ?? ALL_LINKS;
    const relations = o.relations ?? ALL_REL;
    const origins = o.origins ?? ["project", "global", "package"];
    const skills = allSkills.filter((s) => origins.includes(s.origin));
    const ids = new Set(skills.map((s) => s.id));
    const links = allLinks.filter((l) => relations.includes(l.type) && ids.has(l.source) && ids.has(l.target));
    return (
      <Shell>
        <SkillGraphView
          allSkills={allSkills}
          allLinks={allLinks}
          skills={skills}
          links={links}
          relations={relations}
          selected={o.selected ?? null}
          hops={o.hops ?? 0}
          matches={() => true}
          query=""
          onSelect={onSelect}
          onSimulation={onSimulation}
        />
      </Shell>
    );
  };
  let current = initial;
  const r = render(el(initial));
  return {
    onSelect,
    sims,
    sim: () => sims[sims.length - 1],
    rerender: (o: Opts) => {
      current = { ...current, ...o };
      r.rerender(el(current));
    },
  };
}

const svg = () => screen.getByTestId("skill-atlas-graph").querySelector("svg") as SVGSVGElement;
const cam = () => svg().getAttribute("data-view");
const nodeEl = (id: string) => screen.getByTestId(`skill-atlas-node-${id}`);
const outline = (firstId: string) => screen.getByTestId(`skill-atlas-forest-${firstId}`);
const chip = () => screen.queryByTestId("skill-atlas-forest-chip");
const press = (target: Element, dx: number, dy = 0, end: "up" | "none" = "up") => {
  fireEvent.pointerDown(target, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
  if (dx || dy) fireEvent.pointerMove(svg(), { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
  if (end === "up") fireEvent.pointerUp(svg(), { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
};
const simNode = (sim: AtlasSimulation, id: string) => sim.nodes().find((n) => n.id === id);
const tickAndRender = (sim: AtlasSimulation) => {
  sim.tick();
  act(() => {
    sim.on("tick")?.call(sim);
  });
};

describe("dots (#E6)", () => {
  it("same outline r=5 for every origin; inner mark tells origin", () => {
    setup({ skills: [node("g", 0, "global"), node("p", 0, "package"), node("j", 0, "project")], links: [] });
    for (const id of ["g", "p", "j"]) {
      const shapes = nodeEl(id).querySelectorAll(".atlas-shape");
      expect(shapes).toHaveLength(1);
      expect(shapes[0].getAttribute("r")).toBe("5");
    }
    expect(nodeEl("g").querySelectorAll(".atlas-mark")).toHaveLength(0);
    const pkg = nodeEl("p").querySelector(".atlas-mark") as Element;
    expect(pkg.getAttribute("r")).toBe("1.5");
    expect(pkg.getAttribute("fill")).toBe("var(--text-secondary)");
    const prj = nodeEl("j").querySelector(".atlas-mark") as Element;
    expect(Number(prj.getAttribute("r"))).toBeCloseTo(3.1);
    expect(prj.getAttribute("fill")).toBe("none");
    expect(prj.getAttribute("stroke")).toBe("var(--accent-green-text)");
  });
});

describe("click vs drag (#E10 #F7)", () => {
  it("3 px selects once and never pins; 4 px pins and does not select (#E10)", () => {
    const g = setup();
    press(nodeEl("a3"), 3, 0, "none");
    expect(simNode(g.sim(), "a3")?.fx ?? null).toBeNull();
    fireEvent.pointerUp(svg(), { clientX: 103, clientY: 100, pointerId: 1 });
    expect(g.onSelect).toHaveBeenCalledTimes(1);
    expect(g.onSelect).toHaveBeenCalledWith("a3");
    g.onSelect.mockClear();
    press(nodeEl("a3"), 4, 0, "none");
    expect(simNode(g.sim(), "a3")?.fx).not.toBeNull();
    fireEvent.pointerUp(svg(), { clientX: 104, clientY: 100, pointerId: 1 });
    expect(g.onSelect).not.toHaveBeenCalled();
    expect(simNode(g.sim(), "a3")?.fx).toBeNull();
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)("%s releases the drag (#F7)", (ev) => {
    const g = setup();
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 4242);
    const caf = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    press(nodeEl("a3"), 10, 0, "none");
    expect(simNode(g.sim(), "a3")?.fx).not.toBeNull();
    expect(raf).toHaveBeenCalled();
    fireEvent[ev](svg(), { pointerId: 1 });
    expect(simNode(g.sim(), "a3")?.fx).toBeNull();
    expect(g.sim().alphaTarget()).toBe(0);
    expect(caf).toHaveBeenCalledWith(4242);
  });
});

describe("forest zoom (#E11 #E12 #F1–#F4)", () => {
  it("outline click (3 px) zooms; 30 px pans and does not zoom (#E11)", () => {
    setup();
    const before = cam();
    press(outline("a1"), 3);
    expect(chip()?.textContent).toContain("Group: 5 skills");
    expect(cam()).not.toBe(before);
    cleanup();
    setup();
    const [k, x, y] = (cam() as string).split(",").map(Number);
    press(outline("a1"), 30);
    expect(chip()).toBeNull();
    const [k2, x2, y2] = (cam() as string).split(",").map(Number);
    expect([k2, x2 - x, y2 - y]).toEqual([k, 30, 0]);
  });

  it("clicking another outline switches forest (#E12)", () => {
    setup();
    press(outline("a1"), 0);
    press(outline("b1"), 0);
    expect(chip()?.textContent).toContain("Group: 3 skills");
    expect(Number(nodeEl("a1").getAttribute("opacity"))).toBeLessThan(1);
    expect(Number(nodeEl("b1").getAttribute("opacity"))).toBe(1);
  });

  it("Escape leaves zoom first, then clears the selection (#F1)", () => {
    const g = setup({ selected: "a3" });
    press(outline("a1"), 0);
    expect(chip()).not.toBeNull();
    fireEvent.keyDown(svg(), { key: "Escape" });
    expect(chip()).toBeNull();
    expect(Number(nodeEl("b1").getAttribute("opacity"))).toBe(1);
    expect(g.onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(svg(), { key: "Escape" });
    expect(g.onSelect).toHaveBeenCalledWith(null);
  });

  it("Escape right after a pointer zoom reaches the graph (#F2)", () => {
    setup();
    press(outline("a1"), 0);
    expect(document.activeElement).toBe(svg());
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(chip()).toBeNull();
  });

  it("Show all is a keyboard-reachable button (#F3)", () => {
    setup();
    press(outline("a1"), 0);
    const btn = within(chip() as HTMLElement).getByRole("button", { name: "Show all" });
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.tabIndex).toBeGreaterThanOrEqual(0);
    fireEvent.click(btn);
    expect(chip()).toBeNull();
  });

  it("a click on empty space returns to the whole graph (#F4)", () => {
    setup();
    press(outline("a1"), 0);
    press(svg(), 2);
    expect(chip()).toBeNull();
    for (const id of ["a1", "b1", "s1"]) expect(Number(nodeEl(id).getAttribute("opacity"))).toBe(1);
  });
});

describe("camera (#E13–#E16 #F8)", () => {
  it("resize refits until the user zooms (#E13)", () => {
    setup();
    resize(800, 600);
    const t0 = cam();
    resize(1000, 700);
    const t1 = cam();
    expect(t1).not.toBe(t0);
    fireEvent.wheel(svg(), { deltaY: -100, clientX: 400, clientY: 300 });
    const t2 = cam();
    resize(900, 600);
    expect(cam()).toBe(t2);
  });

  it("Fit clears userMoved: a later resize refits (#E14)", () => {
    setup();
    resize(800, 600);
    press(svg(), 50);
    fireEvent.click(screen.getByRole("button", { name: "Fit graph" }));
    resize(1000, 700);
    const after = cam();
    cleanup();
    setup();
    resize(1000, 700);
    expect(after).toBe(cam());
  });

  it("selection keeps the camera (#E15)", () => {
    const g = setup({ selected: "a1" });
    const t0 = cam();
    g.rerender({ selected: "b2" });
    expect(cam()).toBe(t0);
  });

  it("focus change refits to the hop set (#E16)", () => {
    const g = setup({ selected: "a3" });
    const [k0] = (cam() as string).split(",").map(Number);
    g.rerender({ hops: 1 });
    const [k1, x, y] = (cam() as string).split(",").map(Number);
    expect(k1).toBeGreaterThan(k0);
    for (const id of ["a2", "a3", "a4"]) {
      const n = simNode(g.sim(), id);
      const sx = (n?.x ?? 0) * k1 + x;
      const sy = (n?.y ?? 0) * k1 + y;
      expect(sx).toBeGreaterThan(0);
      expect(sx).toBeLessThan(900);
      expect(sy).toBeGreaterThan(0);
      expect(sy).toBeLessThan(600);
    }
  });

  it("re-settle after a relation toggle keeps the camera every tick (#F8)", () => {
    reduce = false;
    const g = setup();
    const t0 = cam();
    const b1 = nodeEl("b1").getAttribute("transform");
    g.rerender({ relations: ["references", "shares-tool"] });
    const sim = g.sim();
    sim.stop();
    let moved = false;
    for (let i = 0; i < 40; i++) {
      tickAndRender(sim);
      expect(cam()).toBe(t0);
      if (nodeEl("b1").getAttribute("transform") !== b1) moved = true;
    }
    expect(moved).toBe(true);
  });
});

describe("reduced motion, idle, filters (#F9 #F10 #F11 #F12)", () => {
  it("reduced motion: forest fit and re-settle land in one step (#F9)", () => {
    const g = setup();
    const restart = vi.spyOn(g.sim(), "restart");
    const before = cam();
    press(outline("a1"), 0);
    expect(cam()).not.toBe(before);
    const b2 = nodeEl("b2").getAttribute("transform");
    g.rerender({ relations: ["references", "shares-tool"] });
    expect(restart).not.toHaveBeenCalled();
    expect(g.sim().alpha()).toBeLessThan(g.sim().alphaMin());
    expect(nodeEl("b2").getAttribute("transform")).not.toBe(b2);
  });

  it("idle at rest; hidden stops ticking, visible resumes (#F10)", async () => {
    reduce = false;
    const g = setup();
    const sim = g.sim();
    let ticks = 0;
    sim.on("tick.count", () => ticks++);
    await new Promise((r) => setTimeout(r, 300));
    expect(ticks).toBe(0);

    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    g.rerender({ relations: ["references", "shares-tool"] });
    const stop = vi.spyOn(sim, "stop");
    const restart = vi.spyOn(sim, "restart");
    hidden = true;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(stop).toHaveBeenCalled();
    ticks = 0;
    await new Promise((r) => setTimeout(r, 150));
    expect(ticks).toBe(0);
    hidden = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(restart).toHaveBeenCalled();
    await vi.waitFor(() => expect(ticks).toBeGreaterThan(0));
    sim.stop();
    delete (document as { hidden?: boolean }).hidden;
  });

  it("origin toggle hides nodes without re-layout (#F11)", () => {
    const g = setup();
    const restart = vi.spyOn(g.sim(), "restart");
    const before = ["a1", "a3", "b1", "s1"].map((id) => nodeEl(id).getAttribute("transform"));
    g.rerender({ origins: ["project", "global"] });
    expect(screen.queryByTestId("skill-atlas-node-a2")).toBeNull();
    expect(["a1", "a3", "b1", "s1"].map((id) => nodeEl(id).getAttribute("transform"))).toEqual(before);
    expect(restart).not.toHaveBeenCalled();
    expect(g.sims).toHaveLength(1);
  });

  it("live update: survivors start from previous positions (#F12)", () => {
    const g = setup();
    const old = new Map(g.sim().nodes().map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
    g.rerender({ skills: [...ALL_SKILLS, node("zz", 0)], links: [...ALL_LINKS] });
    expect(g.sims).toHaveLength(2);
    expect(nodeEl("zz")).toBeTruthy();
    for (const n of g.sim().nodes()) {
      const p = old.get(n.id);
      if (!p) continue;
      expect(Math.hypot((n.x ?? 0) - p.x, (n.y ?? 0) - p.y)).toBeLessThan(40);
    }
  });
});

describe("i18n (#X3)", () => {
  it("zh-CN and hu share one key set incl. the forest strings", () => {
    const zh = Object.keys(catalog["zh-CN"]).sort();
    expect(Object.keys(catalog.hu).sort()).toEqual(zh);
    for (const k of ["groupChip", "showAll", "outlineTitle"]) expect(zh).toContain(k);
  });
});
