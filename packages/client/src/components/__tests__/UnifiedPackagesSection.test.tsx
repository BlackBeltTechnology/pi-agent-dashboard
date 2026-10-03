import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import React from "react";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";
import type {
	InstalledPackage,
	PiCoreStatus,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

// ── Mocks ──────────────────────────────────────────────────────────

const mockUsePiCoreVersions = vi.fn<() => {
	status: PiCoreStatus | null;
	isLoading: boolean;
	error: string | null;
	refresh: (force?: boolean) => Promise<void>;
}>();

const mockUseInstalledPackages = vi.fn<() => {
	packages: InstalledPackage[];
	isLoading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
}>();

vi.mock("../../hooks/usePiCoreVersions.js", () => ({
	usePiCoreVersions: () => mockUsePiCoreVersions(),
}));

vi.mock("../../hooks/useInstalledPackages.js", () => ({
	useInstalledPackages: () => mockUseInstalledPackages(),
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

	mockUseInstalledPackages.mockReturnValue({
		packages: [],
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
	it("renders Pi Ecosystem header with three sub-groups", () => {
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("Pi Ecosystem")).toBeTruthy();
		expect(screen.getByText("Core")).toBeTruthy();
		expect(screen.getByText("Recommended Extensions")).toBeTruthy();
		expect(screen.getByText("Other Packages")).toBeTruthy();
	});

	it("E21: Electron hides the Core group even when the runtime is updatable", () => {
		launchSourceMock.mockReturnValue("electron");
		render(<UnifiedPackagesSection />);
		expect(screen.queryByText("Core")).toBeNull();
		expect(screen.getByText("Other Packages")).toBeTruthy();
		launchSourceMock.mockReturnValue(null);
	});

	it("renders core packages with Update button when updateAvailable", () => {
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("pi (core agent)")).toBeTruthy();
		expect(screen.getByText("pi-dashboard")).toBeTruthy();
		// pi-dashboard has updateAvailable: true → Update button present
		const updateButtons = screen.getAllByText("Update");
		expect(updateButtons.length).toBeGreaterThan(0);
	});

	it("classifies an installed npm row as recommended when isRecommended=true", () => {
		mockUseInstalledPackages.mockReturnValue({
			packages: [
				{
					source: "npm:@blackbelt-technology/pi-dashboard-subagents",
					scope: "user",
					filtered: false,
					version: "0.1.1",
					displayName: "pi-dashboard-subagents",
					isRecommended: true,
					isBundled: false,
				},
			],
			isLoading: false,
			error: null,
			refresh: vi.fn().mockResolvedValue(undefined),
		});
		render(<UnifiedPackagesSection />);
		// Display name appears in the recommended group
		expect(screen.getAllByText("pi-dashboard-subagents").length).toBeGreaterThan(0);
	});

	it("falls a non-recommended row into Other Packages", () => {
		mockUseInstalledPackages.mockReturnValue({
			packages: [
				{
					source: "/home/dev/pi-mystery",
					scope: "user",
					filtered: false,
					version: "9.9.9",
					displayName: "pi-mystery",
					isRecommended: false,
					isBundled: false,
				},
			],
			isLoading: false,
			error: null,
			refresh: vi.fn().mockResolvedValue(undefined),
		});
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("pi-mystery")).toBeTruthy();
		// should appear AFTER the "Other Packages" header
		const otherHeader = screen.getByText("Other Packages");
		const row = screen.getByText("pi-mystery");
		const otherY = otherHeader.getBoundingClientRect().top;
		const rowY = row.getBoundingClientRect().top;
		// jsdom often returns 0/0 for layout — fall back to DOM order check.
		if (otherY === 0 && rowY === 0) {
			const all = Array.from(document.body.querySelectorAll("*"));
			expect(all.indexOf(row)).toBeGreaterThan(all.indexOf(otherHeader));
		} else {
			expect(rowY).toBeGreaterThan(otherY);
		}
	});

	it("dedupes a Core whitelist member from Other (Core wins)", () => {
		mockUseInstalledPackages.mockReturnValue({
			packages: [
				{
					source: "npm:@earendil-works/pi-coding-agent",
					scope: "user",
					filtered: false,
					version: "1.0.0",
					displayName: "@earendil-works/pi-coding-agent",
					isRecommended: false,
					isBundled: false,
				},
			],
			isLoading: false,
			error: null,
			refresh: vi.fn().mockResolvedValue(undefined),
		});
		render(<UnifiedPackagesSection />);
		// Core row "pi (core agent)" is shown.
		expect(screen.getByText("pi (core agent)")).toBeTruthy();
		// The npm: source string must NOT appear anywhere — that string only
		// surfaces if the row leaks into the Other group. The Core row uses
		// the bare npm name as its source caption (without `npm:` prefix).
		expect(screen.queryByText("npm:@earendil-works/pi-coding-agent")).toBeNull();
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
