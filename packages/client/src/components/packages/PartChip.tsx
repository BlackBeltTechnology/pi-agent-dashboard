/**
 * Part label (dashboard UI / extension / skills / tools) with a plain-language
 * accessible description. The definitions match the Add-ons explainer so a row
 * label, its tooltip and the explainer never disagree.
 *
 * See change: addons-hub-declutter (spec: addons-hub › Part labels carry tooltips).
 */
import { useId } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export type PartKind = "dashboard-ui" | "extension" | "bridge" | "skills" | "prompts" | "themes";

/** Legend order. Tools are registered at runtime, so they have no static part label. */
export const PART_KINDS: readonly PartKind[] = ["dashboard-ui", "extension", "bridge", "skills", "prompts", "themes"];

const PART_STYLE: Record<PartKind, string> = {
	"dashboard-ui": "border-blue-500/40 bg-blue-500/10 text-blue-300",
	extension: "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
	skills: "border-indigo-500/40 bg-indigo-500/15 text-indigo-400",
	bridge: "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]",
	prompts: "border-amber-500/40 bg-amber-500/10 text-amber-400",
	themes: "border-pink-500/40 bg-pink-500/10 text-pink-400",
};

/** Localised chip text. */
export function partLabel(kind: PartKind): string {
	switch (kind) {
		case "dashboard-ui":
			return i18nT("addons.part.dashboardUi", undefined, "dashboard UI");
		case "extension":
			return i18nT("addons.part.extension", undefined, "extension");
		case "skills":
			return i18nT("addons.part.skills", undefined, "skills");
		case "bridge":
			return i18nT("addons.part.bridge", undefined, "bridge");
		case "prompts":
			return i18nT("addons.part.prompts", undefined, "prompts");
		case "themes":
			return i18nT("addons.part.themes", undefined, "themes");
	}
}

/** Localised plain-language definition, shared with the explainer. */
export function partDescription(kind: PartKind): string {
	switch (kind) {
		case "dashboard-ui":
			return i18nT(
				"addons.part.dashboardUiHelp",
				undefined,
				"Runs only in this dashboard and changes what you see and control. It has no effect in terminal pi.",
			);
		case "extension":
			return i18nT(
				"addons.part.extensionHelp",
				undefined,
				"Runs inside pi in every session, also in terminal pi, and changes what the AI agent can do.",
			);
		case "skills":
			return i18nT("addons.part.skillsHelp", undefined, "Written know-how the AI reads when a task matches. No code runs.");
		case "bridge":
			return i18nT(
				"addons.part.bridgeHelp",
				undefined,
				"The dashboard installs it into pi so its dashboard plugin can talk to the AI agent.",
			);
		case "prompts":
			return i18nT("addons.part.promptsHelp", undefined, "Ready-made prompts you can start from with a slash command.");
		case "themes":
			return i18nT("addons.part.themesHelp", undefined, "Colour themes for pi's terminal interface.");
	}
}

interface PartChipProps {
	kind: PartKind;
	/** Override the visible text (e.g. `skill: review`); the description stays the part's definition. */
	children?: React.ReactNode;
	testId?: string;
}

export function PartChip({ kind, children, testId }: PartChipProps) {
	const descId = useId();
	const description = partDescription(kind);
	return (
		<>
			<span
				tabIndex={0}
				title={description}
				aria-describedby={descId}
				data-testid={testId ?? `part-chip-${kind}`}
				className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${PART_STYLE[kind]}`}
			>
				{children ?? partLabel(kind)}
			</span>
			<span id={descId} className="sr-only">
				{description}
			</span>
		</>
	);
}
