/**
 * Offline package bundle — discovery, manifest parsing, SHA-256 verified
 * extraction. Pure-ish helpers used by `dependency-installer.ts` at first
 * run to populate an npm cacache from the bundled tarball and run a
 * cache-offline `npm install`.
 *
 * The bundle is produced by `packages/electron/scripts/bundle-offline-packages.mjs`
 * and lands at `<resourcesPath>/offline-packages/{manifest.json,npm-cache.tar.gz}`.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

/** Shape of resources/offline-packages/manifest.json. */
export interface OfflinePackageManifest {
	/** ISO-8601 UTC timestamp. */
	bundledAt: string;
	/** e.g. "darwin-arm64", "win32-x64". */
	targetPlatform: string;
	/** Tarball filename, always "npm-cache.tar.gz" today. */
	tarball: string;
	/** Uncompressed byte count — informational only. */
	tarballBytes: number;
	/** Hex SHA-256 of the tarball. */
	sha256: string;
	/** Pinned versions of every package the cache is built for. */
	packages: { name: string; version: string }[];
}

/** Result of `resolveOfflinePackages`. */
export type OfflinePackageResolution =
	| {
			present: true;
			manifest: OfflinePackageManifest;
			tarballPath: string;
			manifestPath: string;
	  }
	| { present: false; reason: string };

/**
 * Discover the offline package bundle inside the Electron resources dir.
 * Pure: filesystem-only, no child processes.
 */
export function resolveOfflinePackages(resourcesPath: string): OfflinePackageResolution {
	const dir = path.join(resourcesPath, "offline-packages");
	const manifestPath = path.join(dir, "manifest.json");
	if (!existsSync(manifestPath)) {
		return { present: false, reason: `manifest not found at ${manifestPath}` };
	}
	let raw: string;
	try {
		raw = readFileSync(manifestPath, "utf-8");
	} catch (err: any) {
		return { present: false, reason: `cannot read manifest: ${err?.message ?? err}` };
	}
	let manifest: OfflinePackageManifest;
	try {
		manifest = parseOfflineManifest(raw);
	} catch (err: any) {
		return { present: false, reason: `invalid manifest: ${err?.message ?? err}` };
	}
	const tarballPath = path.join(dir, manifest.tarball);
	if (!existsSync(tarballPath)) {
		return { present: false, reason: `tarball not found at ${tarballPath}` };
	}
	return { present: true, manifest, tarballPath, manifestPath };
}

/**
 * Validate + parse a manifest.json string. Throws on shape errors.
 * Exported for unit tests.
 */
export function parseOfflineManifest(raw: string): OfflinePackageManifest {
	const obj = JSON.parse(raw);
	if (!obj || typeof obj !== "object") throw new Error("not an object");
	const requiredStrings = ["bundledAt", "targetPlatform", "tarball", "sha256"] as const;
	for (const key of requiredStrings) {
		if (typeof obj[key] !== "string" || !obj[key]) {
			throw new Error(`missing/invalid "${key}"`);
		}
	}
	if (typeof obj.tarballBytes !== "number" || obj.tarballBytes <= 0) {
		throw new Error('missing/invalid "tarballBytes"');
	}
	if (!Array.isArray(obj.packages) || obj.packages.length === 0) {
		throw new Error('"packages" must be a non-empty array');
	}
	for (const entry of obj.packages) {
		if (!entry || typeof entry.name !== "string" || typeof entry.version !== "string") {
			throw new Error("package entry missing name/version");
		}
	}
	if (!/^[0-9a-f]{64}$/i.test(obj.sha256)) {
		throw new Error("sha256 must be 64 hex chars");
	}
	return obj as OfflinePackageManifest;
}

/** Compute SHA-256 of a file. Async, streaming. */
export function fileSha256(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const h = createHash("sha256");
		const s = createReadStream(filePath);
		s.on("error", reject);
		s.on("data", (d) => h.update(d));
		s.on("end", () => resolve(h.digest("hex")));
	});
}

/**
 * Extract the offline cache tarball into `<managedDir>/.offline-cache/`.
 * Verifies SHA-256 against `manifest.sha256` BEFORE running tar. Aborts
 * with a clear error on mismatch and does NOT touch the destination.
 *
 * Returns the path to the extracted `_cacache` directory.
 */
export async function extractOfflineCache(params: {
	tarballPath: string;
	expectedSha256: string;
	managedDir: string;
}): Promise<string> {
	const { tarballPath, expectedSha256, managedDir } = params;
	if (!existsSync(tarballPath)) {
		throw new Error(`offline tarball missing: ${tarballPath}`);
	}
	const actual = await fileSha256(tarballPath);
	if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
		throw new Error(
			`offline tarball SHA-256 mismatch (expected ${expectedSha256}, got ${actual}) — aborting`,
		);
	}
	const destRoot = path.join(managedDir, ".offline-cache");
	// Start clean so a previous partial extract can't corrupt us.
	rmSync(destRoot, { recursive: true, force: true });
	mkdirSync(destRoot, { recursive: true });
	await runTarExtract(tarballPath, destRoot);
	const cacacheDir = path.join(destRoot, "_cacache");
	if (!existsSync(cacacheDir)) {
		throw new Error(`extracted tarball is missing _cacache/ under ${destRoot}`);
	}
	return cacacheDir;
}

/**
 * Pick the install strategy given the current state. Pure — no I/O.
 * Returns one of:
 *   - `{ kind: "offline" }` — bundle present and covers all outstanding pins
 *   - `{ kind: "registry" }` — no bundle OR bundle covers nothing
 *   - `{ kind: "offline-incomplete", missing }` — bundle exists but is missing
 *     pins for some outstanding packages — caller should fall back to registry
 *     and surface the missing list as a warning.
 */
export function selectInstallStrategy(params: {
	outstandingPackages: string[];
	resolution: OfflinePackageResolution;
}):
	| { kind: "offline"; pinMap: Map<string, string> }
	| { kind: "registry" }
	| { kind: "offline-incomplete"; missing: string[]; pinMap: Map<string, string> } {
	const { outstandingPackages, resolution } = params;
	if (outstandingPackages.length === 0) return { kind: "registry" };
	if (!resolution.present) return { kind: "registry" };
	const pinMap = new Map(resolution.manifest.packages.map((p) => [p.name, p.version]));
	const missing = outstandingPackages.filter((p) => !pinMap.has(p));
	if (missing.length === 0) return { kind: "offline", pinMap };
	return { kind: "offline-incomplete", missing, pinMap };
}

/** Build the npm install argv for the cache-offline path. Pure — exported for tests. */
export function buildOfflineInstallArgs(params: {
	managedDir: string;
	cacheDir: string;
	packages: { name: string; version: string }[];
}): string[] {
	const { managedDir, cacheDir, packages } = params;
	return [
		"install",
		"--prefix",
		managedDir,
		"--cache",
		cacheDir,
		"--offline",
		"--no-audit",
		"--no-fund",
		...packages.map((p) => `${p.name}@${p.version}`),
	];
}

/** Spawn `tar -xzf <tarball> -C <dest>` and resolve on exit 0. */
function runTarExtract(tarballPath: string, destDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("tar", ["-xzf", tarballPath, "-C", destDir], {
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});
		let stderr = "";
		child.stderr?.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", (err) => reject(new Error(`tar spawn failed: ${err.message}`)));
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`tar exited ${code}: ${stderr.trim()}`));
		});
	});
}
