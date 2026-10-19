/**
 * Grouping, filter chips, local banner, tabs. See change:
 * addons-hub-feature-catalog (test-plan #E23, #E24, #E25, #E29).
 */
import type { AddonFeature } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";
import { feature, goalFeature, part, plugin } from "./addons-feature-fixtures.js";

const mockCatalog = vi.fn<() => { features: AddonFeature[]; isLoading: boolean; error: string | null; refresh: () => Promise<void> }>();

vi.mock("../../hooks/useAddonCatalog.js", () => ({ useAddonCatalog: () => mockCatalog() }));
vi.mock("../../hooks/usePiCoreVersions.js", () => ({
	usePiCoreVersions: () => ({ status: { packages: [], updatesAvailable: 0, lastChecked: null }, isLoading: false, error: null, refresh: vi.fn() }),
}));
vi.mock("../../hooks/usePackageOperations.js", () => ({
	usePackageOperations: () => ({
		operation: { operationId: null, status: "idle", message: "", source: "" },
		install: vi.fn(), remove: vi.fn(), update: vi.fn(), coreUpdate: vi.fn(), move: vi.fn(), resetToNpm: vi.fn(),
		moveStateFor: () => undefined, clearMove: vi.fn(), statusFor: () => "idle", messageFor: () => "",
		clearOperation: vi.fn(), queueDepth: 0, runningSource: null, isAnyRunning: false, handleMessage: vi.fn(),
	}),
}));
vi.mock("../../hooks/useLaunchSource.js", () => ({ useLaunchSource: () => null }));
vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../packages/PackageReadmeDialog.js", () => ({ PackageReadmeDialog: () => null }));
vi.mock("../packages/AddonsDiscoverTab.js", () => ({ AddonsDiscoverTab: () => <div data-testid="discover-stub" /> }));

function withFeatures(features: AddonFeature[]) {
	mockCatalog.mockReturnValue({ features, isLoading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) });
}
const rows = () => Array.from(document.querySelectorAll('[data-testid^="addon-row-"]')).map((e) => e.getAttribute("data-testid")?.replace("addon-row-", ""));
const groupIds = () => Array.from(document.querySelectorAll('[data-testid^="addons-group-"]:not([data-testid="addons-group-by"])')).map((e) => e.getAttribute("data-testid")?.replace("addons-group-", ""));

beforeEach(() => {
	localStorage.clear();
	window.history.replaceState({}, "", "/settings/add-ons");
	vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }))));
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

/** One feature per origin and per source type. */
function mixedFixture(): AddonFeature[] {
	return [
		feature("core:dashboard-bridge", { displayName: "Bridge", kind: "core", origin: "first-party", packages: [part("npm:@blackbelt-technology/pi-dashboard-extension")] }),
		feature("plugin:gmail", { displayName: "Gmail", plugin: plugin("gmail"), origin: "first-party" }), // built in
		goalFeature(), // mixed, npm
		feature("pkg:npm:community", { displayName: "Community", origin: "community", packages: [part("npm:community")] }),
		feature("pkg:git:g", { displayName: "GitPkg", origin: "community", packages: [part("git:github.com/a/g")] }),
		feature("pkg:local:l", { displayName: "LocalPkg", origin: "community", packages: [part("/repo/l"), part("npm:l-also")] }),
	];
}

describe("grouping", () => {
	// test-plan #E23
	it("E23: headings per mode, install-source precedence local > git > npm, A–Z has none, each feature once", () => {
		withFeatures(mixedFixture());
		render(<UnifiedPackagesSection />);
		const select = screen.getByTestId("addons-group-by");

		// by kind (default)
		expect(screen.getByText("Agent + dashboard features")).toBeTruthy();
		expect(screen.getByText("Dashboard-only features")).toBeTruthy();
		expect(screen.getByText("Agent-only features")).toBeTruthy();
		expect(screen.getByTestId("addons-group-agent-and-dashboard").textContent).toContain("Goal");

		// by who delivers it
		fireEvent.change(select, { target: { value: "origin" } });
		for (const h of ["Delivered by pi-dashboard", "pi-dashboard UI for community extensions", "Community packages"]) expect(screen.getByText(h)).toBeTruthy();
		expect(screen.getByTestId("addons-group-first-party").textContent).toContain("Gmail");
		expect(screen.getByTestId("addons-group-mixed").textContent).toContain("Goal");

		// by install source
		fireEvent.change(select, { target: { value: "source" } });
		expect(screen.getByTestId("addons-group-npm").textContent).toContain("Goal");
		expect(screen.getByTestId("addons-group-git").textContent).toContain("GitPkg");
		expect(screen.getByTestId("addons-group-local").textContent).toContain("LocalPkg"); // local wins over its npm part
		expect(screen.getByTestId("addons-group-builtin").textContent).toContain("Gmail");
		expect(screen.getByText("Built into the dashboard")).toBeTruthy();

		// A–Z: no headings, every feature exactly once
		fireEvent.change(select, { target: { value: "az" } });
		expect(screen.queryByText("Built into the dashboard")).toBeNull();
		expect(groupIds()).toEqual(["az"]);
		const ids = rows();
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toHaveLength(mixedFixture().length);
	});
});

