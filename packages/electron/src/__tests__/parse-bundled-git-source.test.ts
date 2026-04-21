import { describe, it, expect } from "vitest";
import { parseBundledGitSource } from "../lib/dependency-installer.js";

describe("parseBundledGitSource", () => {
	it("parses https GitHub URL with .git suffix", () => {
		expect(
			parseBundledGitSource(
				"https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
			),
		).toEqual({
			host: "github.com",
			path: "BlackBeltTechnology/pi-anthropic-messages",
		});
	});

	it("parses https GitHub URL without .git", () => {
		expect(parseBundledGitSource("https://github.com/org/repo")).toEqual({
			host: "github.com",
			path: "org/repo",
		});
	});

	it("parses SCP-like SSH form", () => {
		expect(parseBundledGitSource("git@github.com:org/repo.git")).toEqual({
			host: "github.com",
			path: "org/repo",
		});
	});

	it("parses ssh:// URL", () => {
		expect(parseBundledGitSource("ssh://git@github.com/org/repo.git")).toEqual({
			host: "github.com",
			path: "org/repo",
		});
	});

	it("strips trailing @ref in path", () => {
		expect(
			parseBundledGitSource("https://github.com/org/repo@v1.2.3"),
		).toEqual({ host: "github.com", path: "org/repo" });
	});

	it("returns null for npm sources", () => {
		expect(parseBundledGitSource("npm:some-package")).toBeNull();
	});

	it("returns null for bare package names", () => {
		expect(parseBundledGitSource("some-local-path")).toBeNull();
	});

	it("accepts explicit git: prefix", () => {
		expect(
			parseBundledGitSource("git:https://github.com/org/repo.git"),
		).toEqual({ host: "github.com", path: "org/repo" });
	});
});
