import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { PiCoreChecker, CORE_PACKAGE_NAMES, _internal } from "../pi/pi-core-checker.js";

describe("PiCoreChecker._internal.looksLikePiEcosystem", () => {
	it("matches every known core package", () => {
		for (const name of CORE_PACKAGE_NAMES) {
			expect(_internal.looksLikePiEcosystem(name)).toBe(true);
		}
	});

	it("rejects pi-* prefixed packages that are NOT in the whitelist (no heuristic)", () => {
		// These were previously matched by the dropped pi-* heuristic.
		expect(_internal.looksLikePiEcosystem("pi-web-access")).toBe(false);
		expect(_internal.looksLikePiEcosystem("pi-agent-browser")).toBe(false);
		expect(_internal.looksLikePiEcosystem("pi-flows")).toBe(false);
		expect(_internal.looksLikePiEcosystem("pi-anthropic-messages")).toBe(false);
	});

	it("rejects scoped pi-* packages that are NOT in the whitelist", () => {
		expect(_internal.looksLikePiEcosystem("@scope/pi-fake")).toBe(false);
		expect(_internal.looksLikePiEcosystem("@benvargas/pi-claude-code-use")).toBe(false);
	});

	it("rejects non-pi packages", () => {
		expect(_internal.looksLikePiEcosystem("react")).toBe(false);
		expect(_internal.looksLikePiEcosystem("@types/node")).toBe(false);
		expect(_internal.looksLikePiEcosystem("piano")).toBe(false);
		expect(_internal.looksLikePiEcosystem("@scope/notpi")).toBe(false);
	});
});

