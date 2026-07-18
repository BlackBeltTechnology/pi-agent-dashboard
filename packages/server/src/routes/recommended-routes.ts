/**
 * REST route for the dashboard's curated "recommended extensions" list.
 *
 *   GET /api/packages/recommended
 *
 * Returns the static RECOMMENDED_EXTENSIONS manifest enriched with:
 *   - live description + version from npm or GitHub (falls back to
 *     fallbackDescription on network failure)
 *   - installed.scope cross-reference via packageManagerWrapper
 *   - activeInPi flag from ~/.pi/agent/settings.json packages[]
 *   - updateAvailable flag
 *
 * Results are cached for 60 seconds. The cache is busted when any package
 * install / remove / update operation completes successfully.
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { EnrichedRecommendedExtension } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
	RECOMMENDED_EXTENSIONS,
	type RecommendedExtension,
} from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import {
	parseSourceKey,
	sourcesMatch,
	type SourceKey,
} from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
export { parseSourceKey, sourcesMatch, type SourceKey };
import {
	fetchPackageMeta,
	fetchGithubPackageJson,
	deriveSkillIds,
	type PackageMeta,
} from "../package/npm-search-proxy.js";
import type { PackageManagerWrapper } from "../package/package-manager-wrapper.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import {
	runRequirementProbesFor,
	missingFromReport,
	type RequirementProbeDeps,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";

const CACHE_TTL_MS = 60 * 1000;

interface CacheEntry {
	at: number;
	data: EnrichedRecommendedExtension[];
}

let cache: CacheEntry | null = null;

/** Invalidate the recommended-extensions cache. */
export function invalidateRecommendedCache(): void {
	cache = null;
}

/**
 * Parse a pi install source into a lookup key for matching against
 * listInstalled() results.
 *
 * Supported forms (matches pi's DefaultPackageManager.parseSource):
 *   npm:<name>[@<version>]
 *   git@<host>:<owner>/<repo>.git
 *   git:<host>/<owner>/<repo>[#<ref>]
 *   https://<host>/<owner>/<repo>[.git][#<ref>]
 *
 * Returns:
 *   { kind: "npm", name }                 for npm sources
 *   { kind: "git", host, owner, repo }    for git sources
 *   { kind: "raw", source }               for anything else (local paths)
 *
 * Source-matching logic lives in
 * `@blackbelt-technology/pi-dashboard-shared/source-matching.js` so the
 * Electron wizard's bootstrap enricher can apply the same rules without
 * depending on the server runtime. We re-export above so existing
 * imports from this module keep working.
 */

/** Read pi's project-local `.pi/settings.json` (if any) for the given cwd. */
function readLocalSources(cwd: string): string[] {
	const settingsPath = path.join(cwd, ".pi", "settings.json");
	try {
		if (!fs.existsSync(settingsPath)) return [];
		const raw = fs.readFileSync(settingsPath, "utf-8").trim();
		if (!raw) return [];
		const data = JSON.parse(raw);
		const pkgs = Array.isArray(data?.packages) ? (data.packages as unknown[]) : [];
		return pkgs.filter((p): p is string => typeof p === "string");
	} catch {
		return [];
	}
}

/** Collect active package sources from both the user's global
 * `~/.pi/agent/settings.json` and the project's `<cwd>/.pi/settings.json`.
 * Mirrors pi's SettingsManager behavior: a package is "active" in pi if
 * it appears in EITHER scope's packages[] list. */
function readActiveSources(cwd?: string): string[] {
	const sources: string[] = [];

	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	try {
		if (fs.existsSync(globalPath)) {
			const raw = fs.readFileSync(globalPath, "utf-8").trim();
			if (raw) {
				const data = JSON.parse(raw);
				const pkgs = Array.isArray(data?.packages) ? (data.packages as unknown[]) : [];
				for (const p of pkgs) if (typeof p === "string") sources.push(p);
			}
		}
	} catch {
		/* ignore corrupt global settings */
	}

	if (cwd) {
		for (const p of readLocalSources(cwd)) sources.push(p);
	}

	return sources;
}

function semverOlder(installed: string | undefined, latest: string | undefined): boolean {
	if (!installed || !latest) return false;
	if (installed === latest) return false;
	// Very conservative comparison: if they differ textually, assume an
	// update may be available. The Packages tab's check-updates flow can
	// resolve the definitive answer.
	return installed !== latest;
}

