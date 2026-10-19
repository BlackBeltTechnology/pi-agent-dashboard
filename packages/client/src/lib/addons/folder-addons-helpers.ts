/**
 * Pure helpers of the folder Add-ons page: the effective-set strip, grouping and
 * filtering of the folder catalog.
 *
 * Strip (spec: addons-folder-view › The folder Add-ons page SHALL show what
 * sessions here load): features that are off globally never count, whatever
 * their folder state.
 *
 * See change: addons-hub-folder-view.
 */
import type { AddonFeature, AddonFolderInfo, AddonLooseCounts } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export interface FolderStrip {
	fromGlobal: number;
	addedHere: number;
	/** Loose `.pi/` files (skills + agents + prompts + extensions + themes). */
	files: number;
	turnedOffHere: number;
	/** Add-ons that load here: (from Global − turned off here + added). */
	total: number;
}

export const looseTotal = (c: AddonLooseCounts): number => c.skills + c.agents + c.prompts + c.extensions + c.themes;

export function computeStrip(features: readonly AddonFeature[], folder: Pick<AddonFolderInfo, "looseCounts">): FolderStrip {
	const counted = features.filter((f) => f.kind !== "core" && f.folderState !== "off-globally");
	const fromGlobal = counted.filter(
		(f) => f.folderState === "inherited" || f.folderState === "partly-off-here" || f.folderState === "off-here",
	).length;
	const addedHere = counted.filter((f) => f.folderState === "added-here").length;
	const turnedOffHere = counted.filter((f) => f.folderState === "off-here").length;
	const files = looseTotal(folder.looseCounts);
	return { fromGlobal, addedHere, files, turnedOffHere, total: fromGlobal - turnedOffHere + addedHere };
}

export interface FolderFilter {
	text: string;
	addedHere: boolean;
	turnedOffHere: boolean;
}

export const EMPTY_FOLDER_FILTER: FolderFilter = { text: "", addedHere: false, turnedOffHere: false };

export interface FolderGroups {
	added: AddonFeature[];
	fromGlobal: AddonFeature[];
	dashboardOnly: AddonFeature[];
}

/** Features a filter lets through (text on name/description; chips narrow by state). */
export function filterFolderFeatures(features: readonly AddonFeature[], f: FolderFilter): AddonFeature[] {
	const needle = f.text.trim().toLowerCase();
	return features.filter((x) => {
		if (f.addedHere && x.folderState !== "added-here") return false;
		if (f.turnedOffHere && x.folderState !== "off-here" && x.folderState !== "partly-off-here") return false;
		if (needle === "") return true;
		return x.displayName.toLowerCase().includes(needle) || x.description.toLowerCase().includes(needle) || x.id.toLowerCase().includes(needle);
	});
}

/** Rows the page renders: core features and `dashboardManaged` plumbing never appear as rows. */
export function splitFolderGroups(features: readonly AddonFeature[]): FolderGroups {
	const rows = features.filter((f) => f.kind !== "core");
	return {
		added: rows.filter((f) => f.folderState === "added-here"),
		fromGlobal: rows.filter((f) => f.folderState !== "added-here" && f.folderState !== "dashboard-only"),
		dashboardOnly: rows.filter((f) => f.folderState === "dashboard-only"),
	};
}
