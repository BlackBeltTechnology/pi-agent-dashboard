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

import type { PluginRequirements } from "./dashboard-plugin/manifest-types.js";
import type { PluginRequirementReport } from "./dashboard-plugin/plugin-status.js";

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
	 * (e.g. an extension paired with its companion dashboard plugin).
	 * The recommended-extensions enricher carries this through alongside a
	 * computed `dashboardPluginInstalled: boolean` so the install browser
	 * can render a "+plugin: <id>" badge.
	 * See change: add-plugin-activation-ui (Layer 1.5).
	 */
	dashboardPlugin?: string;

	/**
	 * Optional declarative external requirements (system binaries, named
	 * service probes, or sibling pi extensions) that the extension needs to
	 * function. Reuses the dashboard-plugin `PluginRequirements` schema and is
	 * probed server-side with the same machinery; the result is surfaced as
	 * `EnrichedRecommendedExtension.requirements`.
	 *
	 * NOTE: declare ONLY genuinely-probeable, user-actionable requirements.
	 * Do NOT list a native npm dependency the package bundles itself (e.g.
	 * better-sqlite3) — that is an install concern, not a user requirement.
	 * Do NOT list a `services` name absent from the closed service-probe
	 * registry (it would always report unsatisfied).
	 * See change: align-pi-080-and-publish-baseline-packages (Piece A).
	 */
	requires?: PluginRequirements;
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
	 * Skill ids this extension ships, DERIVED from the package's own
	 * `pi.skills` manifest (installed package.json preferred, else the
	 * registry / GitHub package.json). Skill id = basename of each pi.skills
	 * path. Absent when the package ships no skills. Not curated in the
	 * static manifest — single source of truth is the package itself.
	 */
	skillsRegistered?: string[];
	/**
	 * True iff the entry declares a `dashboardPlugin` and the named plugin is
	 * present in the dashboard's plugin status store.
	 * See change: add-plugin-activation-ui.
	 */
	dashboardPluginInstalled?: boolean;

	/**
	 * Structured probe result for the entry's declarative `requires`, computed
	 * server-side with the same probe used for dashboard plugins. Absent when
	 * the entry declares no `requires`.
	 * See change: align-pi-080-and-publish-baseline-packages (Piece A).
	 */
	requirements?: PluginRequirementReport;

	/**
	 * Flat list of unsatisfied requirement names across all categories. `[]`
	 * when everything is satisfied; absent when the entry declares no
	 * `requires`.
	 */
	missingRequirements?: string[];
}

