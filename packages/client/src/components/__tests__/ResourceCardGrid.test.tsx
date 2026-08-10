/**
 * ResourceCardGrid — flattening, search filter, scope segmented control.
 * See change: resources-card-tabs.
 */

import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceCardGrid } from "../resource/ResourceCardGrid.js";

afterEach(() => cleanup());

const data: PiResourcesResult = {
  local: {
    extensions: [],
    skills: [
      { name: "code-review", description: "Review code.", filePath: "/p/.pi/skills/code-review.md", type: "skill", enabled: true },
      { name: "faq-mine", description: "Mine the FAQ.", filePath: "/p/.pi/skills/faq-mine.md", type: "skill", enabled: true },
    ],
    prompts: [],
    agents: [],
    themes: [],
  },
  global: {
    extensions: [],
    skills: [
      { name: "a11y", description: "Accessibility.", filePath: "/g/.pi/agent/skills/a11y.md", type: "skill", enabled: true },
    ],
    prompts: [],
    agents: [],
    themes: [],
  },
  packages: [
    {
      name: "opsx",
      source: "npm:opsx",
      scope: "local",
      resources: {
        extensions: [],
        skills: [{ name: "openspec-explore", description: "Explore.", filePath: "/p/.pi/skills/openspec-explore.md", type: "skill", enabled: true }],
        prompts: [],
        agents: [],
        themes: [],
      },
    },
  ],
};

describe("ResourceCardGrid", () => {
  it("renders only cards of the requested type across local+global+packages", () => {
    render(<ResourceCardGrid data={data} type="skill" scopes={["local", "global"]} showScopeFilter onView={vi.fn()} />);
    // 2 local loose + 1 package (local) + 1 global = 4
    expect(screen.getAllByTestId("resource-card").length).toBe(4);
  });

  it("search filter narrows the rendered cards by name/description", () => {
    render(<ResourceCardGrid data={data} type="skill" scopes={["local", "global"]} showScopeFilter onView={vi.fn()} />);
    fireEvent.change(screen.getByTestId("resource-search"), { target: { value: "faq" } });
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("faq-mine");
  });

  it("scope filter narrows to the selected scope", () => {
    render(<ResourceCardGrid data={data} type="skill" scopes={["local", "global"]} showScopeFilter onView={vi.fn()} />);
    const filter = screen.getByTestId("resource-scope-filter");
    fireEvent.click(filter.querySelectorAll("button")[2]); // Global
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("a11y");
  });

  it("hides the scope filter and shows only global cards for a global-only mount", () => {
    render(<ResourceCardGrid data={data} type="skill" scopes={["global"]} showScopeFilter={false} onView={vi.fn()} />);
    expect(screen.queryByTestId("resource-scope-filter")).toBeNull();
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("a11y");
  });

  it("shows an empty state when the type has no resources", () => {
    render(<ResourceCardGrid data={data} type="theme" scopes={["local", "global"]} showScopeFilter onView={vi.fn()} />);
    expect(screen.getByTestId("resource-grid-empty")).toBeTruthy();
    expect(screen.queryAllByTestId("resource-card").length).toBe(0);
  });
});

// ── Provenance ──────────────────────────────────────────────────────
// See change: fix-skill-discovery-parity (test-plan F1, F2, F3, F4, F5, F6, F8).

const emptyScope = { extensions: [], skills: [], prompts: [], agents: [], themes: [] };

function provenanceData(overrides: Partial<PiResourcesResult> = {}): PiResourcesResult {
  return {
    local: {
      ...emptyScope,
      skills: [
        { name: "act-1", filePath: "/p/a1/SKILL.md", type: "skill", enabled: true, status: "active" },
        { name: "act-2", filePath: "/p/a2/SKILL.md", type: "skill", enabled: true, status: "active" },
        { name: "act-3", filePath: "/p/a3/SKILL.md", type: "skill", enabled: true, status: "active" },
        { name: "miss-1", filePath: "/p/m1/SKILL.md", type: "skill", enabled: true, status: "not-loaded" },
        { name: "miss-2", filePath: "/p/m2/SKILL.md", type: "skill", enabled: true, status: "not-loaded" },
        {
          name: "hermes",
          filePath: "/h/.pi/agent/pi-hermes-memory/skills/x/SKILL.md",
          type: "skill",
          enabled: true,
          status: "loaded-elsewhere",
          sessionPath: "/h/.pi/agent/pi-hermes-memory/skills/x/SKILL.md",
        },
      ],
    },
    global: { ...emptyScope },
    packages: [],
    contributingSession: { sessionId: "s1", cwd: "/p", differsFromFolder: false },
    ...overrides,
  };
}

