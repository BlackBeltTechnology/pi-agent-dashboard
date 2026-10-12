/**
 * Skill-atlas client UI. test-plan #E26 #E27 #E28 #E30 #F6 #F7 #F10 #X9 #X10
 * #X11 + folder menu registration. Harness: stub shell context from
 * packages/kb-plugin/src/client/__tests__/FolderKbSection.test.tsx; fetch mocked.
 * See change: add-skill-atlas-screen.
 */
import {
  createFolderMenuStore,
  CurrentPluginLayer,
  FolderMenuProvider,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { SkillGraphResponse, SkillLink, SkillNode } from "../../shared/types.js";
import { AtlasSummary } from "../AtlasSummary.js";
import { FolderAtlasMenu } from "../claims.js";
import { SkillAtlasPage } from "../SkillAtlasPage.js";

let ws: EventTarget;
beforeEach(() => {
  ws = new EventTarget();
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const node = (id: string, degree = 0, extra: Partial<SkillNode> = {}): SkillNode => ({
  id,
  description: `${id} desc`,
  filePath: `/repo/.pi/skills/${id}/SKILL.md`,
  origin: "project",
  degree,
  ...extra,
});
const ref = (source: string, target: string): SkillLink => ({ source, target, type: "references", why: `${source} names ${target} in its SKILL.md` });

function response(skills: SkillNode[], links: SkillLink[], extra: Partial<SkillGraphResponse> = {}): SkillGraphResponse {
  return { scope: "project", cwd: "/repo", fingerprint: "f", builtAt: 1, degraded: false, warnings: [], skills, links, ...extra };
}

/** Star: `hub` with 5 neighbours, mutual with `ship-it`; plus 85 isolated skills (91 total). */
function star(): SkillGraphResponse {
  const leaves = ["ship-it", "scenario-design", "doubt-driven-review", "ship-change", "review-code"];
  const links = [...leaves.map((l) => ref("plan-proposal", l)), ref("ship-it", "plan-proposal")];
  const degree = (id: string) => links.filter((l) => l.source === id || l.target === id).length;
  const skills = [
    node("plan-proposal", degree("plan-proposal")),
    ...leaves.map((l) => node(l, degree(l))),
    ...Array.from({ length: 85 }, (_, i) => node(`other-${String(i).padStart(2, "0")}`, 0, { origin: "global" })),
  ].sort((a, b) => (a.id < b.id ? -1 : 1));
  return response(skills, links);
}

function mockFetch(handler: (url: string) => { status?: number; body: unknown }) {
  const fn = vi.fn(async (url: string) => {
    const { status = 200, body } = handler(String(url));
    return { ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const okGraph = (g: SkillGraphResponse) => mockFetch(() => ({ body: { success: true, data: g } }));

function Shell({ children, path = "/folder/x/atlas" }: { children: React.ReactNode; path?: string }) {
  const { hook } = memoryLocation({ path, record: true });
  return (
    <PluginContextProvider send={() => {}} ws={ws as unknown as WebSocket} connectionStatus="connected">
      <Router hook={hook}>
        <CurrentPluginLayer pluginId="skill-atlas">{children}</CurrentPluginLayer>
      </Router>
    </PluginContextProvider>
  );
}

describe("AtlasSummary", () => {
  it("shows counts and top-5 hubs by degree (#E30)", async () => {
    okGraph(star());
    render(<Shell><AtlasSummary scope="project" cwd="/repo" /></Shell>);
    await screen.findByTestId("skill-atlas-summary");
    const hubs = screen.getAllByTestId(/^skill-atlas-hub-/).map((b) => b.getAttribute("data-testid"));
    expect(hubs[0]).toBe("skill-atlas-hub-plan-proposal");
    expect(hubs).toHaveLength(5);
  });

  it("renders nothing for an empty scope (#E30)", async () => {
    const f = okGraph(response([], []));
    const { container } = render(<Shell><AtlasSummary scope="global" /></Shell>);
    await waitFor(() => expect(f).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector("[data-testid^='skill-atlas-summary']")).toBeNull());
  });

  it("degraded scan shows a warning (#X9)", async () => {
    okGraph(response([node("aaaa-a", 1), node("aaaa-b", 1)], [ref("aaaa-a", "aaaa-b")], { degraded: true }));
    render(<Shell><AtlasSummary scope="project" cwd="/repo" /></Shell>);
    expect(await screen.findByTestId("skill-atlas-degraded")).toBeTruthy();
  });

  it("failed request shows an alert; Retry recovers (#X10)", async () => {
    let fail = true;
    mockFetch(() => (fail ? { status: 500, body: { success: false, error: "boom" } } : { body: { success: true, data: star() } }));
    render(<Shell><AtlasSummary scope="project" cwd="/repo" /></Shell>);
    const err = await screen.findByTestId("skill-atlas-summary-error");
    expect(within(err).getByRole("alert").textContent).toContain("boom");
    fail = false;
    fireEvent.click(within(err).getByRole("button"));
    expect(await screen.findByTestId("skill-atlas-summary")).toBeTruthy();
  });
});

describe("SkillAtlasPage", () => {
  it("1-hop focus hides cards and shows 'Showing 6 of 91' (#E27)", async () => {
    okGraph(star());
    render(<Shell path="/folder/x/atlas?sel=plan-proposal&hops=1"><SkillAtlasPage scope="project" cwd="/repo" onBack={() => {}} /></Shell>);
    await screen.findByTestId("skill-atlas-graph");
    fireEvent.click(screen.getByRole("tab", { name: "Cards" }));
    const cards = await screen.findByTestId("skill-atlas-cards");
    expect(within(cards).getAllByRole("button", { pressed: false }).length + within(cards).getAllByRole("button", { pressed: true }).length).toBe(6);
    expect(screen.getByTestId("skill-atlas-showing").textContent).toContain("Showing 6 of 91");
    fireEvent.click(within(screen.getByTestId("skill-atlas-showing")).getByRole("button"));
    expect(within(screen.getByTestId("skill-atlas-cards")).getAllByRole("button").length).toBe(91);
  });

  it("mutual reference shows once, marked ↔ (#E26)", async () => {
    okGraph(star());
    render(<Shell path="/folder/x/atlas?sel=plan-proposal"><SkillAtlasPage scope="project" cwd="/repo" onBack={() => {}} /></Shell>);
    const row = await screen.findByTestId("skill-atlas-neighbour-ship-it");
    expect(row.textContent).toContain("↔");
    expect(screen.getAllByTestId("skill-atlas-neighbour-ship-it")).toHaveLength(1);
  });

  it("above 300 skills the Graph tab is disabled and Cards list all (#E28)", async () => {
    const many = Array.from({ length: 301 }, (_, i) => node(`s-${String(i).padStart(3, "0")}`, 0, { origin: "global" }));
    okGraph(response(many, []));
    render(<Shell><SkillAtlasPage scope="global" onBack={() => {}} /></Shell>);
    expect(await screen.findByTestId("skill-atlas-too-many")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Graph" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(screen.getByTestId("skill-atlas-cards")).getAllByRole("button")).toHaveLength(301);
  });

  it("300 skills keeps the Graph tab enabled (#E28)", async () => {
    const many = Array.from({ length: 300 }, (_, i) => node(`s-${String(i).padStart(3, "0")}`, 0, { origin: "global" }));
    okGraph(response(many, []));
    render(<Shell><SkillAtlasPage scope="global" onBack={() => {}} /></Shell>);
    await screen.findByTestId("skill-atlas-graph");
    expect(screen.getByRole("tab", { name: "Graph" }).getAttribute("aria-disabled")).toBeNull();
  });

  it("graph keyboard: ArrowRight + Enter selects the most-connected skill; tabs move with arrows (#F6)", async () => {
    okGraph(star());
    render(<Shell><SkillAtlasPage scope="project" cwd="/repo" onBack={() => {}} /></Shell>);
    const svg = (await screen.findByTestId("skill-atlas-graph")).querySelector("svg") as SVGElement;
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    fireEvent.keyDown(svg, { key: "Enter" });
    expect((await screen.findByTestId("skill-atlas-detail")).textContent).toContain("plan-proposal");
    const graphTab = screen.getByRole("tab", { name: "Graph" });
    fireEvent.keyDown(graphTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Links" }).getAttribute("aria-selected")).toBe("true");
  });

  it("untrusted description renders as text (#F10)", async () => {
    const evil = '<img src=x onerror="window.__x=1">';
    okGraph(response([node("aaaa-a", 0, { description: evil })], []));
    render(<Shell path="/folder/x/atlas?sel=aaaa-a"><SkillAtlasPage scope="project" cwd="/repo" onBack={() => {}} /></Shell>);
    const detail = await screen.findByTestId("skill-atlas-detail");
    expect(detail.textContent).toContain(evil);
    expect(document.querySelector("img")).toBeNull();
    expect((window as unknown as { __x?: number }).__x).toBeUndefined();
  });

  it("refused SKILL.md open shows an inline error (#X11)", async () => {
    mockFetch((url) =>
      url.startsWith("/api/pi-resource-file") ? { status: 403, body: { success: false } } : { body: { success: true, data: star() } },
    );
    render(<Shell path="/folder/x/atlas?sel=plan-proposal"><SkillAtlasPage scope="project" cwd="/repo" onBack={() => {}} /></Shell>);
    fireEvent.click(await screen.findByRole("button", { name: "Open SKILL.md" }));
    expect(await screen.findByTestId("skill-atlas-open-error")).toBeTruthy();
  });

  it("change broadcast keeps the old graph with 'Updating…' until the refetch lands (#F7)", async () => {
    let release!: () => void;
    let calls = 0;
    const first = star();
    const second = response([...first.skills, node("zz-added", 0)], first.links);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls > 1) await new Promise<void>((r) => (release = r));
        const data = calls > 1 ? second : first;
        return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => ({ success: true, data }) } as Response;
      }),
    );
    render(<Shell path="/folder/x/atlas?sel=plan-proposal"><SkillAtlasPage scope="project" cwd="/repo" onBack={() => {}} /></Shell>);
    await screen.findByTestId("skill-atlas-detail");
    act(() => {
      ws.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "skill_atlas_changed", scope: "project", cwd: "/repo/" }) }));
    });
    await waitFor(() => expect(screen.getByTestId("skill-atlas-status").textContent).toContain("Updating"));
    expect(screen.getByTestId("skill-atlas-detail").textContent).toContain("plan-proposal");
    await act(async () => release());
    await waitFor(() => expect(screen.getByTestId("skill-atlas-status").textContent).toContain("Up to date"));
    expect(screen.getByTestId("skill-atlas-detail").textContent).toContain("plan-proposal");
  });
});

describe("FolderAtlasMenu", () => {
  it("registers an 'open' menu item for the folder; card placement registers nothing", () => {
    const store = createFolderMenuStore();
    render(
      <Shell>
        <FolderMenuProvider store={store}>
          <FolderAtlasMenu folder={{ cwd: "/repo" }} />
          <FolderAtlasMenu folder={{ cwd: "/wt" }} placement="card" />
        </FolderMenuProvider>
      </Shell>,
    );
    const items = store.getItems("/repo").filter((i) => i.id === "skill-atlas");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ group: "open", label: "Skill Atlas" });
    expect(store.getItems("/wt")).toHaveLength(0);
  });
});
