import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
	parseOfflineManifest,
	resolveOfflinePackages,
	fileSha256,
	extractOfflineCache,
	buildOfflineInstallArgs,
	selectInstallStrategy,
} from "../lib/offline-packages.js";

// ── Pure parse ────────────────────────────────────────────────────────

const validManifest = {
	bundledAt: "2026-04-21T00:00:00Z",
	targetPlatform: "darwin-arm64",
	tarball: "npm-cache.tar.gz",
	tarballBytes: 1234567,
	sha256: "a".repeat(64),
	packages: [
		{ name: "@mariozechner/pi-coding-agent", version: "0.68.0" },
		{ name: "@fission-ai/openspec", version: "1.3.0" },
		{ name: "tsx", version: "4.21.0" },
	],
};

describe("parseOfflineManifest", () => {
	it("accepts a valid manifest", () => {
		const m = parseOfflineManifest(JSON.stringify(validManifest));
		expect(m.targetPlatform).toBe("darwin-arm64");
		expect(m.packages).toHaveLength(3);
	});

	it("rejects missing tarball field", () => {
		const { tarball: _, ...bad } = validManifest;
		expect(() => parseOfflineManifest(JSON.stringify(bad))).toThrow(/tarball/);
	});

	it("rejects non-hex sha256", () => {
		const bad = { ...validManifest, sha256: "nothex" };
		expect(() => parseOfflineManifest(JSON.stringify(bad))).toThrow(/sha256/);
	});

	it("rejects empty packages array", () => {
		const bad = { ...validManifest, packages: [] };
		expect(() => parseOfflineManifest(JSON.stringify(bad))).toThrow(/packages/);
	});

	it("rejects package without version", () => {
		const bad = {
			...validManifest,
			packages: [{ name: "x" } as any],
		};
		expect(() => parseOfflineManifest(JSON.stringify(bad))).toThrow(/name\/version/);
	});

	it("rejects non-positive tarballBytes", () => {
		const bad = { ...validManifest, tarballBytes: 0 };
		expect(() => parseOfflineManifest(JSON.stringify(bad))).toThrow(/tarballBytes/);
	});

	it("rejects non-JSON input", () => {
		expect(() => parseOfflineManifest("not json")).toThrow();
	});
});

// ── Fixture helpers ────────────────────────────────────────────────

function sha256Hex(buf: Buffer): string {
	return createHash("sha256").update(buf).digest("hex");
}

function writeTarball(dir: string, bytes: Buffer): string {
	fs.mkdirSync(dir, { recursive: true });
	const p = path.join(dir, "npm-cache.tar.gz");
	fs.writeFileSync(p, bytes);
	return p;
}

// ── resolveOfflinePackages ────────────────────────────────────────

describe("resolveOfflinePackages", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "offline-pkgs-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("returns present:false when manifest missing", () => {
		const res = resolveOfflinePackages(tmp);
		expect(res.present).toBe(false);
	});

	it("returns present:false when manifest invalid JSON", () => {
		fs.mkdirSync(path.join(tmp, "offline-packages"));
		fs.writeFileSync(path.join(tmp, "offline-packages/manifest.json"), "{bogus");
		const res = resolveOfflinePackages(tmp);
		expect(res.present).toBe(false);
		if (res.present === false) expect(res.reason).toMatch(/invalid manifest/);
	});

	it("returns present:false when tarball missing", () => {
		const dir = path.join(tmp, "offline-packages");
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(validManifest));
		const res = resolveOfflinePackages(tmp);
		expect(res.present).toBe(false);
		if (res.present === false) expect(res.reason).toMatch(/tarball/);
	});

	it("returns present:true with both files in place", () => {
		const dir = path.join(tmp, "offline-packages");
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(validManifest));
		fs.writeFileSync(path.join(dir, "npm-cache.tar.gz"), Buffer.from("dummy"));
		const res = resolveOfflinePackages(tmp);
		expect(res.present).toBe(true);
		if (res.present) {
			expect(res.manifest.targetPlatform).toBe("darwin-arm64");
			expect(res.tarballPath).toBe(path.join(dir, "npm-cache.tar.gz"));
		}
	});
});

