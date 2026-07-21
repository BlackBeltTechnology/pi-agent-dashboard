/**
 * Directory Settings page tests — Part 1 of
 * change: directory-settings-page-and-scoped-md-editing.
 *
 * Covers: nav rail rendering, page-prop → content switching, nav-click →
 * URL update, and the legacy /pi-resources → /settings/packages redirect
 * (verified at the wouter routing-primitive level — App.tsx mounts this same
 * <Redirect> branch).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Redirect, Route, Router, Switch, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { decodeFolderPath, encodeFolderPath } from "../../lib/util/folder-encoding.js";
import { buildFolderSettingsUrl } from "../../lib/nav/route-builders.js";
import { DirectorySettings } from "../DirectorySettings/DirectorySettings.js";

const CWD = "/path/to/project";
const ENC = encodeFolderPath(CWD);

function LocationDisplay() {
  const [loc] = useLocation();
  return <div data-testid="loc">{loc}</div>;
}

beforeEach(() => {
  // Permissive fetch so the packages/resources pages' hooks resolve without
  // throwing. Shape covers usePiResources + useInstalledPackages + search.
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      success: true,
      data: {
        local: {
          extensions: [],
          skills: [{ name: "local-skill", description: "A local skill.", filePath: "/path/to/project/.pi/skills/local-skill.md", type: "skill", enabled: true }],
          prompts: [],
          agents: [{ name: "react-expert", description: "React.", filePath: "/path/to/project/.pi/agents/react-expert.md", type: "agent", enabled: true, model: "sonnet", tools: "edit,read" }],
        },
        global: { extensions: [], skills: [], prompts: [], agents: [] },
        packages: [],
      },
    }),
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

function renderAt(page: "instructions" | "packages" | "skills" | "agents", path = buildFolderSettingsUrl(CWD, page)) {
  const { hook, history } = memoryLocation({ path, record: true });
  const utils = render(
    <Router hook={hook}>
      <DirectorySettings cwd={CWD} page={page} onBack={vi.fn()} onViewFile={vi.fn()} />
    </Router>,
  );
  return { ...utils, history };
}

describe("DirectorySettings", () => {
  it("renders the shell: root, nav rail, title, cwd crumb", () => {
    renderAt("instructions");
    expect(screen.getByTestId("directory-settings")).toBeTruthy();
    expect(screen.getByTestId("directory-settings-nav")).toBeTruthy();
    expect(screen.getByText("Directory Settings")).toBeTruthy();
    expect(screen.getByText(CWD)).toBeTruthy();
  });

  it("renders the nav with a RESOURCES group of five per-type items and no combined Resources item", () => {
    renderAt("instructions");
    const nav = screen.getByTestId("directory-settings-nav");
    for (const label of ["Instructions", "Packages", "Skills", "Agents", "Extensions", "Prompts", "Themes"]) {
      expect(nav.textContent).toContain(label);
    }
    // The former combined "Resources" page is gone (it is now a group header only).
    expect(screen.queryByRole("button", { name: /^Resources$/ })).toBeNull();
  });

  it("mounts the Instructions editing surface on the instructions page", () => {
    renderAt("instructions");
    // Part 2 replaced the placeholder with the real InstructionsPage (scoped
    // markdown editor). It mounts the file picker + editor scaffold.
    expect(screen.getByTestId("instructions-page")).toBeTruthy();
    expect(screen.queryByTestId("directory-settings-packages")).toBeNull();
    expect(screen.queryByTestId("resource-grid-panel")).toBeNull();
  });

  it("renders the packages surface on the packages page", () => {
    renderAt("packages");
    expect(screen.getByTestId("directory-settings-packages")).toBeTruthy();
  });

  it("renders only skill cards on the Skills page", async () => {
    renderAt("skills");
    const grid = await screen.findByTestId("resource-card-grid");
    expect(grid.getAttribute("data-type")).toBe("skill");
    const cards = screen.getAllByTestId("resource-card");
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain("local-skill");
    // Directory Settings shows the scope filter.
    expect(screen.getByTestId("resource-scope-filter")).toBeTruthy();
  });

  it("renders agent cards with model/tools badges and no toggle on the Agents page", async () => {
    renderAt("agents");
    const grid = await screen.findByTestId("resource-card-grid");
    expect(grid.getAttribute("data-type")).toBe("agent");
    expect(screen.getByTestId("badge-model").textContent).toContain("sonnet");
    expect(screen.queryByTestId("resource-activation-toggle")).toBeNull();
  });

  it("marks the active nav item with aria-current", () => {
    renderAt("skills");
    const active = screen.getByRole("button", { name: /Skills/ });
    expect(active.getAttribute("aria-current")).toBe("page");
  });

  it("navigates to /folder/<enc>/settings/<page> when a nav item is clicked", () => {
    const { history } = renderAt("instructions");
    fireEvent.click(screen.getByRole("button", { name: /Agents/ }));
    expect(history[history.length - 1]).toBe(`/folder/${ENC}/settings/agents`);

    fireEvent.click(screen.getByRole("button", { name: /Packages/ }));
    expect(history[history.length - 1]).toBe(`/folder/${ENC}/settings/packages`);
  });
});

describe("legacy /pi-resources redirect", () => {
  it("redirects /folder/:cwd/pi-resources → /folder/:cwd/settings/packages", () => {
    const { hook } = memoryLocation({ path: `/folder/${ENC}/pi-resources` });
    render(
      <Router hook={hook}>
        <Switch>
          <Route path="/folder/:encodedCwd/pi-resources">
            {(params) => {
              const cwd = decodeFolderPath(params.encodedCwd ?? "") ?? "";
              return <Redirect to={buildFolderSettingsUrl(cwd, "packages")} replace />;
            }}
          </Route>
          <Route>
            <LocationDisplay />
          </Route>
        </Switch>
      </Router>,
    );
    expect(screen.getByTestId("loc").textContent).toBe(`/folder/${ENC}/settings/packages`);
  });
});
