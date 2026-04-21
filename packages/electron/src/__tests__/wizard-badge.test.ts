import { describe, it, expect } from "vitest";
import { classifyProgressBadge } from "../lib/wizard-badge.js";

describe("classifyProgressBadge", () => {
	it("classifies bundled fresh copy", () => {
		expect(classifyProgressBadge("Bundled")).toBe("bundled");
	});

	it("classifies bundled-skip from the dynamic installer", () => {
		expect(classifyProgressBadge("Already installed (bundled)")).toBe("bundled");
	});

	it("classifies bundled-skip from installBundledExtensions()", () => {
		expect(classifyProgressBadge("Already installed")).toBe("system");
	});

	it("classifies system-already-present skip", () => {
		expect(classifyProgressBadge("Already installed (system)")).toBe("system");
	});

	it("returns null for normal fresh install output", () => {
		expect(classifyProgressBadge("npm install --omit=dev")).toBe(null);
	});

	it("returns null for undefined/empty output", () => {
		expect(classifyProgressBadge(undefined)).toBe(null);
		expect(classifyProgressBadge("")).toBe(null);
	});
});
