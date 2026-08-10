import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";
import { PackageBrowser } from "../packages/PackageBrowser.js";
import type { InstalledPackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

// Hook mocks ---------------------------------------------------------

const mockOps = {
  operation: { operationId: null, status: "idle", message: "", source: "" } as any,
  install: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  statusFor: () => "idle" as const,
  messageFor: () => "",
  queueDepth: 0,
  runningSource: null,
  handleMessage: () => {},
  clearOperation: () => {},
};

let installedOwnPkgs: InstalledPackage[] = [];
let installedOtherPkgs: InstalledPackage[] = [];

vi.mock("../../hooks/usePackageOperations.js", () => ({
  usePackageOperations: () => mockOps,
}));
vi.mock("../../hooks/usePackageSearch.js", () => ({
  usePackageSearch: () => ({
    query: "",
    setQuery: () => {},
    typeFilter: null,
    setTypeFilter: () => {},
    packages: [],
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../hooks/useInstalledPackages.js", () => ({
  useInstalledPackages: (scope: "global" | "local") => ({
    packages: scope === "local" ? installedOwnPkgs : installedOtherPkgs,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../hooks/useRecommendedExtensions.js", () => ({
  useRecommendedExtensions: () => ({ recommended: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

function makePkg(source: string, scope: "global" | "local" = "local", extras?: Partial<InstalledPackage>): InstalledPackage {
  return {
    source,
    scope: scope === "global" ? "user" : "project",
    filtered: false,
    installedPath: undefined,
    version: undefined,
    description: undefined,
    displayName: undefined,
    isRecommended: false,
    isBundled: false,
    ...extras,
  } as InstalledPackage;
}

beforeEach(() => {
  installedOwnPkgs = [];
  installedOtherPkgs = [];
  mockOps.remove.mockReset();
  mockOps.update.mockReset();
});
afterEach(() => cleanup());

describe("PackageBrowser — Installed Packages section (unify-workspace-package-management)", () => {
  it("renders a PackageRow for every source shape (npm, local-path, git)", () => {
    installedOwnPkgs = [
      makePkg("npm:pi-flows", "local", { displayName: "pi-flows" }),
      makePkg("/abs/path/my-ext", "local", { displayName: "my-ext" }),
      makePkg("git@github.com:user/repo.git", "local", { displayName: "repo" }),
    ];
    render(<PackageBrowser scope="local" cwd="/test" />);

    // Each source produces a row identifiable by data-testid="installed-row-<sanitized-source>"
    expect(screen.getByTestId("installed-row-npm-pi-flows")).toBeTruthy();
    expect(screen.getByTestId("installed-row--abs-path-my-ext")).toBeTruthy();
    expect(screen.getByTestId("installed-row-git-github-com-user-repo-git")).toBeTruthy();
  });

  it("clicking Uninstall on a local-path row calls operations.remove with the raw source", () => {
    installedOwnPkgs = [makePkg("/abs/path/my-ext", "local", { displayName: "my-ext" })];
    render(<PackageBrowser scope="local" cwd="/test" />);

    // PackageRow puts Uninstall behind a kebab menu; open the menu first.
    const menuBtn = screen.getByTestId("installed-row--abs-path-my-ext-menu");
    fireEvent.click(menuBtn);
    const uninstallBtn = screen.getByText("Uninstall");
    fireEvent.click(uninstallBtn);

    expect(mockOps.remove).toHaveBeenCalledTimes(1);
    expect(mockOps.remove).toHaveBeenCalledWith("/abs/path/my-ext");
  });

  it("does NOT render an 'Installed' filter pill", () => {
    installedOwnPkgs = [makePkg("npm:foo", "local")];
    render(<PackageBrowser scope="local" cwd="/test" />);
    expect(screen.queryByTestId("package-installed-filter")).toBeNull();
    // Defensive: also ensure no button with "installed" text renders next to the type pills.
    const buttons = screen.queryAllByRole("button").filter((b) => b.textContent?.toLowerCase().trim() === "installed");
    expect(buttons.length).toBe(0);
  });

  it("does NOT render the section header when no non-recommended packages are installed", () => {
    installedOwnPkgs = []; // empty
    render(<PackageBrowser scope="local" cwd="/test" />);
    expect(screen.queryByTestId("installed-packages-section")).toBeNull();
  });

  it("renders the section header when at least one non-recommended package is installed", () => {
    installedOwnPkgs = [makePkg("/abs/path/foo", "local")];
    render(<PackageBrowser scope="local" cwd="/test" />);
    expect(screen.getByTestId("installed-packages-section")).toBeTruthy();
  });

  it("filters out recommended packages from the section (they appear in RecommendedExtensions panel)", () => {
    installedOwnPkgs = [
      makePkg("npm:pi-flows", "local", { isRecommended: true }),
      makePkg("/abs/path/foo", "local", { isRecommended: false }),
    ];
    render(<PackageBrowser scope="local" cwd="/test" />);
    expect(screen.queryByTestId("installed-row-npm-pi-flows")).toBeNull();
    expect(screen.getByTestId("installed-row--abs-path-foo")).toBeTruthy();
  });

  // Cross-scope badges are visible on search-result PackageCard rows. We don't have
  // search results here, so we exercise the new source-keyed installedInfo via a
  // smoke check: the section above renders without throwing for non-npm cross-scope.
  it("hides the Installed Packages section when showInstalledSection={false}", () => {
    // Mirrors the Settings → Packages mount, where UnifiedPackagesSection is the
    // canonical manage surface and PackageBrowser must NOT duplicate the rows.
    installedOwnPkgs = [
      makePkg("npm:foo", "global"),
      makePkg("/abs/path/bar", "global"),
    ];
    render(<PackageBrowser scope="global" showInstalledSection={false} />);
    expect(screen.queryByTestId("installed-packages-section")).toBeNull();
    expect(screen.queryByTestId("installed-row-npm-foo")).toBeNull();
    expect(screen.queryByTestId("installed-row--abs-path-bar")).toBeNull();
  });

  it("supports cross-scope detection for non-npm sources without throwing", () => {
    installedOwnPkgs = [makePkg("/abs/path/foo", "local")];
    installedOtherPkgs = [makePkg("/abs/path/foo", "global")];
    expect(() => render(<PackageBrowser scope="local" cwd="/test" />)).not.toThrow();
    // The local-scope row still renders.
    expect(screen.getByTestId("installed-row--abs-path-foo")).toBeTruthy();
  });
});
