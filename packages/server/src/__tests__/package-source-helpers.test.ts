import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseSourceKind, computeIdentity } from "../package/package-source-helpers.js";

describe("parseSourceKind", () => {
	it.each([
		["npm:foo", "npm"],
		["npm:@scope/pkg", "npm"],
		["npm:@scope/pkg@1.2.3", "npm"],
		["npm:foo@^1.0.0", "npm"],
	])("npm:* → npm  (%s)", (s, expected) => {
		expect(parseSourceKind(s)).toBe(expected);
	});

	it.each([
		["git:github.com/x/y", "git"],
		["git:github.com/x/y@v1", "git"],
		["git:git@github.com:x/y", "git"],
		["git:git@github.com:x/y@v1.0.0", "git"],
	])("git:* → git  (%s)", (s, expected) => {
		expect(parseSourceKind(s)).toBe(expected);
	});

	it.each([
		["https://github.com/x/y", "https"],
		["https://github.com/x/y@v1", "https"],
		["http://example.com/repo", "https"],
		["ssh://git@github.com/x/y", "https"],
		["git://github.com/x/y", "https"],
	])("protocol url → https  (%s)", (s, expected) => {
		expect(parseSourceKind(s)).toBe(expected);
	});

	it("/abs → abs-path", () => {
		expect(parseSourceKind("/abs/path")).toBe("abs-path");
	});

	it.each([".", "..", "./foo", "../foo", "./foo/bar"])(
		"%s → rel-path",
		(s) => {
			expect(parseSourceKind(s)).toBe("rel-path");
		},
	);

	it("Windows abs path → abs-path", () => {
		expect(parseSourceKind("C:\\abs\\path")).toBe("abs-path");
		expect(parseSourceKind("C:/abs/path")).toBe("abs-path");
	});
});

describe("computeIdentity", () => {
	it("npm: identity = bare package name without version", () => {
		expect(computeIdentity("npm:foo")).toBe("npm:foo");
		expect(computeIdentity("npm:foo@1.2.3")).toBe("npm:foo");
		expect(computeIdentity("npm:@scope/pkg")).toBe("npm:@scope/pkg");
		expect(computeIdentity("npm:@scope/pkg@1.2.3")).toBe("npm:@scope/pkg");
		expect(computeIdentity("npm:@scope/pkg@^1.0.0")).toBe("npm:@scope/pkg");
	});

	it("git: identity = repo url without ref", () => {
		expect(computeIdentity("git:github.com/x/y")).toBe(
			"git:github.com/x/y",
		);
		expect(computeIdentity("git:github.com/x/y@v1.2.3")).toBe(
			"git:github.com/x/y",
		);
		expect(computeIdentity("git:git@github.com:x/y@v1")).toBe(
			"git:git@github.com:x/y",
		);
	});

	it("https/ssh url identity strips trailing @ref", () => {
		expect(computeIdentity("https://github.com/x/y")).toBe(
			"https://github.com/x/y",
		);
		expect(computeIdentity("https://github.com/x/y@v1")).toBe(
			"https://github.com/x/y",
		);
		expect(computeIdentity("ssh://git@github.com/x/y@v1")).toBe(
			"ssh://git@github.com/x/y",
		);
	});

	it("absolute-path identity = the path itself", () => {
		expect(computeIdentity("/abs/path")).toBe("/abs/path");
	});

	it("relative-path identity = path resolved against settingsDir", () => {
		const cwd = "/proj/.pi";
		expect(computeIdentity("..", cwd)).toBe(path.resolve("/proj/.pi/.."));
		expect(computeIdentity("./foo", cwd)).toBe(
			path.resolve("/proj/.pi/foo"),
		);
	});

	it("relative-path without settingsDir falls back to literal", () => {
		// Defensive: if we don't know the anchor, return a stable string
		// that won't accidentally match any other entry's identity.
		expect(computeIdentity("..")).toBe("..");
	});
});
