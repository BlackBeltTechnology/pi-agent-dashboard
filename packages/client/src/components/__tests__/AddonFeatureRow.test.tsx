/**
 * Installed-tab feature rows. See change: addons-hub-feature-catalog
 * (test-plan #E21, #E22, #F1).
 */
import type { AddonFeature } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

function withFeatures(features: AddonFeature[], updates: string[] = []) {
	mockCatalog.mockReturnValue({ features, isLoading: false, error: null, refresh: vi.fn().mockResolvedValue(undefined) });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) =>
			String(url).includes("check-updates")
				? new Response(JSON.stringify({ success: true, data: updates.map((source) => ({ source })) }))
				: new Response(JSON.stringify({ success: true, dryRun: true, cascaded: [], filtered: [], restored: [], keptOn: [], requiredBy: [], restoreSkipped: [], stillLoadedIn: [], restartRequired: true, confirmToken: "t" })),
		),
	);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("Installed tab feature rows", () => {
	// test-plan #E21
	it("E21: Goal is one row with the mixed badge and part chips; package and bridge have no row", () => {
		withFeatures([goalFeature()]);
		render(<UnifiedPackagesSection />);
		expect(document.querySelectorAll('[data-testid^="addon-row-"]')).toHaveLength(1);
		expect(screen.getByTestId("addon-origin-plugin:goal").textContent).toBe("dashboard UI · ext by @ricoyudog");
		const row = within(screen.getByTestId("addon-row-plugin:goal"));
		for (const kind of ["dashboard-ui", "bridge", "extension"]) expect(row.getByTestId(`part-chip-${kind}`)).toBeTruthy();
		expect(screen.queryByText("index.ts")).toBeNull();
	});

	// test-plan #E22
	it("E22: per-part actions; one Reset naming the local part; none on core or dashboard-only", async () => {
		const multi = feature("plugin:multi", {
			displayName: "Multi",
			plugin: plugin("multi"),
			packages: [
				part("npm:@a/one", { packageName: "@a/one" }),
				part("/repo/local-two", { packageName: "local-two", publishedVariantSource: "npm:local-two", publishedVariantVersion: "2.0.0" }),
			],
			bridge: { path: "/r/b.ts" },
		});
		const only = feature("plugin:only", { displayName: "OnlyDash", plugin: plugin("only") });
		const core = feature("core:dashboard-bridge", { displayName: "Bridge", kind: "core", origin: "first-party", packages: [part("npm:@blackbelt-technology/pi-dashboard-extension")] });
		withFeatures([multi, only, core], ["npm:@a/one", "/repo/local-two"]);
		render(<UnifiedPackagesSection />);
		await waitFor(() => expect(screen.getByTestId("addon-update-plugin:multi")).toBeTruthy());

		fireEvent.click(screen.getByTestId("addon-menu-plugin:multi"));
		const menu = within(screen.getByRole("menu"));
		for (const base of ["Update", "Move → Local", "Uninstall"]) {
			expect(menu.getByText(`${base} — @a/one`)).toBeTruthy();
			expect(menu.getByText(`${base} — local-two`)).toBeTruthy();
		}
		const resets = menu.getAllByText(/Reset to published version/);
		expect(resets).toHaveLength(1);
		expect(resets[0].textContent).toContain("local-two");
		expect(screen.queryByTestId("addon-menu-plugin:only")).toBeNull();

		fireEvent.click(screen.getByTestId("addon-menu-plugin:multi")); // close
		fireEvent.click(screen.getByTestId("addon-menu-core:dashboard-bridge"));
		const coreMenu = within(screen.getAllByRole("menu")[0]);
		expect(coreMenu.queryByText(/Uninstall/)).toBeNull();
	});

	// test-plan #F1
	it("F1: a partial feature exposes aria-checked=mixed, says partly on, and asks for the off confirmation via a dry run", async () => {
		withFeatures([goalFeature({ state: "partial" })]);
		render(<UnifiedPackagesSection />);
		const sw = screen.getByTestId("addon-switch-plugin:goal");
		expect(sw.getAttribute("role")).toBe("checkbox");
		expect(sw.getAttribute("aria-checked")).toBe("mixed");
		expect(screen.getByText("partly on")).toBeTruthy();
		fireEvent.click(sw);
		await waitFor(() => expect(screen.getByTestId("addon-toggle-confirm")).toBeTruthy());
		const post = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([u]) => String(u).includes("/toggle"));
		const init = (post as unknown[] | undefined)?.[1] as RequestInit;
		expect(JSON.parse(init.body as string)).toEqual({ enabled: false, dryRun: true });
	});
});
