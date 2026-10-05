/**
 * Doctor check library — thin wrappers over the existing `shared/` resolution
 * primitives. The doctor NEVER reimplements resolution; it composes
 * `resolvePiPackage`, `resolvePiPackageEntry`, `listPiPackages`,
 * `sourcesMatch`, and `parseSourceKey`. Shell-first: every helper reads files
 * + `createRequire` and works with the dashboard server down.
 *
 * See change: add-modular-doctor-skill (design.md D4/D8, spec: Derive-on-run).
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import {
	enumeratePiInstalls,
	type PiInstall,
	piVersionDivergence,
	readPiFloor,
	resolvePiFloor,
} from "@blackbelt-technology/pi-dashboard-shared/pi-installs/index.js";
import {
	listPiPackages,
	type ResolvePiPackageOptions,
	resolvePiPackage,
	resolvePiPackageEntry,
} from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";
import {
	parseSourceKey,
	type SourceKey,
	sourcesMatch,
} from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";

export type { PiInstall, ResolvePiPackageOptions, SourceKey };
// Pi-install enumeration + floor reading live in `shared/pi-installs/` so the
// doctor and the server cannot drift (change: select-pi-runtime-install, D1).
// Re-export the primitives so modules import them from one place (DRY: the
// wrappers below are the ONLY doctor-specific additions).
export {
	enumeratePiInstalls,
	listPiPackages,
	parseSourceKey,
	piVersionDivergence,
	readPiFloor,
	resolvePiFloor,
	resolvePiPackage,
	resolvePiPackageEntry,
	sourcesMatch,
};

export type PeerTier = "tier-1" | "tier-2" | null;

export interface PeerProbeResult {
	spec: string;
	/** Which tier resolved the peer, or null when unresolved. */
	tier: PeerTier;
	/** Absolute resolved entry path, or null. */
	resolvedPath: string | null;
	present: boolean;
}

/**
 * Probe a peer via tier-1 then tier-2 resolution, mirroring how the bridge
 * actually resolves peers (`peer-probe.ts`):
 *  - tier-1: `createRequire(cwd + "/_").resolve(spec)` (anchored at session cwd)
 *  - tier-2: `resolvePiPackageEntry(spec)` (walks pi `packages[]`)
 * A peer is PRESENT if either tier resolves it.
 */
export function probePeer(
	spec: string,
	opts: ResolvePiPackageOptions = {},
): PeerProbeResult {
	// Tier 1 — cwd-anchored createRequire.
	if (opts.cwd) {
		try {
			const req = createRequire(`${opts.cwd}/_`);
			const resolved = req.resolve(spec);
			return { spec, tier: "tier-1", resolvedPath: resolved, present: true };
		} catch {
			// fall through to tier 2
		}
	}
	// Tier 2 — pi packages[].
	const entry = resolvePiPackageEntry(spec, opts);
	if (entry) {
		return { spec, tier: "tier-2", resolvedPath: entry, present: true };
	}
	return { spec, tier: null, resolvedPath: null, present: false };
}

export interface NameSkewResult {
	/** The name that actually resolved (the current package), or null. */
	resolvedName: string | null;
	/** Names probed but unresolved (stale / rescoped). */
	staleNames: string[];
	tier: PeerTier;
	resolvedPath: string | null;
}

/**
 * Probe a set of candidate names for one logical peer (e.g. the current
 * `@scope/pi-anthropic-messages` and its legacy `@pi/anthropic-messages`
 * alias). Reports which name currently resolves and which probed names are
 * dead — the signal for published-bridge name skew after a rescope.
 */
export function detectNameSkew(
	candidates: string[],
	opts: ResolvePiPackageOptions = {},
): NameSkewResult {
	const stale: string[] = [];
	for (const name of candidates) {
		const res = probePeer(name, opts);
		if (res.present) {
			// Names probed before the hit (still in `stale`) are the dead aliases.
			return {
				resolvedName: name,
				staleNames: stale,
				tier: res.tier,
				resolvedPath: res.resolvedPath,
			};
		}
		stale.push(name);
	}
	return { resolvedName: null, staleNames: stale, tier: null, resolvedPath: null };
}


// ── pi built-in MCP (change: migrate-mcp-to-pi-builtin) ─────────────────────

export interface McpBuiltinFinding {
	id: "adapter-disables-builtin" | "operator-entry-shadows-registration" | "mcp-json-not-strict";
	/** The file the finding is about. */
	path: string;
	message: string;
}

