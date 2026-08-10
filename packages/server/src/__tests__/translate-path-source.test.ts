import { describe, it, expect } from "vitest";
import path from "node:path";
import { translatePathSource } from "../package/package-manager-wrapper.js";

describe("translatePathSource", () => {
	const fromLocal = "/abs/project/.pi";
	const toGlobal = "/Users/u/.pi/agent";
	const toLocal = "/abs/other/.pi";

	it("rel-path → global resolves to absolute against fromSettingsDir", () => {
		expect(
			translatePathSource({
				originalSource: "..",
				fromSettingsDir: fromLocal,
				toSettingsDir: toGlobal,
				toScope: "global",
			}),
		).toBe(path.resolve("/abs/project/.pi/.."));
	});

	it("./foo → global resolves to absolute", () => {
		expect(
			translatePathSource({
				originalSource: "./foo",
				fromSettingsDir: fromLocal,
				toSettingsDir: toGlobal,
				toScope: "global",
			}),
		).toBe(path.resolve("/abs/project/.pi/foo"));
	});

	it("abs-path → local stays absolute when relative form escapes >2 levels", () => {
		// /abs/project from /abs/other/.pi  →  ../../project (2 ups, OK)
		// /tmp/foo     from /abs/other/.pi  →  ../../../tmp/foo (3 ups, escape)
		expect(
			translatePathSource({
				originalSource: "/tmp/foo",
				fromSettingsDir: fromLocal,
				toSettingsDir: toLocal,
				toScope: "local",
			}),
		).toBe("/tmp/foo");
	});

	it("abs-path → local goes relative when within 2 levels", () => {
		expect(
			translatePathSource({
				originalSource: "/abs/project",
				fromSettingsDir: fromLocal,
				toSettingsDir: toLocal,
				toScope: "local",
			}),
		).toBe("../../project");
	});

	it("abs-path equal to toSettingsDir collapses to '.'", () => {
		expect(
			translatePathSource({
				originalSource: "/abs/other/.pi",
				fromSettingsDir: fromLocal,
				toSettingsDir: toLocal,
				toScope: "local",
			}),
		).toBe(".");
	});

	it("abs-path → global stays absolute", () => {
		expect(
			translatePathSource({
				originalSource: "/abs/project/vendor/x",
				fromSettingsDir: fromLocal,
				toSettingsDir: toGlobal,
				toScope: "global",
			}),
		).toBe("/abs/project/vendor/x");
	});
});
