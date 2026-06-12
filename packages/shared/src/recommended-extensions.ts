/**
 * Recommended pi extensions for pi-agent-dashboard.
 *
 * The dashboard has custom UI and wiring for a small set of pi extensions
 * it was built to work with. This manifest enumerates them so the dashboard
 * can surface installation status, offer one-click installs in the Packages
 * tab, walk users through setup in the first-launch wizard, and warn when
 * a `required` entry is missing.
 *
 * This list is intentionally curated (not auto-discovered from npm). Each
 * entry lives and dies by explicit PR review — the dashboard team owns the
 * decision of which extensions are promoted.
 *
 * Descriptions in `fallbackDescription` are shipped inline. At runtime the
 * dashboard server optionally enriches them with live descriptions fetched
 * from the npm registry or GitHub (see `/api/packages/recommended`).
 */

/** Relative importance of a recommended extension. */
export type RecommendedExtensionStatus =
	| "required"            // dashboard features or provider paths break without it
	| "strongly-suggested"  // dashboard has UI that depends on this
	| "optional";           // nice-to-have

/** Static manifest entry. Enriched at runtime via the recommended route. */
export interface RecommendedExtension {
	/** Stable kebab-case identifier. Used for skip/persist state and IPC. */
	id: string;

	/**
	 * pi install source. Any form parseable by pi's DefaultPackageManager:
	 *   - `npm:<name>`
	 *   - `git:<host>/<path>`
	 *   - `git@<host>:<path>.git`
	 *   - `https://<host>/<path>.git`
	 *   - local path
	 */
	source: string;

	/** Human-readable package name for the UI. */
	displayName: string;

	/**
	 * Fallback description. Used when npm/GitHub is unreachable. Kept
	 * short (one or two sentences).
	 */
	fallbackDescription: string;

	/** Relative importance. */
	status: RecommendedExtensionStatus;

	/** Which dashboard features light up when this is installed. */
	unlocks: string[];

	/** Tool names this extension registers (for diagnostics / UI hinting). */
	toolsRegistered?: string[];

	/**
	 * True when the extension self-wires into pi / dashboard without
	 * additional configuration — installing it is sufficient for it to
	 * start working.
	 */
	autowired?: boolean;

	/**
	 * Companion dashboard plugin id, if this extension is paired with one
	 * (e.g. `pi-memory-honcho` extension <-> `honcho` dashboard plugin).
	 * The recommended-extensions enricher carries this through alongside a
	 * computed `dashboardPluginInstalled: boolean` so the install browser
	 * can render a "+plugin: <id>" badge.
	 * See change: add-plugin-activation-ui (Layer 1.5).
	 */
	dashboardPlugin?: string;
}

/** Enriched manifest entry returned by GET /api/packages/recommended. */
export interface EnrichedRecommendedExtension extends RecommendedExtension {
	/** Live description (falls back to `fallbackDescription` on fetch failure). */
	description: string;
	/** Current upstream version, if available. */
	version?: string;
	/**
	 * Install status by scope. `null` means not present on disk in any scope.
	 */
	installed: { scope: "global" | "local" | null };
	/** True iff the source is currently listed in `~/.pi/agent/settings.json` `packages[]`. */
	activeInPi: boolean;
	/** True iff a newer version is available upstream. */
	updateAvailable: boolean;
	/**
	 * True iff the entry declares a `dashboardPlugin` and the named plugin is
	 * present in the dashboard's plugin status store.
	 * See change: add-plugin-activation-ui.
	 */
	dashboardPluginInstalled?: boolean;
}