describe("PiCoreChecker.getStatus", () => {
	let tmpManagedDir: string;
	let originalOffline: string | undefined;

	beforeEach(() => {
		tmpManagedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-core-test-"));
		// Disable the default pi.dev fetcher in this block so existing
		// tests (which mock fetchLatest only) aren't surprised by live
		// network calls. The pi.dev integration tests in the next describe
		// block inject `fetchPiDevRelease` explicitly and therefore bypass
		// this env. See change: improve-pi-update-detection.
		originalOffline = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
	});

	afterEach(() => {
		if (originalOffline !== undefined) process.env.PI_OFFLINE = originalOffline;
		else delete process.env.PI_OFFLINE;
	});

	function writeManagedPackage(managedDir: string, name: string, version: string) {
		const dir = path.join(managedDir, "node_modules", name);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
	}

	it("discovers global pi packages via npm list (whitelist only)", async () => {
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@earendil-works/pi-coding-agent": { version: "0.67.1" },
						"@blackbelt-technology/pi-agent-dashboard": { version: "0.4.0" },
						"pi-web-access": { version: "0.10.6" }, // NOT in whitelist → ignored
						react: { version: "19.0.0" }, // ignored
					},
				}),
			fetchLatest: async (name) => {
				if (name === "@earendil-works/pi-coding-agent") return "0.67.6";
				if (name === "@blackbelt-technology/pi-agent-dashboard") return "0.4.1";
				return null;
			},
			managedDir: tmpManagedDir,
		});

		const status = await checker.getStatus();

		expect(status.packages.length).toBe(2);
		expect(status.packages.find((p) => p.name === "pi-web-access")).toBeUndefined();

		const pi = status.packages.find((p) => p.name === "@earendil-works/pi-coding-agent")!;
		expect(pi.displayName).toBe("pi (core agent)");
		expect(pi.currentVersion).toBe("0.67.1");
		expect(pi.latestVersion).toBe("0.67.6");
		expect(pi.updateAvailable).toBe(true);
		expect(pi.installSource).toBe("global");

		const dash = status.packages.find((p) => p.name === "@blackbelt-technology/pi-agent-dashboard")!;
		expect(dash.displayName).toBe("pi-dashboard");
		expect(dash.updateAvailable).toBe(true);

		expect(status.updatesAvailable).toBe(2);
	});

	it("recommended-extension packages installed globally are NOT in core discovery", async () => {
		// Regression test for the dropped pi-* heuristic. These rows must
		// surface only via /api/packages/installed.
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"pi-agent-browser": { version: "0.1.0" },
						"pi-web-access": { version: "0.10.6" },
						"pi-dashboard-subagents": { version: "0.1.1" },
					},
				}),
			fetchLatest: async () => null,
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		const status = await checker.getStatus();
		expect(status.packages).toEqual([]);
	});

	it("discovers managed packages and prefers them over global duplicates", async () => {
		writeManagedPackage(tmpManagedDir, "@earendil-works/pi-coding-agent", "0.67.5");

		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@earendil-works/pi-coding-agent": { version: "0.67.1" },
					},
				}),
			fetchLatest: async () => "0.67.6",
			managedDir: tmpManagedDir,
		});

		const status = await checker.getStatus();
		expect(status.packages.length).toBe(1);
		expect(status.packages[0].currentVersion).toBe("0.67.5");
		expect(status.packages[0].installSource).toBe("managed");
	});

	it("managed scan ignores non-whitelisted packages", async () => {
		// Even if a pi-* prefixed package sits in ~/.pi-dashboard/node_modules,
		// it must not appear in core discovery.
		writeManagedPackage(tmpManagedDir, "pi-web-access", "0.10.6");

		const checker = new PiCoreChecker({
			npmList: async () => JSON.stringify({ dependencies: {} }),
			fetchLatest: async () => null,
			managedDir: tmpManagedDir,
		});
		const status = await checker.getStatus();
		expect(status.packages).toEqual([]);
	});

	it("returns empty list when managed dir missing and npm list fails", async () => {
		const checker = new PiCoreChecker({
			npmList: async () => {
				throw new Error("npm not found");
			},
			fetchLatest: async () => null,
			managedDir: path.join(tmpManagedDir, "nonexistent"),
		});
		const status = await checker.getStatus();
		expect(status.packages).toEqual([]);
		expect(status.updatesAvailable).toBe(0);
	});

	it("tolerates non-zero npm list exit when stdout contains valid JSON", async () => {
		const checker = new PiCoreChecker({
			npmList: async () => {
				const err = new Error("npm warn") as Error & { stdout: string };
				err.stdout = JSON.stringify({
					dependencies: {
						"@earendil-works/pi-coding-agent": { version: "0.67.1" },
					},
				});
				throw err;
			},
			fetchLatest: async () => "0.67.6",
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		const status = await checker.getStatus();
		expect(status.packages.length).toBe(1);
		expect(status.packages[0].name).toBe("@earendil-works/pi-coding-agent");
	});

	it("caches results within 5 minutes", async () => {
		let calls = 0;
		const checker = new PiCoreChecker({
			npmList: async () => {
				calls++;
				return JSON.stringify({
					dependencies: { "@earendil-works/pi-coding-agent": { version: "0.67.1" } },
				});
			},
			fetchLatest: async () => "0.67.6",
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		await checker.getStatus();
		await checker.getStatus();
		expect(calls).toBe(1);
	});

	it("force-refresh invalidates the cache", async () => {
		let calls = 0;
		const checker = new PiCoreChecker({
			npmList: async () => {
				calls++;
				return JSON.stringify({
					dependencies: { "@earendil-works/pi-coding-agent": { version: "0.67.1" } },
				});
			},
			fetchLatest: async () => "0.67.6",
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		await checker.getStatus();
		await checker.getStatus(true);
		expect(calls).toBe(2);
	});

	it("treats fetch failure as latestVersion=null, updateAvailable=false", async () => {
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: { "@earendil-works/pi-coding-agent": { version: "0.67.1" } },
				}),
			fetchLatest: async () => {
				throw new Error("network down");
			},
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		const status = await checker.getStatus();
		expect(status.packages.length).toBe(1);
		expect(status.packages[0].latestVersion).toBeNull();
		expect(status.packages[0].updateAvailable).toBe(false);
	});

	it("sorts known core packages in CORE_PACKAGE_NAMES order", async () => {
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@blackbelt-technology/pi-agent-dashboard": { version: "0.4.0" },
						"@earendil-works/pi-coding-agent": { version: "0.67.1" },
					},
				}),
			fetchLatest: async () => null,
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		const status = await checker.getStatus();
		expect(status.packages[0].name).toBe("@earendil-works/pi-coding-agent");
		expect(status.packages[1].name).toBe("@blackbelt-technology/pi-agent-dashboard");
	});
});