// ── SHA-256 ───────────────────────────────────────────────────────

describe("fileSha256", () => {
	it("matches known hash", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sha-"));
		const f = path.join(tmp, "f.bin");
		const payload = Buffer.from("hello world");
		fs.writeFileSync(f, payload);
		const got = await fileSha256(f);
		expect(got).toBe(sha256Hex(payload));
		fs.rmSync(tmp, { recursive: true });
	});
});

// ── extractOfflineCache ──────────────────────────────────────────

describe("extractOfflineCache", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = fs.mkdtempSync(path.join(os.tmpdir(), "extract-"));
	});
	afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

	it("aborts on SHA-256 mismatch without extracting", async () => {
		const payload = Buffer.from("not a real tarball");
		const tarPath = writeTarball(tmp, payload);
		await expect(
			extractOfflineCache({
				tarballPath: tarPath,
				expectedSha256: "0".repeat(64),
				managedDir: tmp,
			}),
		).rejects.toThrow(/SHA-256 mismatch/);
		// Confirm we did NOT create a partial cache dir
		expect(fs.existsSync(path.join(tmp, ".offline-cache", "_cacache"))).toBe(false);
	});

	it("aborts when tarball path missing", async () => {
		await expect(
			extractOfflineCache({
				tarballPath: path.join(tmp, "missing.tgz"),
				expectedSha256: "0".repeat(64),
				managedDir: tmp,
			}),
		).rejects.toThrow(/missing/);
	});
});

// ── selectInstallStrategy ─────────────────────────────

describe("selectInstallStrategy", () => {
	const resolutionAbsent = { present: false as const, reason: "" };
	const resolutionPresent = {
		present: true as const,
		manifest: validManifest,
		tarballPath: "/t.gz",
		manifestPath: "/m.json",
	};

	it("registry when no outstanding packages", () => {
		const s = selectInstallStrategy({
			outstandingPackages: [],
			resolution: resolutionPresent,
		});
		expect(s.kind).toBe("registry");
	});

	it("registry when bundle absent", () => {
		const s = selectInstallStrategy({
			outstandingPackages: ["tsx"],
			resolution: resolutionAbsent,
		});
		expect(s.kind).toBe("registry");
	});

	it("offline when bundle covers all outstanding pins", () => {
		const s = selectInstallStrategy({
			outstandingPackages: ["tsx", "@fission-ai/openspec"],
			resolution: resolutionPresent,
		});
		expect(s.kind).toBe("offline");
		if (s.kind === "offline") {
			expect(s.pinMap.get("tsx")).toBe("4.21.0");
		}
	});

	it("offline-incomplete when bundle missing some pins", () => {
		const s = selectInstallStrategy({
			outstandingPackages: ["tsx", "unbundled-pkg"],
			resolution: resolutionPresent,
		});
		expect(s.kind).toBe("offline-incomplete");
		if (s.kind === "offline-incomplete") {
			expect(s.missing).toEqual(["unbundled-pkg"]);
		}
	});
});

// ── buildOfflineInstallArgs ──────────────────────────────────────

describe("buildOfflineInstallArgs", () => {
	it("produces the expected argv", () => {
		const argv = buildOfflineInstallArgs({
			managedDir: "/u/.pi-dashboard",
			cacheDir: "/u/.pi-dashboard/.offline-cache",
			packages: [
				{ name: "a", version: "1.0.0" },
				{ name: "@scope/b", version: "2.0.0" },
			],
		});
		expect(argv).toEqual([
			"install",
			"--prefix",
			"/u/.pi-dashboard",
			"--cache",
			"/u/.pi-dashboard/.offline-cache",
			"--offline",
			"--no-audit",
			"--no-fund",
			"a@1.0.0",
			"@scope/b@2.0.0",
		]);
	});
});
