/**
 * "What are extensions and plugins?" panel for the Add-ons page, plus the
 * one-line legend for the part labels. Disclosure semantics: a button with
 * `aria-expanded` controls the region. Dismissal persistence and the header
 * link live in the caller (`UnifiedPackagesSection`).
 *
 * Copy is plain language and carries no internal identifiers. The worked
 * example is static (design D8).
 *
 * See change: addons-hub-declutter.
 */
import { mdiChevronDown, mdiChevronRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type RefObject, useId } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { PART_KINDS, PartChip } from "./PartChip.js";

interface AddonsExplainerProps {
	expanded: boolean;
	onToggle: () => void;
	toggleRef: RefObject<HTMLButtonElement | null>;
}

function Concept({ title, where, body }: { title: string; where: string; body: string }) {
	return (
		<div className="rounded border border-[var(--border-secondary)] p-2.5">
			<h4 className="text-xs font-semibold text-[var(--text-primary)]">{title}</h4>
			<div className="text-[10px] text-[var(--text-muted)] mb-1">{where}</div>
			<p className="text-[11px] text-[var(--text-secondary)] leading-snug">{body}</p>
		</div>
	);
}

export function AddonsExplainer({ expanded, onToggle, toggleRef }: AddonsExplainerProps) {
	const regionId = useId();
	return (
		<div className="mb-3" data-testid="addons-explainer">
			<button
				type="button"
				ref={toggleRef}
				onClick={onToggle}
				aria-expanded={expanded}
				aria-controls={regionId}
				className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
				data-testid="addons-explainer-toggle"
			>
				<Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
				{i18nT("addons.explainerTitle", undefined, "What are extensions and plugins?")}
			</button>
			<div id={regionId} hidden={!expanded} className="mt-2 space-y-2" data-testid="addons-explainer-body">
				<p className="text-xs text-[var(--text-secondary)]">
					{i18nT(
						"addons.explainerLead",
						undefined,
						"You use two programs: pi, the AI agent doing the work in each session, and this dashboard, the web app you are looking at. Add-ons can extend either one, or both.",
					)}
				</p>
				<div className="grid grid-cols-1 md:grid-cols-3 gap-2">
					<Concept
						title={i18nT("addons.concept.extension.title", undefined, "Extension")}
						where={i18nT("addons.concept.extension.where", undefined, "Runs inside pi, in every session, also in the terminal")}
						body={i18nT(
							"addons.concept.extension.body",
							undefined,
							"Changes what the AI agent can do: new tools it can call and extra commands during a session.",
						)}
					/>
					<Concept
						title={i18nT("addons.concept.skill.title", undefined, "Skill")}
						where={i18nT("addons.concept.skill.where", undefined, "Read by pi when a task matches")}
						body={i18nT(
							"addons.concept.skill.body",
							undefined,
							"Written know-how for the AI: step-by-step instructions for a kind of task. No code runs.",
						)}
					/>
					<Concept
						title={i18nT("addons.concept.plugin.title", undefined, "Dashboard plugin")}
						where={i18nT("addons.concept.plugin.where", undefined, "Runs in this dashboard only")}
						body={i18nT(
							"addons.concept.plugin.body",
							undefined,
							"Changes what you see and control here: new screens, settings pages, session-card sections. It has no effect in terminal pi.",
						)}
					/>
				</div>
				<div className="rounded border border-[var(--border-secondary)] p-2.5 text-[11px] text-[var(--text-secondary)] space-y-1">
					<div>
						<span className="font-semibold text-[var(--text-primary)]">
							{i18nT("addons.concept.package.title", undefined, "Package")}
						</span>
						{": "}
						{i18nT(
							"addons.concept.package.body",
							undefined,
							"what you install, from npm, git or a folder. One package can contain any mix of the above.",
						)}
					</div>
					<div>
						<span className="font-semibold text-[var(--text-primary)]">
							{i18nT("addons.example.title", undefined, "Example: Goal")}
						</span>
						{": "}
						{i18nT(
							"addons.example.body",
							undefined,
							"an extension by @ricoyudog keeps the agent working toward a goal, and a dashboard plugin that ships with the dashboard shows its progress on the session card.",
						)}
					</div>
				</div>
			</div>
			<div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] text-[var(--text-muted)]" data-testid="addons-legend">
				<span>{i18nT("addons.legend", undefined, "Labels show what a row contains:")}</span>
				{PART_KINDS.map((kind) => (
					<PartChip key={kind} kind={kind} testId={`legend-chip-${kind}`} />
				))}
			</div>
		</div>
	);
}
