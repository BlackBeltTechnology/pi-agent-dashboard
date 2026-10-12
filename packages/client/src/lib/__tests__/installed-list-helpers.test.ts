/**
 * Pure helpers behind the Add-ons installed list.
 * See change: addons-hub-declutter (task 4.2; test-plan E8, E10).
 */
import { describe, expect, it } from "vitest";
import {
	EMPTY_INSTALLED_FILTER,
	filterInstalledRows,
	isInstalledFilterActive,
	isLocalSourceRow,
	visibleInstalledRows,
} from "../package/installed-list-helpers.js";

const row = (source: string, extra: Record<string, unknown> = {}) => ({ source, ...extra });

describe("visibleInstalledRows", () => {
	it("drops dashboardManaged rows and keeps every other row", () => {
		const rows = [row("/r/a/bridge/index.ts", { dashboardManaged: true }), row("npm:x"), row("/r/b", { dashboardManaged: false })];
		expect(visibleInstalledRows(rows).map((r) => r.source)).toEqual(["npm:x", "/r/b"]);
	});
});

describe("isLocalSourceRow", () => {
	it.each([
		["/abs/path", true],
		["./rel", true],
		["git@github.com:u/r.git", true],
		["https://github.com/u/r.git", true],
		["npm:pkg", false],
	])("%s → %s", (source, expected) => {
		expect(isLocalSourceRow({ source })).toBe(expected);
	});
});

describe("filterInstalledRows", () => {
	const rows = [
		row("npm:hermes", { displayName: "Hermes Memory", description: "persistent memory" }),
		row("/local/flows", { displayName: "pi-flows", description: "Flow engine" }),
		row("npm:other", { displayName: "Other", description: "nothing" }),
	];
	const upd = (r: { source: string }) => r.source === "npm:other";

	it("matches name, source and description case-insensitively", () => {
		const f = { ...EMPTY_INSTALLED_FILTER, text: "MEMORY" };
		expect(filterInstalledRows(rows, f, upd).map((r) => r.source)).toEqual(["npm:hermes"]);
		expect(filterInstalledRows(rows, { ...f, text: "/local" }, upd)).toHaveLength(1);
		expect(filterInstalledRows(rows, { ...f, text: "flow engine" }, upd)).toHaveLength(1);
	});

	it("ANDs the text filter with the chips", () => {
		expect(filterInstalledRows(rows, { text: "flows", localOnly: true, updateOnly: false }, upd)).toHaveLength(1);
		expect(filterInstalledRows(rows, { text: "hermes", localOnly: true, updateOnly: false }, upd)).toHaveLength(0);
		expect(filterInstalledRows(rows, { text: "", localOnly: false, updateOnly: true }, upd).map((r) => r.source)).toEqual(["npm:other"]);
	});

	it("reports whether any filter is active (whitespace-only text is not)", () => {
		expect(isInstalledFilterActive(EMPTY_INSTALLED_FILTER)).toBe(false);
		expect(isInstalledFilterActive({ ...EMPTY_INSTALLED_FILTER, text: "  " })).toBe(false);
		expect(isInstalledFilterActive({ ...EMPTY_INSTALLED_FILTER, localOnly: true })).toBe(true);
	});
});
