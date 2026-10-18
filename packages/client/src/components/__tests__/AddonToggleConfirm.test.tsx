/**
 * Confirmation before a combined off, stale re-show, reload offer.
 * See change: addons-hub-feature-catalog (test-plan #F2, #F3, #F5).
 */
import type { AddonFeature } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedPackagesSection } from "../packages/UnifiedPackagesSection.js";
import { feature, goalFeature, part, plugin } from "./addons-feature-fixtures.js";

const mockCatalog = vi.fn<() => { features: AddonFeature[]; isLoading: boolean; error: string | null; refresh: () => Promise<void> }>();
const refresh = vi.fn().mockResolvedValue(undefined);

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

const report = (extra: Record<string, unknown> = {}) => ({
	success: true,
	cascaded: [],
	filtered: [],
	restored: [],
	keptOn: [],
	requiredBy: [],
	restoreSkipped: [],
	stillLoadedIn: [],
	restartRequired: true,
	...extra,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Handler = (body: Record<string, unknown>) => Response;
function stub(handler: Handler) {
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		if (String(url).includes("/toggle")) return handler(JSON.parse(init?.body as string));
		if (String(url).includes("/api/resources/reload")) return json({ success: true, data: { reloaded: 1 } });
		return json({ success: true, data: [] });
	});
	vi.stubGlobal("fetch", fn);
	return fn;
}
const toggleBodies = (fn: ReturnType<typeof vi.fn>) =>
	fn.mock.calls.filter(([u]) => String(u).includes("/toggle")).map(([, init]) => JSON.parse((init as RequestInit).body as string));

beforeEach(() => {
	localStorage.clear();
	mockCatalog.mockReturnValue({
		features: [
			goalFeature(),
			feature("plugin:cascade", { displayName: "Cascade dep", plugin: plugin("cascade") }),
			feature("plugin:other", { displayName: "OtherPlugin", plugin: plugin("other") }),
			feature("pkg:npm:kept", { displayName: "KeptPkg", packages: [part("npm:kept")] }),
		],
		isLoading: false,
		error: null,
		refresh,
	});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe("combined off confirmation", () => {
	// test-plan #F2
	it("F2: cancel writes nothing; confirm posts the confirmToken; dialog names every effect", async () => {
		const fn = stub((b) =>
			b.dryRun
				? json(
						report({
							dryRun: true,
							filtered: ["npm:@ricoyudog/pi-goal-hermes"],
							cascaded: ["plugin:cascade"],
							keptOn: [{ source: "npm:kept", by: ["plugin:other"] }],
							stillLoadedIn: [{ source: "npm:@ricoyudog/pi-goal-hermes", folders: ["/repo"] }],
							confirmToken: "tok-1",
						}),
					)
				: json(report({ filtered: ["npm:@ricoyudog/pi-goal-hermes"] })),
		);
		render(<UnifiedPackagesSection />);

		fireEvent.click(screen.getByTestId("addon-switch-plugin:goal"));
		const dialog = await screen.findByTestId("addon-toggle-confirm");
		expect(screen.getByTestId("addon-toggle-stops").textContent).toMatch(/dashboard UI.*AI-agent part/);
		expect(screen.getByTestId("addon-toggle-cascaded").textContent).toContain("Cascade dep");
		const kept = screen.getByTestId("addon-toggle-kept-on");
		expect(kept.textContent).toContain("npm:kept");
		expect(kept.querySelector("a")?.getAttribute("href")).toBe("#addon-row-plugin-other");
		expect(screen.getByTestId("addon-toggle-folders").textContent).toContain("/repo");
		expect(dialog).toBeTruthy();

		fireEvent.click(screen.getByTestId("addon-toggle-cancel"));
		expect(screen.queryByTestId("addon-toggle-confirm")).toBeNull();
		expect(toggleBodies(fn).every((b) => b.dryRun === true)).toBe(true);

		fireEvent.click(screen.getByTestId("addon-switch-plugin:goal"));
		await screen.findByTestId("addon-toggle-confirm");
		fireEvent.click(screen.getByTestId("addon-toggle-confirm-button"));
		await waitFor(() => expect(toggleBodies(fn).some((b) => !b.dryRun)).toBe(true));
		expect(toggleBodies(fn).find((b) => !b.dryRun)).toEqual({ enabled: false, confirmToken: "tok-1" });
		await waitFor(() => expect(refresh).toHaveBeenCalled());
	});

	// test-plan #F3
	it("F3: a 409 stale-confirmation re-renders the dialog with the fresh report", async () => {
		let n = 0;
		stub((b) => {
			if (b.dryRun) return json(report({ dryRun: true, filtered: ["npm:a"], confirmToken: "old" }));
			n++;
			return json(report({ reason: "stale-confirmation", success: false, filtered: ["npm:a"], keptOn: [{ source: "npm:kept", by: ["plugin:other"] }], confirmToken: "new" }), 409);
		});
		render(<UnifiedPackagesSection />);
		fireEvent.click(screen.getByTestId("addon-switch-plugin:goal"));
		await screen.findByTestId("addon-toggle-confirm");
		expect(screen.queryByTestId("addon-toggle-kept-on")).toBeNull();
		fireEvent.click(screen.getByTestId("addon-toggle-confirm-button"));
		await screen.findByTestId("addon-toggle-kept-on");
		expect(n).toBe(1);
		expect(screen.getByTestId("addon-toggle-confirm")).toBeTruthy();
		expect(screen.queryByTestId("addon-reload-banner")).toBeNull();
	});

	// test-plan #F5
	it("F5: a successful toggle offers the session reload once", async () => {
		const fn = stub((b) => (b.dryRun ? json(report({ dryRun: true, filtered: ["npm:a"], confirmToken: "t" })) : json(report())));
		render(<UnifiedPackagesSection />);
		fireEvent.click(screen.getByTestId("addon-switch-plugin:goal"));
		await screen.findByTestId("addon-toggle-confirm");
		fireEvent.click(screen.getByTestId("addon-toggle-confirm-button"));
		await screen.findByTestId("addon-reload-banner");
		expect(screen.getAllByTestId("addon-reload-banner")).toHaveLength(1);
		await act(async () => {
			fireEvent.click(screen.getByTestId("addon-reload-button"));
		});
		expect(fn.mock.calls.some(([u]) => String(u).includes("/api/resources/reload"))).toBe(true);
	});

	it("turning a feature ON posts straight away, no confirmation", async () => {
		const fn = stub(() => json(report({ restored: ["npm:@ricoyudog/pi-goal-hermes"] })));
		mockCatalog.mockReturnValue({ features: [goalFeature({ state: "off" })], isLoading: false, error: null, refresh });
		render(<UnifiedPackagesSection />);
		fireEvent.click(screen.getByTestId("addon-switch-plugin:goal"));
		await waitFor(() => expect(toggleBodies(fn)).toEqual([{ enabled: true }]));
		expect(screen.queryByTestId("addon-toggle-confirm")).toBeNull();
	});
});
