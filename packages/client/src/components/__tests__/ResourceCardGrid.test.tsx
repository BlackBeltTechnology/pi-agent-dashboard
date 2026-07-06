/**
 * ResourceCardGrid — flattening, search filter, scope segmented control.
 * See change: resources-card-tabs.
 */

import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResourceCardGrid } from "../ResourceCardGrid.js";

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
  },
  global: {
    extensions: [],
    skills: [
      { name: "a11y", description: "Accessibility.", filePath: "/g/.pi/agent/skills/a11y.md", type: "skill", enabled: true },
    ],
    prompts: [],
    agents: [],
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
