/**
 * Enrich rows returned by `packageManagerWrapper.listInstalled()` with
 * version, description, displayName, isRecommended, and isBundled fields.
 *
 * The raw rows from pi's `DefaultPackageManager.listConfiguredPackages()`
 * carry only `{ source, scope, filtered, installedPath }`. The Settings
 * Packages tab needs more to render a friendly identity and badges
 * without a second fetch.
 *
 * Pure helpers (`extractBasenameFromSource`, `computeIsBundled`) are
 * exported for unit tests; the I/O-bearing enricher (`enrichInstalled`)
 * reads the on-disk `package.json` for each row.
 *
 * See change: consolidate-packages-settings-ui.
 */
import fs from "node:fs";
import path from "node:path";
import {
	BUNDLED_EXTENSION_IDS,
	RECOMMENDED_EXTENSIONS,
	type RecommendedExtension,
} from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import type { InstalledPackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
import { computeIdentity, parseSourceKind } from "./package-source-helpers.js";

/** Raw row shape returned by pi's listConfiguredPackages(). */
export interface RawInstalledRow {
	source: string;
	scope: "user" | "project";
	filtered: boolean;
	installedPath?: string;
}

/** Read package.json#version and #description from a directory.
 * Swallows all errors and returns `{}` on any failure. Exported for tests. */
export function readPackageJsonMeta(installedPath: string | undefined): {
	version?: string;
	description?: string;
} {
	if (!installedPath) return {};
	try {
		const pj = path.join(installedPath, "package.json");
		if (!fs.existsSync(pj)) return {};
		const raw = fs.readFileSync(pj, "utf-8");
		const parsed = JSON.parse(raw);
		const version = typeof parsed?.version === "string" ? parsed.version : undefined;
		const description = typeof parsed?.description === "string" ? parsed.description : undefined;
		return { version, description };
	} catch {
		return {};
	}
}

/** Pull a friendly basename out of a raw source string when no
 * RECOMMENDED_EXTENSIONS match is available. Pure. */
export function extractBasenameFromSource(source: string): string {
	// npm:<name>[@<ver>]
	const npmMatch = source.match(/^npm:(@?[^@]+)(?:@.*)?$/);
	if (npmMatch) return npmMatch[1];

	// git: strip .git suffix and trailing slash, take last path segment
	const gitMatch = source.match(/[/:]([^/:]+?)(?:\.git)?\/?$/);
	if (gitMatch) return gitMatch[1];

	// local file:// or path: take last path segment
	const localMatch = source.match(/[/\\]([^/\\]+)\/?$/);
	if (localMatch) return localMatch[1];

	return source;
}

/** Find the recommended manifest entry whose source matches the row.
 * Pure. */
export function matchRecommendedEntry(
	source: string,
	manifest: readonly RecommendedExtension[] = RECOMMENDED_EXTENSIONS,
): RecommendedExtension | undefined {
	return manifest.find((entry) => sourcesMatch(entry.source, source));
}

/** Compute isBundled. Pure (takes injected resourcesPath + existsSync).
 * Outside Electron (no resourcesPath), always false. */
export function computeIsBundled(
	id: string,
	resourcesPath: string | undefined,
	existsFn: (p: string) => boolean = fs.existsSync,
	bundledIds: readonly string[] = BUNDLED_EXTENSION_IDS,
): boolean {
	if (!resourcesPath) return false;
	if (!bundledIds.includes(id)) return false;
	const dir = path.join(resourcesPath, "bundled-extensions", id);
	return existsFn(dir);
}

/** Enrich a single raw row. Pure dependency injection for tests. */
export function enrichInstalledRow(
	row: RawInstalledRow,
	opts: {
		resourcesPath?: string;
		manifest?: readonly RecommendedExtension[];
		bundledIds?: readonly string[];
		readMeta?: (p: string | undefined) => { version?: string; description?: string };
		existsFn?: (p: string) => boolean;
	} = {},
): InstalledPackage {
	const readMeta = opts.readMeta ?? readPackageJsonMeta;
	const existsFn = opts.existsFn ?? fs.existsSync;
	const manifest = opts.manifest ?? RECOMMENDED_EXTENSIONS;
	const bundledIds = opts.bundledIds ?? BUNDLED_EXTENSION_IDS;

	const meta = readMeta(row.installedPath);
	const recommended = matchRecommendedEntry(row.source, manifest);

	const displayName =
		recommended?.displayName ?? extractBasenameFromSource(row.source);
	const description = recommended?.fallbackDescription ?? meta.description;
	const isRecommended = !!recommended;
	const isBundled = recommended
		? computeIsBundled(recommended.id, opts.resourcesPath, existsFn, bundledIds)
		: false;

	return {
		source: row.source,
		scope: row.scope,
		filtered: row.filtered,
		installedPath: row.installedPath,
		version: meta.version,
		description,
		displayName,
		isRecommended,
		isBundled,
	};
}

/** Read `package.json#name` from a directory. Swallows all errors and
 * returns undefined on any failure. Exported for tests / variant lookup. */
export function readPackageJsonName(installedPath: string | undefined): string | undefined {
	if (!installedPath) return undefined;
	try {
		const pj = path.join(installedPath, "package.json");
		if (!fs.existsSync(pj)) return undefined;
		const parsed = JSON.parse(fs.readFileSync(pj, "utf-8"));
		return typeof parsed?.name === "string" ? parsed.name : undefined;
	} catch {
		return undefined;
	}
}

export interface PublishedVariant {
	/** Canonical published spec: `npm:<name>` or a git URL. */
	source: string;
	/** Latest published version, when known (best-effort). */
	version?: string;
}

/**
 * Resolve the canonical published variant for a local/git installed row,
 * or undefined when there is nothing to reset to. Pure with injected IO.
 *
 * Resolution paths (design.md decision 3):
 *   - recommended row  → RECOMMENDED_EXTENSIONS manifest source (offline).
 *   - non-recommended  → npm-registry lookup by package.json `name`.
 *
 * Gating decision (task 2.3): non-recommended rows resolve by npm package
 * NAME ALONE (no repository-URL cross-check). Name-only can false-match an
 * unrelated published package; the reset confirm dialog mitigates this by
 * showing the exact npm target so the user verifies before acting.
 *
 * Plain npm rows and rows whose resolved variant is identity-equal to the
 * installed source return undefined (nothing distinct to reset to).
 * Never throws: on registry error / offline the version (or the whole
 * variant, for non-recommended rows) is simply omitted.
 */
export async function resolvePublishedVariant(
	row: InstalledPackage,
	opts: {
		manifest?: readonly RecommendedExtension[];
		readName?: (installedPath: string | undefined) => string | undefined;
		lookupNpm?: (name: string) => Promise<{ version?: string } | null>;
	} = {},
): Promise<PublishedVariant | undefined> {
	// Plain npm rows have no override to reset.
	if (parseSourceKind(row.source) === "npm") return undefined;

	const manifest = opts.manifest ?? RECOMMENDED_EXTENSIONS;
	const readName = opts.readName ?? readPackageJsonName;
	const lookupNpm = opts.lookupNpm;

	const recommended = matchRecommendedEntry(row.source, manifest);
	if (recommended) {
		const publishedSource = recommended.source;
		// No distinct target if the manifest source IS the installed source.
		if (computeIdentity(publishedSource) === computeIdentity(row.source)) return undefined;
		let version: string | undefined;
		const npmName = npmNameFromSource(publishedSource);
		if (npmName && lookupNpm) {
			try {
				version = (await lookupNpm(npmName))?.version;
			} catch {
				/* best-effort: offline → no version */
			}
		}
		return { source: publishedSource, version };
	}

	// Non-recommended local/git row: resolve by package.json name against npm.
	if (!lookupNpm) return undefined;
	const name = readName(row.installedPath);
	if (!name) return undefined;
	let meta: { version?: string } | null;
	try {
		meta = await lookupNpm(name);
	} catch {
		return undefined;
	}
	if (!meta) return undefined;
	const publishedSource = `npm:${name}`;
	if (computeIdentity(publishedSource) === computeIdentity(row.source)) return undefined;
	return { source: publishedSource, version: meta.version };
}

/** Extract the bare npm package name from an `npm:<name>[@<ver>]` source. */
function npmNameFromSource(source: string): string | undefined {
	if (!source.startsWith("npm:")) return undefined;
	const rest = source.slice(4);
	if (rest.startsWith("@")) {
		const at = rest.indexOf("@", 1);
		return at === -1 ? rest : rest.slice(0, at);
	}
	const at = rest.indexOf("@");
	return at === -1 ? rest : rest.slice(0, at);
}

/** Enrich a list of raw rows. Reads the Electron resourcesPath at
 * runtime (or undefined in CLI mode). */
export function enrichInstalledRows(
	rows: RawInstalledRow[],
	resourcesPath: string | undefined = (process as { resourcesPath?: string })
		.resourcesPath,
): InstalledPackage[] {
	return rows.map((row) => enrichInstalledRow(row, { resourcesPath }));
}

/**
 * Fill `publishedVariantSource` / `publishedVariantVersion` on each enriched
 * row that has a resolvable published variant. Runs `resolvePublishedVariant`
 * per row (recommended → offline; non-recommended → cached npm lookup). Never
 * throws — a row that fails to resolve is left unchanged. Mutates & returns
 * the same array. See change: reset-override-to-npm.
 */
export async function attachPublishedVariants(
	rows: InstalledPackage[],
	opts: {
		manifest?: readonly RecommendedExtension[];
		readName?: (installedPath: string | undefined) => string | undefined;
		lookupNpm?: (name: string) => Promise<{ version?: string } | null>;
	} = {},
): Promise<InstalledPackage[]> {
	await Promise.all(
		rows.map(async (row) => {
			const variant = await resolvePublishedVariant(row, opts);
			if (variant) {
				row.publishedVariantSource = variant.source;
				row.publishedVariantVersion = variant.version;
			}
		}),
	);
	return rows;
}
