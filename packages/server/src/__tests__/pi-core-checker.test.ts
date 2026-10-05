import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _internal, CORE_PACKAGE_NAMES, PiCoreChecker } from "../pi/pi-core-checker.js";

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

describe("pi-core whitelist excludes the upstream pi-model-proxy (E12)", () => {
	it("CORE_PACKAGE_NAMES has 2 entries; DISPLAY_NAMES has no pi-model-proxy key", () => {
		// See change: remove-pi-model-proxy-upstream-references, drop-mariozechner-pi-fork.
		expect(CORE_PACKAGE_NAMES).toHaveLength(2);
		expect(CORE_PACKAGE_NAMES).not.toContain("@blackbelt-technology/pi-model-proxy");
		expect(Object.keys(_internal.DISPLAY_NAMES)).not.toContain(
			"@blackbelt-technology/pi-model-proxy",
		);
	});
});

describe("PiCoreChecker.getStatus", () => {
	let tmpManagedDir: string;
	let originalOffline: string | undefined;

	beforeEach(() => {
		tmpManagedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-core-test-"));
		// Belt-and-braces: keep any default network fetcher offline.
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

	it("E13: installed-but-not-core upstream pi-model-proxy is omitted from status", async () => {
		// See change: remove-pi-model-proxy-upstream-references.
		const checker = new PiCoreChecker({
			npmList: async () =>
				JSON.stringify({
					dependencies: {
						"@earendil-works/pi-coding-agent": { version: "0.85.1" },
						"@blackbelt-technology/pi-agent-dashboard": { version: "0.5.0" },
						"@blackbelt-technology/pi-model-proxy": { version: "0.2.0" },
					},
				}),
			fetchLatest: async () => null,
			managedDir: path.join(tmpManagedDir, "nope"),
		});
		const status = await checker.getStatus();
		expect(status.packages).toHaveLength(2);
		expect(
			status.packages.some((p) => p.name === "@blackbelt-technology/pi-model-proxy"),
		).toBe(false);
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

describe("PiCoreChecker without the legacy fork (drop-mariozechner-pi-fork)", () => {
	const EARENDIL = "@earendil-works/pi-coding-agent";
	const FORK = "@mariozechner/pi-coding-agent";
	type Where = "absent" | "global" | "managed";
	let tmpManagedDir: string;
	let fetchSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tmpManagedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-core-nofork-"));
		fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in tests"));
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	function writeManagedPackage(name: string, version: string) {
		const dir = path.join(tmpManagedDir, "node_modules", name);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version }));
	}

	function makeChecker(
		earendil: Where,
		fork: Where,
		fetchLatest: (name: string) => Promise<string | null> = async () => null,
	) {
		const globalDeps: Record<string, { version: string }> = {};
		if (earendil === "global") globalDeps[EARENDIL] = { version: "1.0.0" };
		if (fork === "global") globalDeps[FORK] = { version: "0.73.1" };
		if (earendil === "managed") writeManagedPackage(EARENDIL, "1.0.0");
		if (fork === "managed") writeManagedPackage(FORK, "0.73.1");
		return new PiCoreChecker({
			npmList: async () => JSON.stringify({ dependencies: globalDeps }),
			fetchLatest,
			managedDir: tmpManagedDir,
		});
	}

	function piDevCalls(): number {
		return fetchSpy.mock.calls.filter((c: unknown[]) => String(c[0]).includes("pi.dev")).length;
	}

	// E3 — 9-combo decision table.
	const wheres: Where[] = ["absent", "global", "managed"];
	for (const earendil of wheres) {
		for (const fork of wheres) {
			it(`E3: earendil=${earendil} × fork=${fork} — fork never listed`, async () => {
				const status = await makeChecker(earendil, fork).getStatus(true);
				const names = status.packages.map((p) => p.name);
				expect(names).not.toContain(FORK);
				if (earendil === "absent") {
					expect(names).not.toContain(EARENDIL);
				} else {
					const row = status.packages.find((p) => p.name === EARENDIL);
					expect(row?.installSource).toBe(earendil);
				}
			});
		}
	}

	it("E4: earendil display name is 'pi (core agent)'; no 'legacy fork' string", async () => {
		const status = await makeChecker("global", "global").getStatus(true);
		const row = status.packages.find((p) => p.name === EARENDIL);
		expect(row?.displayName).toBe("pi (core agent)");
		expect(JSON.stringify(status)).not.toContain("legacy fork");
		expect(Object.values(_internal.DISPLAY_NAMES).join("|")).not.toContain("legacy fork");
	});

	it("E5: latest version comes from npm only; no pi.dev request", async () => {
		const status = await makeChecker("global", "global", async (name) =>
			name === EARENDIL ? "1.0.2" : null,
		).getStatus(true);
		const row = status.packages.find((p) => p.name === EARENDIL);
		expect(row?.latestVersion).toBe("1.0.2");
		expect(row?.updateAvailable).toBe(true);
		expect(piDevCalls()).toBe(0);
	});

	it("X1: npm failure leaves latestVersion null with no pi.dev fallback", async () => {
		const status = await makeChecker("global", "global", async () => {
			throw new Error("network down");
		}).getStatus(true);
		const row = status.packages.find((p) => p.name === EARENDIL);
		expect(row?.latestVersion).toBeNull();
		expect(row?.updateAvailable).toBe(false);
		expect(status.packages.map((p) => p.name)).not.toContain(FORK);
		expect(piDevCalls()).toBe(0);
	});
});