export interface McpBuiltinCheckOptions {
	/** Defaults to `$PI_CODING_AGENT_DIR` or `~/.pi/agent`. */
	agentDir?: string;
	/** When set, `<cwd>/.pi/settings.json` and `<cwd>/.pi/mcp.json` are checked too. */
	cwd?: string;
	/** Test seam; defaults to `fs.readFileSync` (null when absent). */
	readFile?: (path: string) => string | null;
}

const ADAPTER_SOURCE = "npm:pi-mcp-adapter";

function packageSourceOf(entry: unknown): string | null {
	if (typeof entry === "string") return entry;
	if (entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string") {
		return (entry as { source: string }).source;
	}
	return null;
}

function isAdapterSource(source: string): boolean {
	try {
		if (sourcesMatch(source, ADAPTER_SOURCE)) return true;
	} catch {
		/* unparseable source → fall through to the path test */
	}
	return /(^|[\\/])pi-mcp-adapter[\\/]?$/.test(source);
}

/**
 * Three read-only diagnostics for pi's built-in MCP, one finding each:
 *  - `pi-mcp-adapter` in a settings `packages[]` registers `/mcp` and so
 *    DISABLES the built-in MCP — and with it the dashboard's per-session
 *    `pi-dashboard` registration (the bridge cannot see this; pi reports it as
 *    an extension error, not a throw).
 *  - an operator-authored `pi-dashboard` entry in the global `mcp.json` takes
 *    precedence over the registration (the dashboard-provisioned shape is
 *    removed at server start and is NOT reported).
 *  - an `mcp.json` that is not strict JSON (comments, trailing commas) is
 *    skipped WHOLE by pi; the file path is named.
 * Never writes, never throws.
 */
export function checkMcpBuiltin(opts: McpBuiltinCheckOptions = {}): McpBuiltinFinding[] {
	const agentDir =
		opts.agentDir ?? (process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent"));
	const read =
		opts.readFile ??
		((p: string): string | null => {
			try {
				return readFileSync(p, "utf8");
			} catch {
				return null;
			}
		});
	const findings: McpBuiltinFinding[] = [];

	const settingsFiles = [path.join(agentDir, "settings.json")];
	if (opts.cwd) settingsFiles.push(path.join(opts.cwd, ".pi", "settings.json"));
	for (const file of settingsFiles) {
		const raw = read(file);
		if (raw === null) continue;
		let packages: unknown;
		try {
			packages = (JSON.parse(raw) as { packages?: unknown }).packages;
		} catch {
			continue;
		}
		if (!Array.isArray(packages)) continue;
		if (packages.some((e) => {
			const s = packageSourceOf(e);
			return s !== null && isAdapterSource(s);
		})) {
			findings.push({
				id: "adapter-disables-builtin",
				path: file,
				message:
					`pi-mcp-adapter is listed in ${file} packages[]: it takes over /mcp and DISABLES pi's built-in MCP, ` +
					"so the dashboard's pi-dashboard MCP tools are unavailable in sessions. Fix: remove it from packages[] " +
					"(convert adapter-only `disabled: true` entries to `enabled: false` in the MCP settings first).",
			});
			break;
		}
	}

	const mcpFiles = [path.join(agentDir, "mcp.json")];
	if (opts.cwd) mcpFiles.push(path.join(opts.cwd, ".pi", "mcp.json"));
	for (const [i, file] of mcpFiles.entries()) {
		const raw = read(file);
		if (raw === null) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (e) {
			findings.push({
				id: "mcp-json-not-strict",
				path: file,
				message: `${file} is not strict JSON (${(e as Error).message}); pi skips the whole file. Remove comments and trailing commas.`,
			});
			continue;
		}
		if (i !== 0) continue; // the shadow check concerns the global file only
		const entry = (parsed as { mcpServers?: Record<string, unknown> } | null)?.mcpServers?.["pi-dashboard"];
		if (entry === undefined || entry === null || typeof entry !== "object") continue;
		const rhc = (entry as { requestHeadersCommand?: { command?: unknown; args?: unknown } }).requestHeadersCommand;
		const provisioned =
			rhc?.command === "node" &&
			Array.isArray(rhc.args) &&
			typeof rhc.args[0] === "string" &&
			/(^|[\\/])header-command\.mjs$/.test(rhc.args[0]);
		if (!provisioned) {
			findings.push({
				id: "operator-entry-shadows-registration",
				path: file,
				message:
					`${file} defines its own "pi-dashboard" MCP server; pi prefers it over the dashboard's per-session ` +
					"registration. Remove or rename it unless you intend to override the dashboard endpoint.",
			});
		}
	}
	return findings;
}
