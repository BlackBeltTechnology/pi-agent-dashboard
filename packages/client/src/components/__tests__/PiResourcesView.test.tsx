import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiResourcesView } from "../PiResourcesView.js";

/**
 * The "Local" and "Global" scope sections render collapsed by default.
 * Expand the Local section so loose resources (skills/prompts) and packages
 * are visible to the test. The clickable button is the first descendant
 * button of the scope-local container.
 */
async function expandLocal() {
  const section = await screen.findByTestId("scope-local");
  const toggle = section.querySelector("button");
  if (toggle) fireEvent.click(toggle);
  // Expand every ResourceGroup (Skills / Extensions / Prompts) — they also
  // start collapsed. Each group has a single button that toggles visibility.
  const groupButtons = Array.from(section.querySelectorAll("button")).filter((b) => {
    const txt = b.textContent ?? "";
    return /^(Skills|Extensions|Prompts)/i.test(txt.trim());
  });
  for (const btn of groupButtons) fireEvent.click(btn);
}

async function expandLocalPackage() {
  await expandLocal();
  // Expand the first package inside the Local section
  const section = screen.getByTestId("scope-local");
  const pkgButton = Array.from(section.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("pi-web-access"),
  );
  if (pkgButton) fireEvent.click(pkgButton);
}

afterEach(() => cleanup());

const mockData: PiResourcesResult = {
  local: {
    extensions: [],
    skills: [
      { name: "code-review", description: "Review code quality.", filePath: "/project/.pi/skills/code-review/SKILL.md", type: "skill", enabled: true },
    ],
    prompts: [
      { name: "opsx-apply", description: "Apply changes.", filePath: "/project/.pi/prompts/opsx-apply.md", type: "prompt", enabled: true },
    ],
  },
  global: {
    extensions: [],
    skills: [],
    prompts: [],
  },
  packages: [
    {
      name: "pi-web-access",
      description: "Web search and fetch",
      source: "npm:pi-web-access",
      resources: {
        extensions: [{ name: "index", filePath: "/global/node_modules/pi-web-access/index.ts", type: "extension", enabled: true }],
        skills: [],
        prompts: [],
      },
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

describe("PiResourcesView", () => {
  it("renders header with folder name and back button", async () => {
    render(<PiResourcesView cwd="/path/to/project" onBack={vi.fn()} onViewFile={vi.fn()} />);
    expect(await screen.findByText(/Pi Resources: project/)).toBeTruthy();
    expect(screen.getByTestId("pi-resources-back")).toBeTruthy();
  });

  it("shows local skills and prompts", async () => {
    render(<PiResourcesView cwd="/path/to/project" onBack={vi.fn()} onViewFile={vi.fn()} />);
    await expandLocal();
    expect(await screen.findByText("code-review")).toBeTruthy();
    expect(screen.getByText("Review code quality.")).toBeTruthy();
    expect(screen.getByText("opsx-apply")).toBeTruthy();
  });

  it("shows global section as empty", async () => {
    render(<PiResourcesView cwd="/path/to/project" onBack={vi.fn()} onViewFile={vi.fn()} />);
    const globalSection = await screen.findByTestId("scope-global");
    // Expand Global section (collapsed by default) and confirm empty state
    const toggle = globalSection.querySelector("button");
    if (toggle) fireEvent.click(toggle);
    expect(globalSection.textContent).toContain("(none)");
  });

  it("shows packages", async () => {
    render(<PiResourcesView cwd="/path/to/project" onBack={vi.fn()} onViewFile={vi.fn()} />);
    // Packages with no scope (or scope='local') are merged into the Local section
    await expandLocal();
    const localSection = await screen.findByTestId("scope-local");
    expect(localSection.textContent).toContain("pi-web-access");
  });

  it("calls onViewFile when resource item is clicked", async () => {
    const onViewFile = vi.fn();
    render(<PiResourcesView cwd="/path/to/project" onBack={vi.fn()} onViewFile={onViewFile} />);
    await expandLocal();
    await screen.findByText("code-review");
    const items = screen.getAllByTestId("resource-item");
    items[0].click();
    expect(onViewFile).toHaveBeenCalledWith("/project/.pi/skills/code-review/SKILL.md", "code-review");
  });

  it("calls onBack when back button is clicked", async () => {
    const onBack = vi.fn();
    render(<PiResourcesView cwd="/path/to/project" onBack={onBack} onViewFile={vi.fn()} />);
    await screen.findByTestId("pi-resources-back");
    screen.getByTestId("pi-resources-back").click();
    expect(onBack).toHaveBeenCalled();
  });

  // Pin spec scenario "Loose resources still render as tree" — ensures a future
  // refactor that removes <MergedScopeSection> in favor of the new
  // <InstalledPackagesList> alone is caught by tests. See change:
  // unify-package-management-ui.
  it("keeps loose resources outside the package tree", async () => {
    render(<PiResourcesView cwd="/path/to/project" onBack={vi.fn()} onViewFile={vi.fn()} />);
    await expandLocal();

    // Loose skill is rendered inside the merged scope's tree (resource-item).
    const looseSkill = await screen.findByText("code-review");
    expect(looseSkill.closest('[data-testid="resource-item"]')).toBeTruthy();

    // The unified package list section is mounted alongside.
    expect(screen.getByTestId("installed-packages-local-section")).toBeTruthy();
  });
});
