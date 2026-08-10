/**
 * Pi core version checker.
 *
 * Discovers installed pi-ecosystem CORE packages (pi-coding-agent itself,
 * pi-agent-dashboard, pi-model-proxy, and similar globally-installed CLI
 * tooling) and compares their versions against the npm registry.
 *
 * Complements the existing PackageManagerWrapper, which only manages
 * packages listed in `settings.json packages[]` (extensions, skills,
 * prompts, themes).
 *
 * Discovery sources:
 *   1. Global npm (`npm list -g --depth=0 --json`)
 *   2. Managed install (`~/.pi-dashboard/node_modules/`) — Electron path
 *
 * Version fetch reuses `fetchPackageMeta()` from the npm-search proxy.
 * Results are cached for 5 minutes.
 */
import { execFile } from "node:child_process"; // ban:child_process-ok pi-core check uses execFile + promisify for `npm list -g --json` output capture; refactoring to platform/spawn's Recipe engine is tracked tech debt
import { promisify } from "node:util";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fetchPackageMeta } from "../package/npm-search-proxy.js";
import { invalidateChangelogCache } from "../changelog/changelog-parser.js";
import { getLatestPiRelease, type PiDevReleaseInfo } from "./pi-dev-version-check.js";

const execFileAsync = promisify(execFile);

const CACHE_TTL_MS = 5 * 60 * 1000;
const NPM_LIST_TIMEOUT_MS = 30_000;

/** ~/.pi-dashboard/ — Electron managed install dir */
const MANAGED_DIR = path.join(os.homedir(), ".pi-dashboard");
const MANAGED_NODE_MODULES = path.join(MANAGED_DIR, "node_modules");

/** Known core packages (not extensions). Order matters for display. */
export const CORE_PACKAGE_NAMES: readonly string[] = [
	"@earendil-works/pi-coding-agent",
	"@mariozechner/pi-coding-agent",
	"@blackbelt-technology/pi-agent-dashboard",
	"@blackbelt-technology/pi-model-proxy",
];

/** Display name mapping for known packages. Falls back to package name. */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
	"@earendil-works/pi-coding-agent": "pi (core agent)",
	"@mariozechner/pi-coding-agent": "pi (core agent — legacy fork)",
	"@blackbelt-technology/pi-agent-dashboard": "pi-dashboard",
	"@blackbelt-technology/pi-model-proxy": "pi-model-proxy",
};

export interface PiCorePackage {
	name: string;
	displayName: string;
	currentVersion: string;
	latestVersion: string | null;
	updateAvailable: boolean;
	installSource: "global" | "managed";
}

export interface PiCoreStatus {
	packages: PiCorePackage[];
	updatesAvailable: number;
	lastChecked: string;
}

/** Resolve display name for a package. */
function resolveDisplayName(name: string): string {
	return DISPLAY_NAMES[name] ?? name;
}

/**
 * Dynamically-discovered package-name aliases for `@mariozechner/pi-coding-agent`.
 * Populated from pi.dev's `latest-version` response, which returns the
 * authoritative package name for fresh installs (used for the upcoming
 * `@mariozechner` → `@earendil-works` scope migration). The dashboard
 * accepts whatever name pi.dev declares as a trusted alias — this avoids
 * having to ship a release every time the canonical scope changes.
 *
 * See change: improve-pi-update-detection.
 */
let dynamicPiAliases: Set<string> = new Set();

/** Test seam: clear runtime aliases between tests. */
export function _resetDynamicPiAliases(): void {
	dynamicPiAliases = new Set();
}

/**
 * Strict whitelist check: a package is part of the pi-ecosystem CORE
 * tooling if and only if its name is in `CORE_PACKAGE_NAMES` OR a
 * pi.dev-declared alias. The previous `pi-*` name-prefix heuristic was
 * removed because it caused recommended-extension packages (e.g.
 * `pi-agent-browser`, `pi-dashboard-subagents`) to appear in BOTH the
 * Core ecosystem panel and the Installed Packages panel. Recommended
 * extensions are now surfaced exclusively through
 * `/api/packages/installed`. See change: consolidate-packages-settings-ui.
 */
function looksLikePiEcosystem(name: string): boolean {
	return CORE_PACKAGE_NAMES.includes(name) || dynamicPiAliases.has(name);
}

