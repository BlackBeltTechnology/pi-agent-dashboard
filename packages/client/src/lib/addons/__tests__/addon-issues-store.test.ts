/**
 * Folds `plugins_changed` into the shared Add-ons issue snapshot with NO `GET /api/plugins`, and refreshes health
 * alone after a package operation (test-plan #F6 — a second consumer must not refetch the plugin list).
 * See change: decouple-plugins-from-core (task 8.86).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listPlugins = vi.fn();
const fetchPackageHealth = vi.fn();
vi.mock("../../package/plugins-api.js", () => ({ listPlugins: (...a: unknown[]) => listPlugins(...a) }));
vi.mock("../../package/package-health-api.js", () => ({
	fetchPackageHealth: (...a: unknown[]) => fetchPackageHealth(...a),
	countHealthIssues: (h: { entries?: Array<{ status: string }> }) => (h.entries ?? []).filter((e) => e.status !== "ok").length,
}));

import { __resetAddonIssuesStore, applyPluginsSnapshot, getAddonIssues, refreshAddonHealth } from "../addon-issues-store.js";

const status = (id: string, over: Record<string, unknown> = {}) =>
	({ id, displayName: id, enabled: true, loaded: true, claims: 0, ...over }) as never;

describe("addon issues store — plugins_changed fold", () => {
	beforeEach(() => {
		__resetAddonIssuesStore();
		listPlugins.mockReset();
		fetchPackageHealth.mockReset();
	});
	afterEach(() => vi.restoreAllMocks());

	it("recomputes plugin issues from a snapshot without calling listPlugins", () => {
		applyPluginsSnapshot([status("ok-plugin"), status("broken", { loaded: false, error: "boom" }), status("off", { enabled: false, error: "x" })]);
		expect(getAddonIssues().pluginIssues.map((r) => r.id)).toEqual(["broken"]);
		expect(getAddonIssues().count).toBe(1);
		expect(listPlugins).not.toHaveBeenCalled();
	});

	it("drops an issue that the next snapshot no longer reports", () => {
		applyPluginsSnapshot([status("broken", { error: "boom" })]);
		applyPluginsSnapshot([status("broken")]);
		expect(getAddonIssues().pluginIssues).toEqual([]);
	});

	it("refreshAddonHealth refetches health only and keeps the plugin issues", async () => {
		applyPluginsSnapshot([status("broken", { error: "boom" })]);
		fetchPackageHealth.mockResolvedValue({ entries: [{ status: "missing" }, { status: "ok" }] });
		await refreshAddonHealth();
		expect(listPlugins).not.toHaveBeenCalled();
		expect(getAddonIssues().count).toBe(2); // 1 plugin issue + 1 non-ok health entry
		expect(getAddonIssues().loaded).toBe(true);
	});
});