async function enrichEntry(
	entry: RecommendedExtension,
	installedGlobal: Array<{ source: string; installedPath?: string }>,
	installedLocal: Array<{ source: string; installedPath?: string }>,
	activeSources: string[],
	reqDeps: RequirementProbeDeps,
): Promise<EnrichedRecommendedExtension> {
	const key = parseSourceKey(entry.source);
	let meta: PackageMeta | null = null;

	if (key.kind === "npm") {
		meta = await fetchPackageMeta(key.name);
	} else if (key.kind === "git" && key.host.toLowerCase() === "github.com") {
		meta = await fetchGithubPackageJson(key.owner, key.repo);
	}

	const description = meta?.description ?? entry.fallbackDescription;
	const version = meta?.version;
	// Skills DERIVED from the package's own pi.skills manifest. Default to the
	// registry / GitHub blob; an installed copy (read below) overrides it.
	let skillsRegistered: string[] | undefined = meta?.skills;

	const inGlobal = installedGlobal.some((p) => sourcesMatch(p.source, entry.source));
	const inLocal = installedLocal.some((p) => sourcesMatch(p.source, entry.source));
	const installedScope: "global" | "local" | null = inGlobal
		? "global"
		: inLocal
			? "local"
			: null;

	const activeInPi = activeSources.some((s) => sourcesMatch(s, entry.source));

	// Best-effort update indicator: for npm sources, try to read the installed
	// package.json version and compare to the live registry version. For git
	// sources we currently don't track ref pins, so updateAvailable defaults
	// to false (the Packages-tab check-updates action handles this separately).
	let updateAvailable = false;
	// Read the installed package.json once for both updateAvailable AND the
	// authoritative pi.skills (single source of truth when the package is on
	// disk; the registry blob is the pre-install fallback).
	if (installedScope) {
		const installed = inGlobal ? installedGlobal : installedLocal;
		const match = installed.find((p) => sourcesMatch(p.source, entry.source));
		if (match?.installedPath) {
			try {
				const pj = path.join(match.installedPath, "package.json");
				if (fs.existsSync(pj)) {
					const parsed = JSON.parse(fs.readFileSync(pj, "utf-8"));
					if (version && key.kind === "npm") {
						updateAvailable = semverOlder(parsed?.version, version);
					}
					const installedSkills = deriveSkillIds(parsed?.pi?.skills);
					if (installedSkills) skillsRegistered = installedSkills;
				}
			} catch {
				/* ignore */
			}
		}
	}

	// Cross-reference companion dashboard plugin (Layer 1.5 of
	// add-plugin-activation-ui). When the entry names a `dashboardPlugin`,
	// look it up in the plugin status store so the install browser can show
	// a "+plugin" badge that knows whether the plugin is currently present.
	let dashboardPluginInstalled: boolean | undefined;
	if (entry.dashboardPlugin) {
		try {
			const { getPluginStatusStore } = await import(
				"@blackbelt-technology/dashboard-plugin-runtime/server"
			);
			dashboardPluginInstalled = Boolean(
				getPluginStatusStore().getStatus(entry.dashboardPlugin),
			);
		} catch {
			dashboardPluginInstalled = false;
		}
	}

	// Probe declarative external requirements (Piece A). Only entries that
	// declare `requires` carry a `requirements` report + `missingRequirements`.
	let requirements: EnrichedRecommendedExtension["requirements"];
	let missingRequirements: string[] | undefined;
	if (entry.requires) {
		try {
			const report = await runRequirementProbesFor(entry.requires, reqDeps);
			requirements = report;
			missingRequirements = missingFromReport(report);
		} catch {
			/* probe failure is non-fatal — leave requirements undefined */
		}
	}

	return {
		...entry,
		description,
		version,
		installed: { scope: installedScope },
		activeInPi,
		updateAvailable,
		...(skillsRegistered ? { skillsRegistered } : {}),
		...(entry.dashboardPlugin
			? { dashboardPluginInstalled: dashboardPluginInstalled ?? false }
			: {}),
		...(requirements ? { requirements, missingRequirements: missingRequirements ?? [] } : {}),
	};
}

export function registerRecommendedRoutes(
	fastify: FastifyInstance,
	deps: { packageManagerWrapper: PackageManagerWrapper },
): void {
	fastify.get("/api/packages/recommended", async () => {
		const now = Date.now();
		if (cache && now - cache.at < CACHE_TTL_MS) {
			return { success: true, data: { recommended: cache.data } } satisfies ApiResponse<{
				recommended: EnrichedRecommendedExtension[];
			}>;
		}

		// Run global + local listInstalled in parallel to halve cold-start
		// latency. On Windows where each call instantiates pi's
		// DefaultPackageManager (1-3s cold), sequential awaits were making
		// the "Loading recommended extensions" spinner stick for ~15s.
		const [installedGlobalRes, installedLocalRes] = await Promise.allSettled([
			deps.packageManagerWrapper.listInstalled("global"),
			deps.packageManagerWrapper.listInstalled("local"),
		]);
		const installedGlobal = (installedGlobalRes.status === "fulfilled" ? installedGlobalRes.value : []) as Array<{ source: string; installedPath?: string }>;
		const installedLocal = (installedLocalRes.status === "fulfilled" ? installedLocalRes.value : []) as Array<{ source: string; installedPath?: string }>;

		// Include both global + project-local settings.json `packages[]`.
		// The server's CWD is a reasonable proxy for the active project.
		const activeSources = readActiveSources(process.cwd());

		// Probe deps reused across entries: pi-extension matches come from the
		// already-fetched installed lists; binaries resolve via the shared
		// ToolRegistry; services use the closed built-in registry.
		const reqDeps: RequirementProbeDeps = {
			listInstalled: async () => [...installedGlobal, ...installedLocal],
			toolRegistry: getDefaultRegistry(),
		};

		const enriched = await Promise.all(
			RECOMMENDED_EXTENSIONS.map((entry) =>
				enrichEntry(entry, installedGlobal, installedLocal, activeSources, reqDeps),
			),
		);

		cache = { at: now, data: enriched };

		return { success: true, data: { recommended: enriched } } satisfies ApiResponse<{
			recommended: EnrichedRecommendedExtension[];
		}>;
	});
}
