import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiResourcesView } from "../PiResourcesView.js";

afterEach(() => cleanup());

const mockData: PiResourcesResult = {
  local: {
    extensions: [],
    skills: [
      { name: "code-review", description: "Review code", filePath: "/p/.pi/skills/code-review/SKILL.md", type: "skill", enabled: true },
    ],
    prompts: [],
  },
  global: { extensions: [], skills: [], prompts: [] },
  packages: [
    {
      name: "pi-flows",
      description: "Flows",
      source: "npm:pi-flows",
      scope: "local",
      resources: {
        extensions: [{ name: "flow-runner", filePath: "/p/.pi/extensions/flow-runner.ts", type: "extension", enabled: true }],
        skills: [
          { name: "skill-a", filePath: "/p/skills/a/SKILL.md", type: "skill", enabled: true },
          { name: "skill-b", filePath: "/p/skills/b/SKILL.md", type: "skill", enabled: true },
        ],
        prompts: [],
      },
    },
    {
      // Library-only package: contributes ZERO resources.
      // Per spec, no nested 📦 row should render for it.
      name: "library-only",
      description: "No resources",
      source: "/abs/path/library-only",
      scope: "local",
      resources: { extensions: [], skills: [], prompts: [] },
    },
  ],
};

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    json: () => Promise.resolve({ success: true, data: mockData }),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function expandLocalScope() {
  const section = await screen.findByTestId("scope-local");
  const toggle = section.querySelector("button");
  if (toggle) fireEvent.click(toggle);
  return section;
}

describe("PiResourcesView — Resources tab (unify-workspace-package-management)", () => {
  it("renames the first tab from 'Installed' to 'Resources'", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    await screen.findByTestId("resources-tab-bar");
    // Tab buttons: first one says "Resources" (was "Installed"), second says "Packages".
    const tabBar = screen.getByTestId("resources-tab-bar");
    const tabButtons = tabBar.querySelectorAll("button");
    expect(tabButtons.length).toBe(2);
    expect(tabButtons[0].textContent).toContain("Resources");
    expect(tabButtons[0].textContent).not.toContain("Installed");
    expect(tabButtons[1].textContent).toContain("Packages");
  });

  it("renders loose .pi/ skills under the Local scope", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    await expandLocalScope();
    // Skills group is collapsed by default — open it.
    const section = screen.getByTestId("scope-local");
    const groupBtns = Array.from(section.querySelectorAll("button"));
    const skillsBtn = groupBtns.find((b) => /^Skills/i.test(b.textContent?.trim() ?? ""));
    if (skillsBtn) fireEvent.click(skillsBtn);
    expect(await screen.findByText("code-review")).toBeTruthy();
  });

  it("renders the 📦 package collapsible for packages that contribute resources", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    const section = await expandLocalScope();
    expect(section.textContent).toContain("pi-flows");
  });

  it("does NOT render a 📦 row for packages with zero contributed resources (library-only)", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    const section = await expandLocalScope();
    expect(section.textContent).not.toContain("library-only");
  });

  it("does NOT render any Uninstall affordance in the Resources tab", async () => {
    render(<PiResourcesView cwd="/p" onBack={vi.fn()} onViewFile={vi.fn()} />);
    await expandLocalScope();
    // No button labelled "Uninstall" should exist anywhere in the Resources tab DOM.
    const uninstall = screen.queryAllByText(/Uninstall/i);
    expect(uninstall.length).toBe(0);
  });
});