describe("PiCoreChecker pi.dev integration", () => {
	let tmpManagedDir: string;

	beforeEach(async () => {
		tmpManagedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-core-pidev-"));
		const { _resetDynamicPiAliases } = await import("../pi/pi-core-checker.js");
		_resetDynamicPiAliases();
	});

	it("prefers pi.dev for @mariozechner/pi-coding-agent latestVersion", async () => {
		let npmCalled = false;
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@mariozechner/pi-coding-agent": { version: "0.70.6" },
					},
				}),
			fetchLatest: async () => {
				npmCalled = true;
				return "0.73.1"; // npm registry says 0.73.1 …
			},
			fetchPiDevRelease: async () => ({ version: "0.74.0" }), // … but pi.dev says 0.74.0
			managedDir: tmpManagedDir,
		});
		const status = await checker.getStatus();
		const pi = status.packages.find((p) => p.name === "@mariozechner/pi-coding-agent")!;
		expect(pi.latestVersion).toBe("0.74.0");
		expect(pi.updateAvailable).toBe(true);
		expect(npmCalled).toBe(false);
	});

	it("falls back to npm registry when pi.dev returns undefined", async () => {
		let npmCalled = false;
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@mariozechner/pi-coding-agent": { version: "0.70.6" },
					},
				}),
			fetchLatest: async () => {
				npmCalled = true;
				return "0.73.1";
			},
			fetchPiDevRelease: async () => undefined, // pi.dev unreachable / skipped
			managedDir: tmpManagedDir,
		});
		const status = await checker.getStatus();
		const pi = status.packages.find((p) => p.name === "@mariozechner/pi-coding-agent")!;
		expect(pi.latestVersion).toBe("0.73.1");
		expect(npmCalled).toBe(true);
	});

	it("falls back to npm registry when pi.dev throws", async () => {
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@mariozechner/pi-coding-agent": { version: "0.70.6" },
					},
				}),
			fetchLatest: async () => "0.73.1",
			fetchPiDevRelease: async () => {
				throw new Error("network down");
			},
			managedDir: tmpManagedDir,
		});
		const status = await checker.getStatus();
		const pi = status.packages.find((p) => p.name === "@mariozechner/pi-coding-agent")!;
		expect(pi.latestVersion).toBe("0.73.1");
	});

	it("does NOT call pi.dev for non-pi packages", async () => {
		let piDevCalled = false;
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@blackbelt-technology/pi-agent-dashboard": { version: "0.4.0" },
					},
				}),
			fetchLatest: async () => "0.5.0",
			fetchPiDevRelease: async () => {
				piDevCalled = true;
				return { version: "99.99.99" };
			},
			managedDir: tmpManagedDir,
		});
		const status = await checker.getStatus();
		const dash = status.packages.find((p) => p.name === "@blackbelt-technology/pi-agent-dashboard")!;
		expect(dash.latestVersion).toBe("0.5.0");
		expect(piDevCalled).toBe(false);
	});

	it("records pi.dev's packageName as a trusted alias", async () => {
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@mariozechner/pi-coding-agent": { version: "0.70.6" },
					},
				}),
			fetchLatest: async () => "0.70.6",
			fetchPiDevRelease: async () => ({
				version: "0.74.0",
				packageName: "@earendil-works/pi-coding-agent",
			}),
			managedDir: tmpManagedDir,
		});
		await checker.getStatus();

		// After the alias is recorded, a second discovery that finds the
		// renamed package should accept it through the whitelist gate.
		writeManagedPackage(tmpManagedDir, "@earendil-works/pi-coding-agent", "0.74.0");
		checker.invalidate();
		const status2 = await checker.getStatus();
		const aliased = status2.packages.find((p) => p.name === "@earendil-works/pi-coding-agent");
		expect(aliased).toBeDefined();
		expect(aliased!.currentVersion).toBe("0.74.0");
	});

	function writeManagedPackage(managedDir: string, name: string, version: string) {
		const dir = path.join(managedDir, "node_modules", name);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
	}
});
