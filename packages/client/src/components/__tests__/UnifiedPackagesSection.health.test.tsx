/**
 * Integration of the package-health panel into UnifiedPackagesSection:
 * fetch on mount, `Issues (N)` badge, Apply → one cleanup POST → refresh
 * installed + health → restart banner. Child hooks are mocked; `fetch` is
 * mocked by URL. See change: add-package-health-cleanup.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const issues = {
	entries: [
		{ source: "npm:gone", status: "stale-npm", reason: "not installed" },
		{ source: "/dead", status: "missing-path", reason: "no dir" },
		{ source: "npm:fine", status: "ok" },
	],
	summary: { ok: 1, staleNpm: 1, missingPath: 1, duplicateGroups: [] },
};
const healthy = { entries: [{ source: "npm:fine", status: "ok" }], summary: { ok: 1, staleNpm: 0, missingPath: 0, duplicateGroups: [] } };

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify({ success: true, data }), { status, headers: { "Content-Type": "application/json" } });

let healthResponses: unknown[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	sessionStorage.clear();
	installedRefresh.mockClear();
	healthResponses = [issues, healthy];
	fetchMock = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.url;
		if (url.includes("/api/packages/health")) return json(healthResponses.length > 1 ? healthResponses.shift() : healthResponses[0]);
		if (url.includes("/api/packages/cleanup")) {
			return json({ before: 3, after: 1, dropped: JSON.parse(String(init?.body)).drop, backupPath: "/x.bak" });
		}
		return json([]);
	});
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("UnifiedPackagesSection — package health", () => {
	it("shows the Issues (N) badge and an expanded panel when issues exist", async () => {
		render(<UnifiedPackagesSection />);
		expect((await screen.findByTestId("pkg-health-badge")).textContent).toBe("Issues (2)");
		expect(screen.getByTestId("package-health-panel")).toBeTruthy();
	});

	it("renders no badge and no panel when everything is ok", async () => {
		healthResponses = [healthy];
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/packages/health"))).toBe(true));
		expect(screen.queryByTestId("pkg-health-badge")).toBeNull();
		expect(screen.queryByTestId("package-health-panel")).toBeNull();
	});

	it("Apply posts one cleanup, refreshes installed + health, shows the restart banner", async () => {
		render(<UnifiedPackagesSection />);
		await screen.findByTestId("package-health-panel");
		fireEvent.click(screen.getByRole("checkbox", { name: /Remove npm:gone/ }));
		fireEvent.click(screen.getByTestId("pkg-health-apply"));
		await screen.findByTestId("pkg-health-restart-banner");
		const cleanups = fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/packages/cleanup"));
		expect(cleanups).toHaveLength(1);
		expect(JSON.parse(String(cleanups[0][1].body))).toEqual({ drop: ["npm:gone"] });
		expect(installedRefresh).toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByTestId("package-health-panel")).toBeNull());
		expect(screen.queryByTestId("pkg-health-badge")).toBeNull();
	});
});
