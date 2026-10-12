import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within, act } from "@testing-library/react";
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
	it("renders the Add-ons header with three sub-groups", () => {
		render(<UnifiedPackagesSection />);
		expect(screen.getByRole("heading", { level: 2, name: /Add-ons/ })).toBeTruthy();
		expect(screen.queryByText("Pi Ecosystem")).toBeNull();
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

// ── Add-ons hub (see change: addons-hub-declutter) ────────────────────

function pkg(source: string, extra: Partial<InstalledPackage> = {}): InstalledPackage {
	return { source, scope: "user", filtered: false, displayName: source, ...extra };
}

/** 38 rows = 9 dashboard-managed bridges + 13 local checkouts + 16 npm rows. */
function realisticFixture(): InstalledPackage[] {
	const bridges = Array.from({ length: 9 }, (_, i) =>
		pkg(`/repo/packages/p${i}/src/bridge/index.ts`, { displayName: "index.ts", dashboardManaged: true }),
	);
	const local = Array.from({ length: 13 }, (_, i) => pkg(`/home/dev/ext${i}`, { displayName: `local-ext-${i}` }));
	const npm = Array.from({ length: 16 }, (_, i) => pkg(`npm:pkg${i}`, { displayName: `npm-pkg-${i}`, description: i === 0 ? "persistent memory" : undefined }));
	return [...bridges, ...local, ...npm];
}

/** Installed rows only: `pkg-row-<id>` without the per-row control suffixes. */
function installedRowCount(): number {
	return Array.from(document.querySelectorAll("[data-testid^='pkg-row-']")).filter(
		(el) => !/-(menu|update|queued|override|source-badge|whats-new|move|reset-.*|published-variant)$/.test(el.getAttribute("data-testid") ?? ""),
	).length;
}

function mockCheckUpdates(updates: string[] | "fail") {
	const fn = vi.fn().mockImplementation(async () =>
		updates === "fail"
			? { ok: false, status: 500, json: async () => ({ success: false, error: "boom" }) }
			: { ok: true, status: 200, json: async () => ({ success: true, data: updates.map((source) => ({ source })) }) },
	);
	vi.stubGlobal("fetch", fn);
	return fn;
}

describe("UnifiedPackagesSection — Add-ons hub", () => {
	beforeEach(() => {
		localStorage.clear();
		mockCheckUpdates([]);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		localStorage.clear();
	});

	function withRows(rows: InstalledPackage[]) {
		mockUseInstalledPackages.mockReturnValue({ packages: rows, isLoading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) });
	}

	it("E8: renders no bridge row; counts and the banner exclude them", () => {
		withRows(realisticFixture());
		render(<UnifiedPackagesSection />);
		expect(screen.queryAllByText("index.ts")).toHaveLength(0);
		expect(screen.getByTestId("addons-local-banner").textContent).toContain("13");
		// 13 local + 16 npm rows render (no filter active).
		expect(installedRowCount()).toBe(29);
	});

	it("E10: text filter is case-insensitive over name/source/description, ANDs with chips, hides empty groups", () => {
		withRows(realisticFixture());
		render(<UnifiedPackagesSection />);
		const input = screen.getByTestId("addons-filter-input");
		fireEvent.change(input, { target: { value: "MEMORY" } });
		expect(installedRowCount()).toBe(1);
		// Empty sub-groups are hidden while filtering (Core + Recommended have no match).
		expect(screen.queryByText("Recommended Extensions")).toBeNull();
		expect(screen.queryByText("Core")).toBeNull();
		fireEvent.click(screen.getByTestId("addons-chip-local"));
		expect(installedRowCount()).toBe(0);
		expect(screen.getByTestId("addons-no-match")).toBeTruthy();
		fireEvent.change(input, { target: { value: "" } });
		expect(installedRowCount()).toBe(13);
	});

	it("E10: an unmatched query offers an npm-search link carrying the text", () => {
		withRows(realisticFixture());
		const handler = vi.fn();
		window.addEventListener("pi-addons-npm-search", handler);
		render(<UnifiedPackagesSection />);
		fireEvent.change(screen.getByTestId("addons-filter-input"), { target: { value: "zzz" } });
		expect(screen.getByTestId("addons-no-match").textContent).toMatch(/nothing matches/i);
		fireEvent.click(screen.getByTestId("addons-npm-search-link"));
		expect((handler.mock.calls[0][0] as CustomEvent).detail).toEqual({ query: "zzz" });
		window.removeEventListener("pi-addons-npm-search", handler);
	});

	it("E11: the Update chip is disabled until a check completes, then enabled", async () => {
		withRows([pkg("npm:a"), pkg("npm:b")]);
		mockCheckUpdates(["npm:b"]);
		render(<UnifiedPackagesSection />);
		const chip = screen.getByTestId("addons-chip-updates") as HTMLButtonElement;
		expect(chip.disabled).toBe(true);
		expect(chip.getAttribute("title")).toBe("Check for updates first");
		await waitFor(() => expect((screen.getByTestId("addons-chip-updates") as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(screen.getByTestId("addons-chip-updates"));
		expect(installedRowCount()).toBe(1);
	});

	it("X3: a failed update check leaves the chip disabled and the other filters working", async () => {
		const fetchMock = mockCheckUpdates("fail");
		withRows([pkg("npm:a"), pkg("/local/b")]);
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		await act(async () => {});
		const chip = screen.getByTestId("addons-chip-updates") as HTMLButtonElement;
		expect(chip.disabled).toBe(true);
		expect(chip.getAttribute("title")).toBe("Check for updates first");
		fireEvent.click(screen.getByTestId("addons-chip-local"));
		expect(installedRowCount()).toBe(1);
	});

	it("E12: banner Show clears the text filter and other chips and turns on Local source", () => {
		withRows(realisticFixture());
		render(<UnifiedPackagesSection />);
		fireEvent.change(screen.getByTestId("addons-filter-input"), { target: { value: "flows" } });
		fireEvent.click(screen.getByTestId("addons-local-banner-show"));
		expect((screen.getByTestId("addons-filter-input") as HTMLInputElement).value).toBe("");
		expect(screen.getByTestId("addons-chip-local").getAttribute("aria-pressed")).toBe("true");
		expect(installedRowCount()).toBe(13);
	});

	it("E13: with no filter, Core shows its empty hint when it has no rows", () => {
		mockUsePiCoreVersions.mockReturnValue({ status: { packages: [], updatesAvailable: 0, lastChecked: new Date().toISOString() }, isLoading: false, error: null, refresh: vi.fn() });
		withRows([]);
		render(<UnifiedPackagesSection />);
		expect(screen.getByText("Core")).toBeTruthy();
		expect(screen.getByText("No pi ecosystem core packages detected.")).toBeTruthy();
	});

	it("F1: explainer is expanded on first visit, collapses persistently, and the header link reopens + focuses it", () => {
		withRows([]);
		const first = render(<UnifiedPackagesSection />);
		const toggle = () => screen.getByTestId("addons-explainer-toggle");
		expect(toggle().getAttribute("aria-expanded")).toBe("true");
		fireEvent.click(toggle());
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		expect(localStorage.getItem("dashboard:addons-explainer-dismissed")).toBe("true");
		first.unmount();
		cleanup();
		render(<UnifiedPackagesSection />);
		expect(toggle().getAttribute("aria-expanded")).toBe("false");
		fireEvent.click(screen.getByTestId("addons-explainer-link"));
		expect(toggle().getAttribute("aria-expanded")).toBe("true");
		expect(document.activeElement).toBe(toggle());
	});

	it("F1: the explainer carries the plain-language definitions and the worked example", () => {
		withRows([]);
		render(<UnifiedPackagesSection />);
		const body = screen.getByTestId("addons-explainer-body").textContent ?? "";
		for (const word of ["Extension", "Skill", "Dashboard plugin", "Package", "Example: Goal"]) expect(body).toContain(word);
		expect(screen.getByTestId("addons-legend")).toBeTruthy();
	});

	it("F2: part labels expose their plain-language description", () => {
		withRows([]);
		render(<UnifiedPackagesSection />);
		const legend = within(screen.getByTestId("addons-legend"));
		const ext = legend.getByTestId("legend-chip-extension");
		const desc = document.getElementById(ext.getAttribute("aria-describedby") as string)?.textContent;
		expect(desc).toMatch(/runs inside pi in every session/i);
		expect(desc).toMatch(/what the AI agent can do/i);
	});
});
