import { describe, it, expect } from "vitest";
import {
	classifySource,
	groupInstalledPackages,
	isSourceOverride,
	npmNameFromSource,
} from "../package/package-classifier.js";
import type { InstalledPackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

describe("classifySource", () => {
	it("identifies npm sources", () => {
		expect(classifySource("npm:pi-flows")).toBe("npm");
		expect(classifySource("npm:@scope/example-pkg")).toBe("npm");
		expect(classifySource("npm:pi-flows@1.2.3")).toBe("npm");
	});

	it("identifies git sources by URL shape", () => {
		expect(classifySource("https://github.com/x/y.git")).toBe("git");
		expect(classifySource("git@github.com:x/y.git")).toBe("git");
		expect(classifySource("ssh://git@host/x/y.git")).toBe("git");
	});

	it("identifies git:-prefixed sources (regression: not global)", () => {
		// Divergence guard: parseSourceKey treats git: as git; classifySource
		// must agree so a git-prefixed override badges `git`, not `global`.
		expect(classifySource("git:github.com/o/r")).toBe("git");
		expect(classifySource("git:github.com/o/r#main")).toBe("git");
		expect(classifySource("git:github.com/o/r.git")).toBe("git");
	});

	it("identifies local sources by path shape", () => {
		expect(classifySource("/abs/path")).toBe("local");
		expect(classifySource("./rel/path")).toBe("local");
		expect(classifySource("../up/path")).toBe("local");
		expect(classifySource("file:///abs")).toBe("local");
		expect(classifySource("C:/Users/me/pkg")).toBe("local");
		expect(classifySource("D:\\drive\\path")).toBe("local");
	});

	it("falls back to global for unrecognized shapes", () => {
		expect(classifySource("@mariozechner/pi-coding-agent")).toBe("global");
		expect(classifySource("pi-coding-agent")).toBe("global");
	});
});

describe("npmNameFromSource", () => {
	it("returns null for non-npm sources", () => {
		expect(npmNameFromSource("https://github.com/x/y.git")).toBeNull();
		expect(npmNameFromSource("/local/path")).toBeNull();
	});

	it("strips version pin from bare npm specs", () => {
		expect(npmNameFromSource("npm:pi-flows")).toBe("pi-flows");
		expect(npmNameFromSource("npm:pi-flows@1.2.3")).toBe("pi-flows");
	});

	it("strips version pin from scoped npm specs", () => {
		expect(npmNameFromSource("npm:@scope/name")).toBe("@scope/name");
		expect(npmNameFromSource("npm:@scope/name@1.0.0")).toBe("@scope/name");
		expect(npmNameFromSource("npm:@scope/example-pkg@^0.6.1")).toBe("@scope/example-pkg");
	});
});

describe("isSourceOverride", () => {
	function pkg(source: string, isRecommended?: boolean): InstalledPackage {
		return { source, scope: "user", filtered: false, isRecommended };
	}

	it("is true for a recommended package installed from local/git", () => {
		expect(isSourceOverride(pkg("/home/dev/pi-flows", true))).toBe(true);
		expect(isSourceOverride(pkg("git@github.com:o/r.git", true))).toBe(true);
		expect(isSourceOverride(pkg("git:github.com/o/r", true))).toBe(true);
	});

	it("is false for a recommended package installed from npm", () => {
		expect(isSourceOverride(pkg("npm:pi-flows", true))).toBe(false);
		expect(isSourceOverride(pkg("npm:@scope/name@1.0.0", true))).toBe(false);
	});

	it("is false for non-recommended local/git rows", () => {
		expect(isSourceOverride(pkg("/home/dev/thing", false))).toBe(false);
		expect(isSourceOverride(pkg("git:github.com/o/r", false))).toBe(false);
	});

	it("is false when isRecommended is undefined (un-enriched row)", () => {
		expect(isSourceOverride(pkg("/home/dev/thing"))).toBe(false);
	});
});

describe("groupInstalledPackages", () => {
	const CORE_NAMES = [
		"@mariozechner/pi-coding-agent",
		"@blackbelt-technology/pi-agent-dashboard",
	];

	function row(source: string, isRecommended: boolean): InstalledPackage {
		return { source, scope: "user", filtered: false, isRecommended };
	}

	it("splits into recommended and other by flag", () => {
		const installed = [
			row("npm:pi-agent-browser", true),
			row("/dev/local-thing", false),
		];
		const out = groupInstalledPackages(installed, CORE_NAMES);
		expect(out.recommended.map((r) => r.source)).toEqual(["npm:pi-agent-browser"]);
		expect(out.other.map((r) => r.source)).toEqual(["/dev/local-thing"]);
	});

	it("drops Core whitelist members from Other (Core wins)", () => {
		const installed = [
			row("npm:@mariozechner/pi-coding-agent", false),
			row("npm:@blackbelt-technology/pi-agent-dashboard", false),
			row("/dev/extra", false),
		];
		const out = groupInstalledPackages(installed, CORE_NAMES);
		expect(out.recommended).toEqual([]);
		expect(out.other.map((r) => r.source)).toEqual(["/dev/extra"]);
	});

	it("drops Core whitelist members from Recommended too", () => {
		// Defensive: even if Core somehow flagged isRecommended, it's dropped.
		const installed = [row("npm:@mariozechner/pi-coding-agent", true)];
		const out = groupInstalledPackages(installed, CORE_NAMES);
		expect(out.recommended).toEqual([]);
		expect(out.other).toEqual([]);
	});

	it("preserves non-npm rows that don't match Core", () => {
		const installed = [
			row("https://github.com/x/y.git", true),
			row("/abs/dev", false),
		];
		const out = groupInstalledPackages(installed, CORE_NAMES);
		expect(out.recommended.length).toBe(1);
		expect(out.other.length).toBe(1);
	});
});