/** Pi packages whose latestVersion comes from pi.dev (not npm registry). */
const PI_DEV_PACKAGE = "@mariozechner/pi-coding-agent";

export interface NpmListRunner {
	/** Run `npm list -g --depth=0 --json` and return stdout. */
	(): Promise<string>;
}

export interface PiCoreCheckerOptions {
	/** Inject npm-list runner (for tests). */
	npmList?: NpmListRunner;
	/** Inject version fetcher (for tests). */
	fetchLatest?: (packageName: string) => Promise<string | null>;
	/**
	 * Inject pi.dev release fetcher (for tests). Production uses
	 * `getLatestPiRelease` which honours PI_OFFLINE / PI_SKIP_VERSION_CHECK
	 * envs and falls back to `undefined` on any failure. See change:
	 * improve-pi-update-detection.
	 */
	fetchPiDevRelease?: (currentVersion: string) => Promise<PiDevReleaseInfo | undefined>;
	/** Override managed directory (for tests). */
	managedDir?: string;
}

/** Default npm runner uses execFile for safety. */
const defaultNpmList: NpmListRunner = async () => {
	const { stdout } = await execFileAsync("npm", ["list", "-g", "--depth=0", "--json"], {
		timeout: NPM_LIST_TIMEOUT_MS,
		maxBuffer: 10 * 1024 * 1024,
	});
	return stdout;
};

const defaultFetchLatest = async (packageName: string): Promise<string | null> => {
	const meta = await fetchPackageMeta(packageName);
	return meta?.version ?? null;
};

export class PiCoreChecker {
	private cache: { at: number; data: PiCoreStatus } | null = null;
	private readonly npmList: NpmListRunner;
	private readonly fetchLatest: (packageName: string) => Promise<string | null>;
	private readonly fetchPiDevRelease: (currentVersion: string) => Promise<PiDevReleaseInfo | undefined>;
	private readonly managedNodeModules: string;

	constructor(opts: PiCoreCheckerOptions = {}) {
		this.npmList = opts.npmList ?? defaultNpmList;
		this.fetchLatest = opts.fetchLatest ?? defaultFetchLatest;
		this.fetchPiDevRelease = opts.fetchPiDevRelease ?? getLatestPiRelease;
		this.managedNodeModules = opts.managedDir
			? path.join(opts.managedDir, "node_modules")
			: MANAGED_NODE_MODULES;
	}

	/**
	 * Invalidate the cache (e.g. after an update completes).
	 *
	 * Also clears the changelog parser cache so the next
	 * `GET /api/pi-core/changelog` request reads the freshly-installed
	 * file from disk. See change: pi-update-whats-new-panel.
	 */
	invalidate(): void {
		this.cache = null;
		invalidateChangelogCache();
	}

	/** Get version status. Returns cached data within 5 min unless `refresh`. */
	async getStatus(refresh = false): Promise<PiCoreStatus> {
		const now = Date.now();
		if (!refresh && this.cache && now - this.cache.at < CACHE_TTL_MS) {
			return this.cache.data;
		}

		// Discover packages from both sources. Managed takes precedence on conflict.
		const global = await this.discoverGlobal();
		const managed = this.discoverManaged();

		const byName = new Map<string, { version: string; source: "global" | "managed" }>();
		for (const entry of global) byName.set(entry.name, { version: entry.version, source: "global" });
		for (const entry of managed) byName.set(entry.name, { version: entry.version, source: "managed" });

		// Fetch latest versions in parallel. For pi-coding-agent (and its
		// declared scope-rename aliases), prefer pi.dev's authoritative
		// version-check endpoint over the npm registry; fall back to npm
		// registry on any failure so the dashboard never reports "unknown
		// version" just because pi.dev had a hiccup. See change:
		// improve-pi-update-detection.
		const entries = Array.from(byName.entries());
		const withLatest = await Promise.all(
			entries.map(async ([name, info]) => {
				let latest: string | null = null;
				const isPi = name === PI_DEV_PACKAGE || dynamicPiAliases.has(name);
				if (isPi) {
					try {
						const piDev = await this.fetchPiDevRelease(info.version);
						if (piDev) {
							latest = piDev.version;
							// Record any new alias for next-time discovery.
							if (piDev.packageName && !CORE_PACKAGE_NAMES.includes(piDev.packageName)) {
								dynamicPiAliases.add(piDev.packageName);
							}
						}
					} catch {
						/* fall through to npm registry */
					}
				}
				if (latest === null) {
					try {
						latest = await this.fetchLatest(name);
					} catch {
						latest = null;
					}
				}
				const updateAvailable = latest !== null && latest !== info.version;
				const pkg: PiCorePackage = {
					name,
					displayName: resolveDisplayName(name),
					currentVersion: info.version,
					latestVersion: latest,
					updateAvailable,
					installSource: info.source,
				};
				return pkg;
			}),
		);

		// Sort: known core packages first (in CORE_PACKAGE_NAMES order), then
		// alphabetically. Then updates-available bubble up.
		withLatest.sort((a, b) => {
			const ai = CORE_PACKAGE_NAMES.indexOf(a.name);
			const bi = CORE_PACKAGE_NAMES.indexOf(b.name);
			if (ai !== -1 || bi !== -1) {
				if (ai === -1) return 1;
				if (bi === -1) return -1;
				return ai - bi;
			}
			return a.name.localeCompare(b.name);
		});

		const status: PiCoreStatus = {
			packages: withLatest,
			updatesAvailable: withLatest.filter((p) => p.updateAvailable).length,
			lastChecked: new Date().toISOString(),
		};
		this.cache = { at: now, data: status };
		return status;
	}