export const RECOMMENDED_EXTENSIONS: readonly RecommendedExtension[] = [
	{
		id: "pi-anthropic-messages",
		// Published to the @blackbelt-technology npm scope. Source MUST be the
		// npm spec so sourcesMatch() recognizes the npm install as satisfying
		// this required entry (npm↔git cross-kind also added defensively).
		source: "npm:@blackbelt-technology/pi-anthropic-messages",
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
		// Published to the @blackbelt-technology npm scope. Source is the npm
		// spec so sourcesMatch() recognizes the npm install. NOTE: still excluded
		// from BUNDLED_EXTENSION_IDS until upstream declares an SPDX license — the
		// pre-bundle path is git-only and license-gated; the npm recommend path is not.
		source: "npm:@blackbelt-technology/pi-flows",
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
		// The browser tool shells out to the `agent-browser` CLI; probed on PATH
		// via the shared ToolRegistry. See change:
		// align-pi-080-and-publish-baseline-packages (Piece A).
		requires: { binaries: ["agent-browser"] },
	},
	{
		id: "@blackbelt-technology/pi-image-fit-extension",
		source: "npm:@blackbelt-technology/pi-image-fit-extension",
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
	{
		id: "context-mode",
		source: "npm:context-mode",
		displayName: "context-mode",
		fallbackDescription:
			"Context-window saver: sandboxed code execution over large outputs, " +
			"an FTS5 knowledge base, and intent-driven search. Processes big logs " +
			"and files in a sandbox so only summaries reach the model context.",
		status: "strongly-suggested",
		unlocks: [
			"ctx_execute / ctx_execute_file (run code over large data, return only summaries)",
			"ctx_search / ctx_index (persistent FTS5 knowledge base)",
			"ctx_batch_execute (multi-command gather + query in one round trip)",
		],
		toolsRegistered: [
			"ctx_execute",
			"ctx_execute_file",
			"ctx_batch_execute",
			"ctx_search",
			"ctx_index",
			"ctx_fetch_and_index",
		],
		autowired: true,
	},
	{
		id: "pi-hermes-memory",
		source: "npm:pi-hermes-memory",
		displayName: "pi-hermes-memory",
		fallbackDescription:
			"Default persistent cross-session memory backend: token-aware, " +
			"policy-only memory, SQLite FTS5 session search, secret scanning, " +
			"auto-consolidation, and procedural skills. Local-first; no external " +
			"service required.",
		status: "optional",
		unlocks: [
			"Persistent memory (memory, memory_search)",
			"Cross-session conversation search (session_search)",
			"Procedural skills (skill_manage)",
		],
		toolsRegistered: [
			"memory",
			"memory_search",
			"session_search",
			"skill_manage",
		],
		autowired: true,
	},
	{
		id: "@ricoyudog/pi-goal-hermes",
		source: "npm:@ricoyudog/pi-goal-hermes",
		displayName: "pi-goal-hermes",
		fallbackDescription:
			"Goal-driven autonomous continuation: set a goal and let the agent " +
			"work until done, with an LLM-based judge evaluating completion before " +
			"stopping.",
		status: "optional",
		unlocks: [
			"Goal-driven autonomous loop with LLM judge evaluation",
		],
		autowired: true,
	},
	{
		id: "@blackbelt-technology/pi-model-proxy",
		source: "npm:@blackbelt-technology/pi-model-proxy",
		displayName: "pi-model-proxy",
		fallbackDescription:
			"Exposes pi's authenticated models as a local OpenAI-compatible and " +
			"Anthropic-compatible API server, so other tools can route through " +
			"pi's provider auth without re-entering credentials.",
		status: "optional",
		unlocks: [
			"Local OpenAI-/Anthropic-compatible proxy over pi's authenticated models",
		],
		autowired: true,
	},
	{
		id: "pi-simplify",
		source: "npm:pi-simplify",
		displayName: "pi-simplify",
		fallbackDescription:
			"Reviews recently changed code for clarity, consistency, and " +
			"maintainability, surfacing simplification opportunities.",
		status: "optional",
		unlocks: [
			"Clarity / consistency / maintainability review of recent changes",
		],
	},
	// ── First-party monorepo extensions (published to the @blackbelt-technology
	// npm scope). See change: recommend-monorepo-extensions.
	{
		id: "@blackbelt-technology/pi-dashboard-kb-extension",
		source: "npm:@blackbelt-technology/pi-dashboard-kb-extension",
		displayName: "pi-dashboard-kb-extension",
		fallbackDescription:
			"Isolated pi extension over @blackbelt-technology/pi-dashboard-kb: " +
			"registers kb_search/kb_neighbors/kb_get tools and a tool_result hook " +
			"that reindexes markdown on edit and (opt-in) nudges DOX AGENTS.md row " +
			"upkeep. Directory-based SQLite/FTS5 knowledge base over markdown.",
		status: "strongly-suggested",
		unlocks: [
			"kb_search / kb_neighbors / kb_get (FTS5 knowledge base over repo markdown)",
			"Auto-reindex markdown on edit",
		],
		toolsRegistered: ["kb_search", "kb_neighbors", "kb_get"],
		autowired: true,
	},
	{
		id: "@blackbelt-technology/frontend-mockup-loop",
		source: "npm:@blackbelt-technology/frontend-mockup-loop",
		displayName: "frontend-mockup-loop",
		fallbackDescription:
			"Pi extension + skill for a ground\u2192contract\u2192mockup\u2192test\u2192fix\u2192learn " +
			"frontend design loop. Ships a live mockup server tool, a Playwright " +
			"breakpoint-screenshot scorer, and a design-contract scaffolder. Works " +
			"in any React/Tailwind/shadcn project.",
		status: "optional",
		unlocks: [
			"frontend-mockup-loop skill (7-step design loop)",
			"serve_mockup / score_mockup / init_ui_contract / validate_mockup tools",
		],
		toolsRegistered: [
			"serve_mockup",
			"score_mockup",
			"init_ui_contract",
			"list_design_systems",
			"validate_mockup",
		],
		autowired: true,
	},
	{
		id: "@blackbelt-technology/pi-dashboard-plugin-skill",
		source: "npm:@blackbelt-technology/pi-dashboard-plugin-skill",
		displayName: "pi-dashboard-plugin-skill",
		fallbackDescription:
			"Pi skill that scaffolds new dashboard plugins or augments existing " +
			"pi-extension projects with dashboard plugin contributions (manifest, " +
			"renderer, slots). Use when building a new dashboard plugin.",
		status: "optional",
		unlocks: [
			"dashboard-plugin-scaffold skill (scaffold / augment dashboard plugins)",
		],
	},
	{
		id: "@blackbelt-technology/pi-dashboard-document-converter",
		source: "npm:@blackbelt-technology/pi-dashboard-document-converter",
		displayName: "pi-dashboard-document-converter",
		fallbackDescription:
			"TypeScript facade + skill over a Dockerized Python document engine " +
			"(pi-doc-engine). Ingest PDF/DOCX/PPTX/XLSX \u2192 provenance-stamped " +
			"Markdown for kb (selectable OCR); produce templated DOCX/PDF from " +
			"Markdown with diagrams, TOC, cover page, and round-trip edit/merge. " +
			"Requires Docker.",
		status: "optional",
		unlocks: [
			"document-converter skill (bidirectional doc conversion)",
			"Ingest docs \u2192 Markdown for kb; produce DOCX/PDF from Markdown",
		],
		// Facade orchestrates a Dockerized engine; docker must be on PATH.
		requires: { binaries: ["docker"] },
	},
	{
		id: "@blackbelt-technology/anti-slop-frontend",
		source: "npm:@blackbelt-technology/anti-slop-frontend",
		displayName: "anti-slop-frontend",
		fallbackDescription:
			"Pi skill: a mechanical, countable anti-slop checklist for " +
			"AI-generated frontend. Catches the specific tells an undirected " +
			"model defaults to (AI-purple, Inter-everywhere, em-dashes, " +
			"div-based fake screenshots, Jane Doe / Acme data). Advisory; " +
			"pairs with frontend-mockup-loop. Works in any React/Tailwind/HTML " +
			"project.",
		status: "optional",
		unlocks: [
			"anti-slop-frontend skill (countable AI-tell checklist for frontend)",
		],
	},
	{
		id: "@blackbelt-technology/pi-dashboard-eng-disciplines",
		source: "npm:@blackbelt-technology/pi-dashboard-eng-disciplines",
		displayName: "pi-dashboard-eng-disciplines",
		fallbackDescription:
			"Pi skills bundle for engineering disciplines: doubt-driven review, " +
			"interview-me requirements elicitation, observability " +
			"instrumentation, performance optimization, and security hardening.",
		status: "optional",
		unlocks: [
			"doubt-driven-review / interview-me / observability-instrumentation / performance-optimization / security-hardening skills",
		],
	},
	{
		id: "@blackbelt-technology/pi-dashboard-authoring-toolkit",
		source: "npm:@blackbelt-technology/pi-dashboard-authoring-toolkit",
		displayName: "pi-dashboard-authoring-toolkit",
		fallbackDescription:
			"Pi skills for authoring pi artifacts: session-to-guideline distills " +
			"a session into a reusable guideline, and skill-creator scaffolds new " +
			"pi skills.",
		status: "optional",
		unlocks: [
			"session-to-guideline / skill-creator skills (author guidelines and new skills)",
		],
	},
];

/**
 * Ids of recommended extensions that ship inside the Electron installer
 * as a pre-bundled source tree. See
 * `installBundledExtensions()` in `dependency-installer.ts`. Every id
 * MUST also appear in `RECOMMENDED_EXTENSIONS` and MUST have a git-based
 * `source` (enforced by a test) — the pre-bundle path only handles git
 * sources; npm-sourced extensions install via the recommended-extensions UI.
 *
 * Kept deliberately short — only first-party, source-only, native-dep-free
 * extensions belong here.
 */
export const BUNDLED_EXTENSION_IDS: readonly string[] = [
	// pi-anthropic-messages was previously bundled via its git source. It was
	// republished to the @blackbelt-technology npm scope (npm: source so
	// sourcesMatch recognizes the npm install), so it is no longer pre-bundled
	// — it installs through the recommended-extensions UI like the other npm
	// entries. The pre-bundle path only handles git sources.
	// See change: suppress-hidden-session-auto-navigation (develop regression
	// follow-up); mirrors the earlier pi-dashboard-subagents v0.2.0 migration.
	//
	// @blackbelt-technology/pi-dashboard-subagents was likewise migrated to an
	// npm: source in v0.2.0 and removed from the pre-bundle set.
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
