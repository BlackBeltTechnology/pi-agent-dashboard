import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
		move: vi.fn(),
		moveStateFor: () => undefined,
		clearMove: vi.fn(),
		statusFor: () => "idle",
		messageFor: () => "",
		clearOperation: vi.fn(),
		queueDepth: 0,
		runningSource: null,
		handleMessage: vi.fn(),
	}),
}));

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
					name: "@mariozechner/pi-coding-agent",
					displayName: "pi (core agent)",
					currentVersion: "0.70.2",
					latestVersion: "0.70.2",
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
					source: "npm:@mariozechner/pi-coding-agent",
					scope: "user",
					filtered: false,
					version: "0.70.2",
					displayName: "@mariozechner/pi-coding-agent",
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
		expect(screen.queryByText("npm:@mariozechner/pi-coding-agent")).toBeNull();
	});
});
