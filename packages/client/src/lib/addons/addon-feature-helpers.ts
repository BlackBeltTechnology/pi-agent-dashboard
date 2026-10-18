/**
 * Pure helpers for the Add-ons feature list: origin badge, part chips,
 * grouping, filtering and the local-source predicate. No React, no fetch.
 *
 * See change: addons-hub-feature-catalog (spec: addons-feature-catalog,
 * addons-hub › installed list filter / local banner).
 */
import type {
	AddonFeature,
	AddonOrigin,
	AddonPackagePart,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { t as i18nT } from "../i18n/i18n.js";

type AddonPartKind = "dashboard-ui" | "extension" | "bridge" | "skills" | "prompts" | "themes";

export interface AddonPartChipSpec {
	kind: AddonPartKind;
	count?: number;
}

/** Chips a feature row shows, in display order. Counts only when > 1. */
export function featurePartChips(f: AddonFeature): AddonPartChipSpec[] {
	const chips: AddonPartChipSpec[] = [];
	if (f.plugin) chips.push({ kind: "dashboard-ui" });
	if (f.bridge) chips.push({ kind: "bridge" });
	const sum = (k: "extensions" | "skills" | "prompts" | "themes") =>
		f.packages.reduce((n, p) => n + p.contents[k], 0);
	const order = [
		["extension", sum("extensions")],
		["skills", sum("skills")],
		["prompts", sum("prompts")],
		["themes", sum("themes")],
	] as const;
	for (const [kind, n] of order) if (n > 0) chips.push({ kind, ...(n > 1 ? { count: n } : {}) });
	return chips;
}

export function originBadgeLabel(f: Pick<AddonFeature, "origin" | "authorLabels">): string {
	switch (f.origin) {
		case "first-party":
			return i18nT("addons.origin.firstParty", undefined, "pi-dashboard");
		case "mixed": {
			const author = f.authorLabels.join(", ");
			return i18nT("addons.origin.mixed", { author }, `dashboard UI · ext by ${author}`);
		}
		case "community":
			return i18nT("addons.origin.community", undefined, "community");
		case "upstream":
			return i18nT("addons.origin.upstream", undefined, "pi core");
	}
}

/** Short origin label for the Delivered-by strip (no author). */
export function originStripLabel(o: AddonOrigin): string {
	switch (o) {
		case "first-party":
			return i18nT("addons.origin.firstParty", undefined, "pi-dashboard");
		case "mixed":
			return i18nT("addons.origin.mixedShort", undefined, "dashboard UI + community extension");
		case "community":
			return i18nT("addons.origin.community", undefined, "community");
		case "upstream":
			return i18nT("addons.origin.upstream", undefined, "pi core");
	}
}

/** One predicate for the `Local source` chip, the banner count and the row badge. */
export function isLocalSourceFeature(f: AddonFeature): boolean {
	return f.packages.some((p) => p.sourceKind !== "npm");
}

export type AddonGrouping = "kind" | "origin" | "source" | "az";

export interface AddonGroup {
	key: string;
	heading: string | null;
	features: AddonFeature[];
}

const KIND_GROUPS: Array<{ key: string; match: (f: AddonFeature) => boolean; heading: () => string }> = [
	{ key: "core", match: (f) => f.kind === "core", heading: () => i18nT("addons.group.core", undefined, "Core") },
	{
		key: "agent-and-dashboard",
		match: (f) => f.kind === "agent-and-dashboard",
		heading: () => i18nT("addons.group.agentAndDashboard", undefined, "Agent + dashboard features"),
	},
	{
		key: "dashboard-only",
		match: (f) => f.kind === "dashboard-only",
		heading: () => i18nT("addons.group.dashboardOnly", undefined, "Dashboard-only features"),
	},
	{
		key: "agent-only",
		match: (f) => f.kind === "agent-only",
		heading: () => i18nT("addons.group.agentOnly", undefined, "Agent-only features"),
	},
];

const ORIGIN_HEADINGS: Record<AddonOrigin, () => string> = {
	"first-party": () => i18nT("addons.group.originFirstParty", undefined, "Delivered by pi-dashboard"),
	mixed: () => i18nT("addons.group.originMixed", undefined, "pi-dashboard UI for community extensions"),
	community: () => i18nT("addons.group.originCommunity", undefined, "Community packages"),
	upstream: () => i18nT("addons.group.originUpstream", undefined, "pi core"),
};
const ORIGIN_ORDER: AddonOrigin[] = ["first-party", "mixed", "community", "upstream"];

/** Most local owned package source wins: local > git > npm; none → built in. */
function installSourceOf(f: AddonFeature): "local" | "git" | "npm" | "builtin" {
	if (f.packages.some((p) => p.sourceKind === "local")) return "local";
	if (f.packages.some((p) => p.sourceKind === "git")) return "git";
	if (f.packages.length > 0) return "npm";
	return "builtin";
}

const SOURCE_GROUPS: Array<{ key: ReturnType<typeof installSourceOf>; heading: () => string }> = [
	{ key: "npm", heading: () => i18nT("addons.group.srcNpm", undefined, "npm") },
	{ key: "git", heading: () => i18nT("addons.group.srcGit", undefined, "git") },
	{ key: "local", heading: () => i18nT("addons.group.srcLocal", undefined, "Local folder") },
	{ key: "builtin", heading: () => i18nT("addons.group.srcBuiltin", undefined, "Built into the dashboard") },
];

/** Every group is returned (possibly empty); the caller hides empty ones while filtering. */
export function groupFeatures(features: readonly AddonFeature[], mode: AddonGrouping): AddonGroup[] {
	switch (mode) {
		case "kind":
			return KIND_GROUPS.map((g) => ({ key: g.key, heading: g.heading(), features: features.filter(g.match) }));
		case "origin":
			return ORIGIN_ORDER.map((o) => ({
				key: o,
				heading: ORIGIN_HEADINGS[o](),
				features: features.filter((f) => f.origin === o),
			}));
		case "source":
			return SOURCE_GROUPS.map((g) => ({
				key: g.key,
				heading: g.heading(),
				features: features.filter((f) => installSourceOf(f) === g.key),
			}));
		case "az":
			return [{ key: "az", heading: null, features: [...features] }];
	}
}

/** Feature counts per origin for the Delivered-by strip. */
export function originCounts(features: readonly AddonFeature[]): Record<AddonOrigin, number> {
	const out: Record<AddonOrigin, number> = { "first-party": 0, mixed: 0, community: 0, upstream: 0 };
	for (const f of features) out[f.origin]++;
	return out;
}

export interface AddonFilter {
	text: string;
	localOnly: boolean;
	fromDashboard: boolean;
	community: boolean;
	hasDashboardUi: boolean;
	agentOnly: boolean;
	disabled: boolean;
}

export const EMPTY_ADDON_FILTER: AddonFilter = {
	text: "",
	localOnly: false,
	fromDashboard: false,
	community: false,
	hasDashboardUi: false,
	agentOnly: false,
	disabled: false,
};

export function isAddonFilterActive(f: AddonFilter): boolean {
	return f.text.trim() !== "" || (Object.keys(f) as Array<keyof AddonFilter>).some((k) => k !== "text" && f[k] === true);
}

function matchesText(f: AddonFeature, needle: string): boolean {
	const haystacks = [f.displayName, f.description, ...f.packages.map((p) => p.source)];
	return haystacks.some((s) => !!s && s.toLowerCase().includes(needle));
}

/** AND-combine the text filter (name, package sources, description) with the chips. */
export function filterFeatures(features: readonly AddonFeature[], filter: AddonFilter): AddonFeature[] {
	const needle = filter.text.trim().toLowerCase();
	return features.filter((f) => {
		if (filter.localOnly && !isLocalSourceFeature(f)) return false;
		if (filter.fromDashboard && f.origin !== "first-party" && f.origin !== "mixed") return false;
		if (filter.community && f.origin !== "community" && f.origin !== "mixed") return false;
		if (filter.hasDashboardUi && !f.plugin) return false;
		if (filter.agentOnly && f.kind !== "agent-only") return false;
		if (filter.disabled && f.state === "on") return false;
		return !needle || matchesText(f, needle);
	});
}

/** Package part → published-variant badge description (shared wording with PackageRow). */
export function partLocalDescription(p: AddonPackagePart): string | undefined {
	if (!p.publishedVariantSource) return undefined;
	return p.publishedVariantVersion
		? i18nT(
				"packages.localOverrideDescriptionVersion",
				{ target: p.publishedVariantSource, version: p.publishedVariantVersion },
				`Runs from local source. Published version: ${p.publishedVariantSource} ${p.publishedVariantVersion}.`,
			)
		: i18nT(
				"packages.localOverrideDescription",
				{ target: p.publishedVariantSource },
				`Runs from local source. Published version: ${p.publishedVariantSource}.`,
			);
}
