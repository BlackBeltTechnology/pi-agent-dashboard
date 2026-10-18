import type { AddonFeature, PiCoreStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";
import { feature, part } from "./addons-feature-fixtures.js";

// ── Mocks ──────────────────────────────────────────────────────────

const mockUsePiCoreVersions = vi.fn<() => {
	status: PiCoreStatus | null;
	isLoading: boolean;
	error: string | null;
	refresh: (force?: boolean) => Promise<void>;
}>();

const mockUseAddonCatalog = vi.fn<() => {
	features: AddonFeature[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}>();

vi.mock("../../hooks/usePiCoreVersions.js", () => ({
	usePiCoreVersions: () => mockUsePiCoreVersions(),
}));

vi.mock("../../hooks/useAddonCatalog.js", () => ({
	useAddonCatalog: () => mockUseAddonCatalog(),
}));

vi.mock("../../hooks/usePackageOperations.js", () => ({
	usePackageOperations: () => ({
		operation: { operationId: null, status: "idle", message: "", source: "" },
		install: vi.fn(),
		remove: vi.fn(),
		update: vi.fn(),
		coreUpdate: vi.fn(),
		move: vi.fn(),
		moveStateFor: () => undefined,
		clearMove: vi.fn(),
		statusFor: () => "idle",
		messageFor: () => "",
		clearOperation: vi.fn(),
		queueDepth: 0,
		runningSource: null,
		isAnyRunning: false,
		handleMessage: vi.fn(),
	}),
}));

const launchSourceMock = vi.fn<() => string | null>(() => null);
vi.mock("../../hooks/useLaunchSource.js", () => ({ useLaunchSource: () => launchSourceMock() }));

vi.mock("../../lib/api/api-context.js", () => ({
	getApiBase: () => "",
}));

vi.mock("../packages/PackageReadmeDialog.js", () => ({
	PackageReadmeDialog: () => null,
}));

beforeEach(() => {
	mockUsePiCoreVersions.mockReturnValue({
		status: {
			packages: [
				{
					name: "@earendil-works/pi-coding-agent",
					displayName: "pi (core agent)",
					currentVersion: "1.0.0",
					latestVersion: "1.0.0",
					updateAvailable: false,
					installSource: "global",
				},
				{
					name: "@blackbelt-technology/pi-agent-dashboard",
					displayName: "pi-dashboard",
					currentVersion: "0.4.0",
					latestVersion: "0.4.1",
					updateAvailable: true,
					installSource: "global",
				},
			],
			updatesAvailable: 1,
			lastChecked: new Date().toISOString(),
		},
		isLoading: false,
		error: null,
		refresh: vi.fn().mockResolvedValue(undefined),
	});

	mockUseAddonCatalog.mockReturnValue({
		features: [],
		isLoading: false,
		error: null,
		refresh: vi.fn().mockResolvedValue(undefined),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("UnifiedPackagesSection", () => {
	it("renders the Add-ons header with the four feature groups (kind grouping, no filter)", () => {
		render(<UnifiedPackagesSection />);
		expect(screen.getByRole("heading", { level: 2, name: /Add-ons/ })).toBeTruthy();
		expect(screen.queryByText("Pi Ecosystem")).toBeNull();
		expect(screen.getByText("Core")).toBeTruthy();
		expect(screen.getByText("Agent + dashboard features")).toBeTruthy();
		expect(screen.getByText("Dashboard-only features")).toBeTruthy();
		expect(screen.getByText("Agent-only features")).toBeTruthy();
	});

	it("E21: Electron hides the pi core rows even when the runtime is updatable", () => {
		launchSourceMock.mockReturnValue("electron");
		render(<UnifiedPackagesSection />);
		expect(screen.queryByText("Core")).toBeNull();
		expect(screen.getByText("Agent-only features")).toBeTruthy();
		launchSourceMock.mockReturnValue(null);
	});

	it("renders core packages with Update button when updateAvailable", () => {
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("pi (core agent)")).toBeTruthy();
		expect(screen.getByTestId("pi-core-row-@blackbelt-technology/pi-agent-dashboard")).toBeTruthy();
		// pi-dashboard has updateAvailable: true → Update button present
		expect(screen.getAllByText("Update").length).toBeGreaterThan(0);
	});

	it("renders one row per catalog feature and never a row for core:pi", () => {
		mockUseAddonCatalog.mockReturnValue({
			features: [
				feature("core:pi", { displayName: "pi core agent", kind: "core", origin: "upstream" }),
				feature("pkg:npm:pi-mystery", { displayName: "pi-mystery", packages: [part("/home/dev/pi-mystery", { version: "9.9.9" })] }),
			],
			isLoading: false,
			error: null,
			refresh: vi.fn().mockResolvedValue(undefined),
		});
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("pi-mystery")).toBeTruthy();
		expect(screen.queryByTestId("addon-row-core:pi")).toBeNull();
		expect(screen.getByTestId("addon-row-pkg:npm:pi-mystery")).toBeTruthy();
	});

	// F1 — a stale legacy-fork row (e.g. a cached status) is not treated as pi:
	// no what's-new icon, and the changelog is fetched for earendil only.
	// See change: drop-mariozechner-pi-fork (test-plan #F1).
	it("F1: a stale fork row gets no icon and no changelog fetch", async () => {
		const fetchMock = vi.fn(async (url: string | URL | Request) => {
			const u = String(url);
			if (u.includes("/api/pi-core/changelog")) {
				return new Response(
					JSON.stringify({
						pkg: "@earendil-works/pi-coding-agent",
						from: "1.0.0",
						to: "1.0.2",
						releases: [{ version: "1.0.2", date: null, breaking: ["x"], added: [], changed: [], fixed: [] }],
						hasBreaking: true,
						changelogUrl: null,
						parsedAt: new Date().toISOString(),
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
		});
		vi.stubGlobal("fetch", fetchMock);
		const FORK = "@mariozechner/pi-coding-agent";
		const EARENDIL = "@earendil-works/pi-coding-agent";
		mockUsePiCoreVersions.mockReturnValue({
			status: {
				packages: [
					{ name: FORK, displayName: FORK, currentVersion: "0.73.1", latestVersion: "0.74.0", updateAvailable: true, installSource: "global" },
					{ name: EARENDIL, displayName: "pi (core agent)", currentVersion: "1.0.0", latestVersion: "1.0.2", updateAvailable: true, installSource: "global" },
				],
				updatesAvailable: 2,
				lastChecked: new Date().toISOString(),
			},
			isLoading: false,
			error: null,
			refresh: vi.fn().mockResolvedValue(undefined),
		});
		try {
			render(<UnifiedPackagesSection />);
			await waitFor(() =>
				expect(screen.getByTestId(`pi-core-row-${EARENDIL}-whats-new`)).toBeTruthy(),
			);
			expect(screen.queryByTestId(`pi-core-row-${FORK}-whats-new`)).toBeNull();
			const changelogUrls = fetchMock.mock.calls
				.map(([u]) => String(u))
				.filter((u) => u.includes("/api/pi-core/changelog"));
			expect(changelogUrls.length).toBeGreaterThan(0);
			for (const u of changelogUrls) {
				expect(u).toContain(`pkg=${encodeURIComponent(EARENDIL)}`);
				expect(u).not.toContain("mariozechner");
			}
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

