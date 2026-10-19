/**
 * Package health inside the Add-ons Issues tab: the panel moved off the top of the
 * page into the tab, the `Issues (N)` header badge became the tab count, and one
 * shared snapshot (plugins + health) feeds both the tab and the Settings rail.
 * Child hooks are mocked; `fetch` is mocked by URL.
 * See change: add-package-health-cleanup, addons-hub-folder-view (test-plan #F13–#F15, #X6).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAddonIssuesStore } from "../../lib/addons/addon-issues-store.js";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";

const installedRefresh = vi.fn().mockResolvedValue(undefined);

vi.mock("../../hooks/usePiCoreVersions.js", () => ({
	usePiCoreVersions: () => ({ status: null, isLoading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("../../hooks/useAddonCatalog.js", () => ({
	useAddonCatalog: () => ({ features: [], isLoading: false, error: null, refresh: installedRefresh }),
}));
vi.mock("../../hooks/usePackageOperations.js", () => ({
	usePackageOperations: () => ({
		operation: { operationId: null, status: "idle", message: "", source: "" },
		install: vi.fn(), remove: vi.fn(), update: vi.fn(), coreUpdate: vi.fn(), move: vi.fn(),
		moveStateFor: () => undefined, clearMove: vi.fn(), statusFor: () => "idle", messageFor: () => "",
		clearOperation: vi.fn(), queueDepth: 0, runningSource: null, isAnyRunning: false, handleMessage: vi.fn(),
	}),
}));
vi.mock("../../hooks/useLaunchSource.js", () => ({ useLaunchSource: () => null }));
vi.mock("../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../packages/PackageReadmeDialog.js", () => ({ PackageReadmeDialog: () => null }));

const stale = (source: string) => ({ source, status: "stale-npm", reason: "not installed" });
const dup = (source: string) => ({ source, status: "duplicate", duplicateGroupId: "dup:pkg", reason: "same name" });
const issues = {
	entries: [stale("npm:gone"), { source: "/dead", status: "missing-path", reason: "no dir" }, { source: "npm:fine", status: "ok" }],
	summary: { ok: 1, staleNpm: 1, missingPath: 1, duplicateGroups: [] },
};
const bigIssues = {
	entries: [stale("npm:gone1"), stale("npm:gone2"), dup("/a"), dup("/b"), dup("/c"), dup("/d"), { source: "npm:fine", status: "ok" }],
	summary: { ok: 1, staleNpm: 2, missingPath: 0, duplicateGroups: [{ id: "dup:pkg", packageName: "pkg", count: 4, members: [] }] },
};
const healthy = { entries: [{ source: "npm:fine", status: "ok" }], summary: { ok: 1, staleNpm: 0, missingPath: 0, duplicateGroups: [] } };

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify({ success: true, data }), { status, headers: { "Content-Type": "application/json" } });

const pluginRow = {
	id: "apple-tools",
	displayName: "Apple Tools",
	claims: [{ slot: "settings-section" }],
	status: {
		id: "apple-tools",
		displayName: "Apple Tools",
		enabled: true,
		loaded: true,
		claims: 1,
		missingRequirements: ["${imcpServerPath}"],
		requirements: { piExtensions: [], binaries: [], services: [], paths: [{ name: "${imcpServerPath}", satisfied: false }] },
	},
};

let healthResponses: unknown[];
let healthStatus: number;
let plugins: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	sessionStorage.clear();
	__resetAddonIssuesStore();
	installedRefresh.mockClear();
	healthResponses = [issues, healthy];
	healthStatus = 200;
	plugins = [];
	fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.url;
		if (url.includes("/api/packages/health")) {
			if (healthStatus !== 200) return new Response("{}", { status: healthStatus });
			return json(healthResponses.length > 1 ? healthResponses.shift() : healthResponses[0]);
		}
		if (url.includes("/api/packages/cleanup")) {
			return json({ before: 3, after: 1, dropped: JSON.parse(String(init?.body)).drop, backupPath: "/x.bak" });
		}
		if (url.includes("/api/plugins")) return new Response(JSON.stringify({ success: true, plugins }), { status: 200 });
		return json([]);
	});
	vi.stubGlobal("fetch", fetchMock);
	window.history.replaceState(null, "", "/settings/add-ons");
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

const openIssues = () => fireEvent.click(screen.getByTestId("addons-tab-issues"));

describe("UnifiedPackagesSection — Issues tab", () => {
	// test-plan #F14
	it("renders the health panel inside the Issues tab, counts every non-ok entry plus plugin issues, and has no header badge", async () => {
		healthResponses = [bigIssues];
		plugins = [pluginRow];
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId("addons-tab-issues").textContent).toBe("Issues (7)"));
		expect(screen.queryByTestId("pkg-health-badge")).toBeNull();
		// not above the list: nothing health-related outside the tab until it is open
		expect(screen.queryByTestId("package-health-panel")).toBeNull();
		openIssues();
		const tab = await screen.findByTestId("addons-issues-tab");
		expect(tab.contains(await screen.findByTestId("package-health-panel"))).toBe(true);
		expect(tab.contains(screen.getByTestId("addons-issue-plugin-apple-tools"))).toBe(true);
	});

	// test-plan #F12 (tab half)
	it("lists a plugin with a missing requirement and a link to its settings page", async () => {
		healthResponses = [healthy];
		plugins = [pluginRow];
		render(<UnifiedPackagesSection />);
		openIssues();
		const row = await screen.findByTestId("addons-issue-plugin-apple-tools");
		expect(row.textContent).toContain("Apple Tools");
		expect(row.querySelector('[data-testid="missing-path-${imcpServerPath}"]')).toBeTruthy();
		expect(screen.getByTestId("addons-issue-settings-apple-tools")).toBeTruthy();
	});

	// test-plan #F13
	it("says 'No issues' and shows no count when nothing is wrong", async () => {
		healthResponses = [healthy];
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/packages/health"))).toBe(true));
		openIssues();
		expect((await screen.findByTestId("addons-issues-empty")).textContent).toBe("No issues");
		expect(screen.getByTestId("addons-tab-issues").textContent).toBe("Issues");
		expect(screen.queryByTestId("package-health-panel")).toBeNull();
	});

	// test-plan #F15
	it("Apply posts one cleanup, refreshes the catalog and the count, and shows the restart banner", async () => {
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId("addons-tab-issues").textContent).toBe("Issues (2)"));
		openIssues();
		await screen.findByTestId("package-health-panel");
		fireEvent.click(screen.getByRole("checkbox", { name: /Remove npm:gone/ }));
		fireEvent.click(screen.getByTestId("pkg-health-apply"));
		await screen.findByTestId("pkg-health-restart-banner");
		const cleanups = fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/packages/cleanup"));
		expect(cleanups).toHaveLength(1);
		expect(JSON.parse(String(cleanups[0][1].body))).toEqual({ drop: ["npm:gone"] });
		expect(installedRefresh).toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByTestId("package-health-panel")).toBeNull());
		await waitFor(() => expect(screen.getByTestId("addons-tab-issues").textContent).toBe("Issues"));
	});

	// test-plan #X6
	it.each([
		["a 500", () => { healthStatus = 500; }],
		["a network error", () => { fetchMock.mockImplementation(async (input: RequestInfo) => {
			const url = typeof input === "string" ? input : input.url;
			if (url.includes("/api/packages/health")) throw new TypeError("network down");
			if (url.includes("/api/plugins")) return new Response(JSON.stringify({ success: true, plugins }), { status: 200 });
			return json([]);
		}); }],
	])("a failed health request (%s) shows plugin issues only and no error", async (_l, arrange) => {
		plugins = [pluginRow];
		arrange();
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId("addons-tab-issues").textContent).toBe("Issues (1)"));
		openIssues();
		await screen.findByTestId("addons-issue-plugin-apple-tools");
		expect(screen.queryByTestId("package-health-panel")).toBeNull();
		expect(screen.getByTestId("addons-issues-tab").textContent).not.toMatch(/failed|error/i);
	});

	it("?tab=issues opens the Issues tab", async () => {
		window.history.replaceState(null, "", "/settings/add-ons?tab=issues");
		healthResponses = [healthy];
		render(<UnifiedPackagesSection />);
		expect(await screen.findByTestId("addons-issues-tab")).toBeTruthy();
	});
});