export const RECOMMENDED_EXTENSIONS: readonly RecommendedExtension[] = [
	{
		id: "pi-anthropic-messages",
		source: "https://github.com/BlackBeltTechnology/pi-anthropic-messages.git",
		displayName: "pi-anthropic-messages",
		fallbackDescription:
			"Protocol bridge that makes pi's custom tools work with any " +
			"anthropic-messages endpoint for Claude models (direct Anthropic " +
			"OAuth/API key, 9Router cc/claude-*, pi-model-proxy, any Claude " +
			"Code-flavored proxy). Required whenever a provider has " +
			'api: "anthropic-messages" with a Claude model — without it, ' +
			"tool calls fall back to Claude Code's built-in bash_ide sandbox.",
		status: "required",
		unlocks: ["Tool calls on Anthropic OAuth / 9Router cc/* / proxy providers"],
		autowired: true,
	},
	{
		id: "@blackbelt-technology/pi-dashboard-subagents",
		source: "npm:@blackbelt-technology/pi-dashboard-subagents",
		displayName: "pi-dashboard-subagents",
		fallbackDescription:
			"Foreground in-memory subagents for pi with a streamed timeline " +
			"(every tool call, reasoning step, and assistant text). Pairs with " +
			"the dashboard's subagent-inspector plugin for inline-expand + popout " +
			"card UI. Producer of the Agent tool; no background spawning.",
		status: "optional",
		unlocks: [
			"Agent tool card UI",
			"Subagent inspector (inline expand + popout)",
			"agent-md path display",
		],
		toolsRegistered: ["Agent"],
		autowired: true,
		// Companion dashboard plugin id. See change: add-subagent-inspector.
		dashboardPlugin: "subagents",
	},
	{
		id: "pi-flows",
		source: "https://github.com/BlackBeltTechnology/pi-flows.git",
		displayName: "pi-flows",
		fallbackDescription:
			"Flow engine, dashboard, and orchestration extensions for pi. " +
			"Powers the dashboard's Flow view, role aliases, and multi-agent " +
			"orchestration tools.",
		status: "strongly-suggested",
		unlocks: [
			"Flow dashboard",
			"Role aliases (@planning, @coding, …)",
			"subagent / flow_write / flow_results / agent_write / ask_user / skill_read / finish tools",
		],
		toolsRegistered: [
			"subagent",
			"agent_catalog",
			"agent_write",
			"flow_write",
			"flow_results",
			"skill_read",
			"ask_user",
			"finish",
		],
		autowired: true,
	},
	{
		id: "pi-web-access",
		source: "npm:pi-web-access",
		displayName: "pi-web-access",
		fallbackDescription:
			"Web search, URL fetching, GitHub repo cloning, PDF extraction, " +
			"and YouTube / local video analysis for pi.",
		status: "strongly-suggested",
		unlocks: ["web_search", "code_search", "fetch_content", "get_search_content"],
		toolsRegistered: [
			"web_search",
			"code_search",
			"fetch_content",
			"get_search_content",
		],
	},
	{
		id: "pi-agent-browser",
		source: "npm:pi-agent-browser",
		displayName: "pi-agent-browser",
		fallbackDescription:
			"Browser automation (open, snapshot, click, fill, screenshot) " +
			"via the agent-browser CLI.",
		status: "optional",
		unlocks: ["browser tool (open, snapshot, click, screenshot)"],
		toolsRegistered: ["browser"],
	},
	{
		id: "pi-memory-honcho",
		source: "npm:pi-memory-honcho",
		displayName: "pi-memory-honcho",
		fallbackDescription:
			"Persistent cross-session memory backed by Honcho. Pairs with " +
			"the @blackbelt-technology/pi-dashboard-honcho-plugin dashboard " +
			"plugin which adds a settings panel, per-card actions, and " +
			"optional self-hosted Honcho server lifecycle.",
		status: "optional",
		unlocks: [
			"Honcho memory tools (honcho_search, honcho_context, honcho_profile)",
			"Honcho settings panel (when honcho-plugin is loaded)",
			"Per-card 🧠 status badge + interview/sync/map actions",
		],
		toolsRegistered: ["honcho_search", "honcho_context", "honcho_profile"],
		autowired: true,
		// Companion dashboard plugin id. See change: add-plugin-activation-ui.
		dashboardPlugin: "honcho",
	},
	{
		id: "@blackbelt-technology/pi-image-fit",
		source: "npm:@blackbelt-technology/pi-image-fit",
		displayName: "pi-image-fit",
		fallbackDescription:
			"Transparently downsizes oversize images before they reach the " +
			"model (defaults: 1568 px long edge / 4 MiB / quality 85), saving " +
			"tokens and avoiding provider image-size rejections. Intercepts the " +
			"Read tool and swaps in a cached, resized copy — note this silently " +
			"reduces image quality.",
		status: "optional",
		unlocks: [
			"Automatic image downscaling on Read (saves tokens, avoids provider image-size limits)",
		],
	},
];

/**
 * Ids of recommended extensions that ship inside the Electron installer
 * as a pre-bundled source tree. See
 * `packages/electron/scripts/bundle-recommended-extensions.mjs` and
 * `installBundledExtensions()` in `dependency-installer.ts`. Every id
 * MUST also appear in `RECOMMENDED_EXTENSIONS` and MUST have a git-based
 * `source` (enforced by a test).
 *
 * Kept deliberately short — only first-party, source-only, native-dep-free
 * extensions belong here.
 */
export const BUNDLED_EXTENSION_IDS: readonly string[] = [
	"pi-anthropic-messages",
	// @blackbelt-technology/pi-dashboard-subagents was previously bundled via
	// the git source. It now ships from npm under the @blackbelt-technology
	// scope and is installed through the recommended-extensions UI (npm: prefix),
	// not pre-bundled into the Electron installer. The bundling script
	// (bundle-recommended-extensions.mjs) only handles git sources — npm
	// sources don't need it. See pi-dashboard-subagents v0.2.0 release.
	//
	// "pi-flows" is intentionally NOT bundled until the upstream repo declares
	// an SPDX-conformant license (`LICENSE` file or `package.json#license`).
	// The bundle-recommended-extensions.mjs license allowlist enforcement
	// (MIT/Apache-2.0/BSD-2-Clause/BSD-3-Clause/ISC) correctly rejects it.
	// Re-add this entry once https://github.com/BlackBeltTechnology/pi-flows
	// has a license declared. See: openspec/changes/archive/
	// 2026-04-21-bundle-first-party-extensions/design.md §"License blockers".
];

/** Retrieve a recommended entry by id, or `undefined`. */
export function getRecommendedExtension(id: string): RecommendedExtension | undefined {
	return RECOMMENDED_EXTENSIONS.find((e) => e.id === id);
}

/** Retrieve all entries with the given status. */
export function getRecommendedByStatus(
	status: RecommendedExtensionStatus,
): readonly RecommendedExtension[] {
	return RECOMMENDED_EXTENSIONS.filter((e) => e.status === status);
}