function renderGrid(data: PiResourcesResult) {
  return render(<ResourceCardGrid data={data} type="skill" scopes={["local", "global"]} showScopeFilter onView={vi.fn()} />);
}

describe("ResourceCardGrid provenance", () => {
  it("badges not-loaded and loaded-elsewhere, but never active (F1)", () => {
    renderGrid(provenanceData());
    const badges = screen.getAllByTestId("badge-provenance");
    expect(badges.length).toBe(3);
    expect(badges.map((b) => b.getAttribute("data-provenance")).sort()).toEqual([
      "loaded-elsewhere",
      "not-loaded",
      "not-loaded",
    ]);
    // The three `active` cards carry none.
    expect(screen.getAllByTestId("resource-card").length).toBe(6);
  });

  it("keeps one flat grid with no provenance section, group header, or chevron (F2)", () => {
    const { container } = renderGrid(provenanceData());
    expect(container.querySelectorAll('[data-testid="resource-card-grid"]').length).toBe(1);
    expect(container.querySelectorAll("details, summary").length).toBe(0);
    expect(container.querySelectorAll("h1, h2, h3, h4, h5, h6").length).toBe(0);
  });

  it("narrows the grid to a single card via the provenance filter (F3)", () => {
    renderGrid(provenanceData());
    const filter = screen.getByTestId("resource-provenance-filter");
    fireEvent.click(filter.querySelector('[data-provenance="loaded-elsewhere"]') as Element);
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("hermes");
  });

  it("shows the session-reported path on a loaded-elsewhere card (F4)", () => {
    renderGrid(provenanceData());
    const paths = screen.getAllByTestId("resource-card-session-path");
    expect(paths.length).toBe(1);
    expect(paths[0].textContent).toContain("pi-hermes-memory");
  });

  it("shows the session working directory when it differs from the folder (F8, 5.4)", () => {
    renderGrid(
      provenanceData({ contributingSession: { sessionId: "s1", cwd: "/p/.worktrees/os-x", differsFromFolder: true } }),
    );
    const cwds = screen.getAllByTestId("resource-card-session-cwd");
    expect(cwds.length).toBe(2); // one per not-loaded card
    expect(cwds[0].textContent).toContain("/p/.worktrees/os-x");
  });

  it("renders scan-only explicitly with no not-loaded badges (F5)", () => {
    const data = provenanceData({ scanOnly: true, contributingSession: undefined });
    for (const s of data.local.skills) s.status = undefined;
    renderGrid(data);
    expect(screen.getByTestId("resource-grid-scan-only")).toBeTruthy();
    expect(screen.queryAllByTestId("badge-provenance").length).toBe(0);
    expect(screen.queryByTestId("resource-provenance-filter")).toBeNull();
  });

  it("renders degraded explicitly with no not-loaded badges (F6)", () => {
    const data = provenanceData({ degraded: true, contributingSession: undefined });
    for (const s of data.local.skills) s.status = undefined;
    renderGrid(data);
    expect(screen.getByTestId("resource-grid-degraded")).toBeTruthy();
    expect(screen.queryAllByTestId("badge-provenance").length).toBe(0);
    expect(screen.queryByTestId("resource-provenance-filter")).toBeNull();
  });

  it("renders resolver-sourced themes on the themes grid (5.6)", () => {
    const data: PiResourcesResult = {
      local: { ...emptyScope, themes: [{ name: "midnight", filePath: "/p/themes/midnight.json", type: "theme", enabled: true }] },
      global: { ...emptyScope },
      packages: [],
    };
    render(<ResourceCardGrid data={data} type="theme" scopes={["local", "global"]} showScopeFilter onView={vi.fn()} />);
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("midnight");
  });
});