	/** Discover pi-ecosystem packages installed via `npm -g`. */
	private async discoverGlobal(): Promise<Array<{ name: string; version: string }>> {
		let stdout = "";
		try {
			stdout = await this.npmList();
		} catch (err) {
			// `npm list` exits non-zero when it has warnings — stdout may still be valid JSON.
			// execFile throws with .stdout attached in that case.
			const maybe = (err as { stdout?: string })?.stdout;
			if (typeof maybe === "string" && maybe.length > 0) {
				stdout = maybe;
			} else {
				console.warn("[pi-core-checker] npm list -g failed:", (err as Error).message);
				return [];
			}
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(stdout);
		} catch (err) {
			console.warn("[pi-core-checker] npm list -g: failed to parse JSON:", (err as Error).message);
			return [];
		}

		const deps = (parsed as { dependencies?: Record<string, { version?: string; resolved?: string }> })?.dependencies;
		if (!deps || typeof deps !== "object") return [];

		const out: Array<{ name: string; version: string }> = [];
		for (const [name, info] of Object.entries(deps)) {
			if (!looksLikePiEcosystem(name)) continue;
			const version = typeof info?.version === "string" ? info.version : undefined;
			if (!version) continue;
			out.push({ name, version });
		}
		return out;
	}

	/** Discover pi-ecosystem packages in ~/.pi-dashboard/node_modules/. */
	private discoverManaged(): Array<{ name: string; version: string }> {
		if (!existsSync(this.managedNodeModules)) return [];
		const out: Array<{ name: string; version: string }> = [];
		let entries: string[];
		try {
			entries = readdirSync(this.managedNodeModules);
		} catch {
			return [];
		}

		for (const entry of entries) {
			if (entry.startsWith(".")) continue;
			const full = path.join(this.managedNodeModules, entry);
			if (entry.startsWith("@")) {
				// Scoped: iterate one level deeper.
				let sub: string[];
				try {
					sub = readdirSync(full);
				} catch {
					continue;
				}
				for (const pkg of sub) {
					const pkgName = `${entry}/${pkg}`;
					if (!looksLikePiEcosystem(pkgName)) continue;
					const v = this.readVersion(path.join(full, pkg));
					if (v) out.push({ name: pkgName, version: v });
				}
			} else {
				if (!looksLikePiEcosystem(entry)) continue;
				const v = this.readVersion(full);
				if (v) out.push({ name: entry, version: v });
			}
		}
		return out;
	}

	private readVersion(pkgDir: string): string | null {
		try {
			const pj = path.join(pkgDir, "package.json");
			if (!existsSync(pj)) return null;
			if (!statSync(pj).isFile()) return null;
			const parsed = JSON.parse(readFileSync(pj, "utf-8"));
			return typeof parsed?.version === "string" ? parsed.version : null;
		} catch {
			return null;
		}
	}
}

export const _internal = {
	looksLikePiEcosystem,
	resolveDisplayName,
	DISPLAY_NAMES,
	MANAGED_NODE_MODULES,
};
