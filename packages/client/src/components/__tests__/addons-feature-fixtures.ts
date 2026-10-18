/**
 * Catalog fixtures for the Add-ons feature-list tests.
 * See change: addons-hub-feature-catalog.
 */
import type { AddonFeature, AddonPackagePart } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export function part(source: string, extra: Partial<AddonPackagePart> = {}): AddonPackagePart {
	const kind = source.startsWith("npm:") ? "npm" : source.startsWith("git:") ? "git" : "local";
	return {
		source,
		scope: "user",
		identity: source,
		sourceKind: kind,
		entryOff: false,
		contents: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
		...extra,
	};
}

export function feature(id: string, extra: Partial<AddonFeature> = {}): AddonFeature {
	const packages = extra.packages ?? [];
	return {
		id,
		displayName: id.replace(/^(plugin|pkg|core):/, ""),
		description: "",
		kind: extra.plugin ? (packages.length ? "agent-and-dashboard" : "dashboard-only") : "agent-only",
		origin: "community",
		authorLabels: [],
		state: "on",
		packages,
		requires: [],
		requiredBy: [],
		...extra,
	};
}

export const plugin = (id: string, extra: Partial<NonNullable<AddonFeature["plugin"]>> = {}) => ({
	id,
	enabled: true,
	loaded: true,
	hasSettings: false,
	missingRequirements: [],
	dependsOn: [],
	...extra,
});

/** `plugin:goal`: first-party plugin + bridge + `@ricoyudog/pi-goal-hermes`. */
export function goalFeature(extra: Partial<AddonFeature> = {}): AddonFeature {
	return feature("plugin:goal", {
		displayName: "Goal",
		kind: "agent-and-dashboard",
		origin: "mixed",
		authorLabels: ["@ricoyudog"],
		plugin: plugin("goal"),
		bridge: { path: "/r/goal-plugin/src/bridge/index.ts" },
		packages: [part("npm:@ricoyudog/pi-goal-hermes", { packageName: "@ricoyudog/pi-goal-hermes", version: "1.0.0" })],
		...extra,
	});
}