describe("filters", () => {
	// test-plan #E24
	it("E24: chips AND together; origin chips overlap on mixed; Disabled includes partial; text ignores bridge paths", () => {
		withFeatures([
			goalFeature({ description: "keeps goals" }), // mixed, has bridge path containing "goal"
			feature("plugin:gmail", { displayName: "Gmail", plugin: plugin("gmail"), origin: "first-party" }),
			feature("pkg:npm:community", { displayName: "Community", origin: "community", state: "off", packages: [part("npm:community")] }),
			feature("pkg:local:memory", { displayName: "Memory tool", origin: "community", state: "partial", packages: [part("/repo/memory")] }),
		]);
		render(<UnifiedPackagesSection />);
		const chip = (id: string) => fireEvent.click(screen.getByTestId(`addons-chip-${id}`));

		chip("from-dashboard");
		expect(rows().sort()).toEqual(["plugin:gmail", "plugin:goal"]);
		chip("community");
		expect(rows()).toEqual(["plugin:goal"]); // only mixed satisfies both
		chip("from-dashboard");
		chip("community"); // both off again
		chip("disabled");
		expect(rows().sort()).toEqual(["pkg:local:memory", "pkg:npm:community"]);
		chip("disabled");
		chip("agent-only");
		expect(rows().sort()).toEqual(["pkg:local:memory", "pkg:npm:community"]);
		chip("agent-only");
		chip("dashboard-ui");
		expect(rows().sort()).toEqual(["plugin:gmail", "plugin:goal"]);
		chip("dashboard-ui");

		fireEvent.change(screen.getByTestId("addons-filter-input"), { target: { value: "memory" } });
		expect(rows()).toEqual(["pkg:local:memory"]);
		fireEvent.change(screen.getByTestId("addons-filter-input"), { target: { value: "goal-plugin/src/bridge" } });
		expect(rows()).toEqual([]); // the bridge path is not searched
		expect(screen.queryByTestId("addons-chip-updates")).toBeNull(); // no Update available chip
		expect(screen.getByTestId("addons-no-match")).toBeTruthy();
	});

	it("hides groups with no match while filtering, shows them all otherwise", () => {
		withFeatures([goalFeature()]);
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("Agent-only features")).toBeTruthy();
		fireEvent.change(screen.getByTestId("addons-filter-input"), { target: { value: "goal" } });
		expect(screen.queryByText("Agent-only features")).toBeNull();
		expect(screen.getByText("Agent + dashboard features")).toBeTruthy();
	});

	// test-plan #E25
	it("E25: the banner counts features, and Show resets the other filters and turns on Local source", () => {
		const local = Array.from({ length: 13 }, (_, i) => feature(`pkg:local:l${i}`, { displayName: `local-${i}`, packages: [part(`/repo/l${i}`)] }));
		const bridges = Array.from({ length: 9 }, (_, i) => feature(`plugin:p${i}`, { displayName: `plug-${i}`, plugin: plugin(`p${i}`), bridge: { path: `/repo/p${i}/bridge.ts` } }));
		withFeatures([...local, ...bridges, feature("pkg:npm:n", { displayName: "npmpkg", packages: [part("npm:n")] })]);
		render(<UnifiedPackagesSection />);
		expect(screen.getByTestId("addons-local-banner").textContent).toContain("13");
		fireEvent.change(screen.getByTestId("addons-filter-input"), { target: { value: "plug" } });
		fireEvent.click(screen.getByTestId("addons-chip-community"));
		fireEvent.click(screen.getByTestId("addons-local-banner-show"));
		expect((screen.getByTestId("addons-filter-input") as HTMLInputElement).value).toBe("");
		expect(screen.getByTestId("addons-chip-local").getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByTestId("addons-chip-community").getAttribute("aria-pressed")).toBe("false");
		expect(rows()).toHaveLength(13);
	});
});

describe("tabs", () => {
	// test-plan #E29
	it("E29: Installed by default, ?tab=discover selects Discover, an unknown value falls back; labels carry counts", async () => {
		withFeatures([goalFeature(), feature("pkg:npm:a", { packages: [part("npm:a")] })]);
		const { unmount } = render(<UnifiedPackagesSection />);
		expect(screen.getByTestId("addons-tab-installed").getAttribute("aria-selected")).toBe("true");
		expect(screen.getByTestId("addons-tab-installed").textContent).toBe("Installed (2)");
		expect(screen.getByTestId("addons-tab-updates").textContent).toBe("Updates (0)");
		fireEvent.click(screen.getByTestId("addons-tab-discover"));
		expect(window.location.search).toBe("?tab=discover");
		expect(screen.getByTestId("discover-stub")).toBeTruthy();
		unmount();

		// reload on ?tab=discover
		render(<UnifiedPackagesSection />);
		expect(screen.getByTestId("addons-tab-discover").getAttribute("aria-selected")).toBe("true");
		cleanup();

		window.history.replaceState({}, "", "/settings/add-ons?tab=bogus");
		render(<UnifiedPackagesSection />);
		expect(screen.getByTestId("addons-tab-installed").getAttribute("aria-selected")).toBe("true");
	});

	it("the update count in the tab label follows the update check", async () => {
		withFeatures([feature("pkg:npm:a", { packages: [part("npm:a")] })]);
		vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [{ source: "npm:a" }] }))));
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId("addons-tab-updates").textContent).toBe("Updates (1)"));
	});
});
