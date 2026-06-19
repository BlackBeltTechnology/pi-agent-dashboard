import { describe, it, expect } from "vitest";
import { parseSourceKey, sourcesMatch } from "../source-matching.js";

describe("parseSourceKey", () => {
	it("parses npm:<name>", () => {
		expect(parseSourceKey("npm:pi-web-access")).toEqual({ kind: "npm", name: "pi-web-access" });
	});

	it("parses npm:<name>@<version>", () => {
		expect(parseSourceKey("npm:pi-web-access@0.10.6")).toEqual({
			kind: "npm",
			name: "pi-web-access",
		});
	});

	it("parses scoped npm name without version", () => {
		expect(parseSourceKey("npm:@scope/example-pkg")).toEqual({
			kind: "npm",
			name: "@scope/example-pkg",
		});
	});

	it("parses scoped npm name with version", () => {
		expect(parseSourceKey("npm:@scope/example-pkg@0.5.2")).toEqual({
			kind: "npm",
			name: "@scope/example-pkg",
		});
	});

	it("parses git SSH sources", () => {
		expect(parseSourceKey("git@github.com:BlackBeltTechnology/pi-flows.git")).toEqual({
			kind: "git",
			host: "github.com",
			owner: "BlackBeltTechnology",
			repo: "pi-flows",
		});
	});

	it("parses git HTTPS sources", () => {
		expect(parseSourceKey("https://github.com/BlackBeltTechnology/pi-flows.git")).toEqual({
			kind: "git",
			host: "github.com",
			owner: "BlackBeltTechnology",
			repo: "pi-flows",
		});
	});

	it("parses git:<host>/... sources", () => {
		expect(parseSourceKey("git:github.com/BlackBeltTechnology/pi-flows#main")).toEqual({
			kind: "git",
			host: "github.com",
			owner: "BlackBeltTechnology",
			repo: "pi-flows",
		});
	});

	it("returns raw for local paths", () => {
		expect(parseSourceKey("../pi-flows")).toEqual({ kind: "raw", source: "../pi-flows" });
		expect(parseSourceKey("/abs/path")).toEqual({ kind: "raw", source: "/abs/path" });
	});
});

describe("sourcesMatch", () => {
	it("matches npm by name regardless of version", () => {
		expect(sourcesMatch("npm:pi-web-access@0.10.6", "npm:pi-web-access")).toBe(true);
	});

	it("matches scoped npm names", () => {
		expect(
			sourcesMatch("npm:@scope/example-pkg@0.5.2", "npm:@scope/example-pkg"),
		).toBe(true);
	});

	it("matches git SSH vs HTTPS forms", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"https://github.com/BlackBeltTechnology/pi-flows.git",
			),
		).toBe(true);
	});

	it("is case-insensitive for git host/owner/repo", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"git@github.com:blackbelttechnology/pi-flows.git",
			),
		).toBe(true);
	});

	it("distinguishes different repos", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
			),
		).toBe(false);
	});

	it("distinguishes different npm names", () => {
		expect(sourcesMatch("npm:pi-web-access", "npm:pi-agent-browser")).toBe(false);
	});

	it("cross-matches git URL against local path whose basename is the repo", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"../pi-flows",
			),
		).toBe(true);
		expect(
			sourcesMatch(
				"../pi-anthropic-messages/",
				"git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
			),
		).toBe(true);
		expect(
			sourcesMatch(
				"git@github.com:Org/pi-flows.git",
				"/abs/path/to/pi-flows.git",
			),
		).toBe(true);
	});

	it("does not cross-match a git URL against an unrelated local path", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"../pi-web-access",
			),
		).toBe(false);
	});

	it("does not cross-match a git URL against a deep local path", () => {
		expect(
			sourcesMatch(
				"git@github.com:BlackBeltTechnology/pi-flows.git",
				"../pi-flows/packages/core",
			),
		).toBe(false);
	});

	it("cross-matches a git URL against an npm install whose unscoped name is the repo", () => {
		expect(
			sourcesMatch(
				"https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
				"npm:@blackbelt-technology/pi-anthropic-messages",
			),
		).toBe(true);
		// order-independent
		expect(
			sourcesMatch(
				"npm:@blackbelt-technology/pi-anthropic-messages@0.3.2",
				"git@github.com:BlackBeltTechnology/pi-anthropic-messages.git",
			),
		).toBe(true);
	});

	it("does not cross-match a git URL against an unrelated npm package", () => {
		expect(
			sourcesMatch(
				"https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
				"npm:@blackbelt-technology/pi-image-fit",
			),
		).toBe(false);
	});

	it("cross-matches an npm install against a local path whose basename is the unscoped name", () => {
		// A local checkout (`pi install -l ../pi-anthropic-messages`) of a
		// package whose manifest source is the npm scope. See change:
		// suppress-hidden-session-auto-navigation (develop regression follow-up).
		expect(
			sourcesMatch(
				"npm:@blackbelt-technology/pi-anthropic-messages",
				"../pi-anthropic-messages",
			),
		).toBe(true);
		// order-independent + trailing slash + version suffix tolerated
		expect(
			sourcesMatch(
				"../pi-anthropic-messages/",
				"npm:@blackbelt-technology/pi-anthropic-messages@0.3.2",
			),
		).toBe(true);
		// unscoped npm name also matches
		expect(sourcesMatch("npm:pi-web-access", "/abs/path/to/pi-web-access")).toBe(true);
	});

	it("does not cross-match an npm package against an unrelated local path", () => {
		expect(
			sourcesMatch(
				"npm:@blackbelt-technology/pi-anthropic-messages",
				"../pi-web-access",
			),
		).toBe(false);
	});
});
