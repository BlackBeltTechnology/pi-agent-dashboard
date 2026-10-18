/**
 * Add-ons → Updates tab: every package part with an available update (grouped
 * under its feature) plus pi core, with one "Update all" that enqueues one
 * operation per updatable part plus pi core through the existing package queue.
 * Row rendering (Update, What's new, queued state) is supplied by the caller so
 * this stays on the same `PackageRow` machinery as the Installed tab.
 *
 * See change: addons-hub-feature-catalog (test-plan #E30).
 */
import type { AddonFeature, AddonPackagePart, PiCorePackage } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiArrowUpBold, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { ReactNode } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export interface UpdatablePart {
	feature: AddonFeature;
	part: AddonPackagePart;
}

/** Package parts with an update, in catalog order. */
export function updatableParts(features: readonly AddonFeature[], updates: ReadonlySet<string>): UpdatablePart[] {
	return features.flatMap((feature) => feature.packages.filter((p) => updates.has(p.source)).map((part) => ({ feature, part })));
}

interface AddonsUpdatesTabProps {
	features: readonly AddonFeature[];
	updates: ReadonlySet<string>;
	/** False until an update check has completed; avoids "up to date" before the first answer. */
	checked?: boolean;
	corePackages: readonly PiCorePackage[];
	statusFor: (source: string) => string;
	coreSource: (name: string) => string;
	onUpdatePart: (source: string) => void;
	onUpdateCore: (name: string) => void;
	renderPartRow: (item: UpdatablePart) => ReactNode;
	renderCoreRow: (pkg: PiCorePackage) => ReactNode;
}

export function AddonsUpdatesTab(props: AddonsUpdatesTabProps) {
	const parts = updatableParts(props.features, props.updates);
	const core = props.corePackages.filter((p) => p.updateAvailable);
	const total = parts.length + core.length;
	const running = [
		...parts.map((x) => x.part.source),
		...core.map((p) => props.coreSource(p.name)),
	].some((s) => ["running", "queued"].includes(props.statusFor(s)));

	if (total === 0 && props.checked === false) {
		return (
			<p className="text-xs text-[var(--text-muted)] italic" data-testid="addons-updates-pending">
				{i18nT("addons.updates.checking", undefined, "Checking for updates…")}
			</p>
		);
	}
	if (total === 0) {
		return (
			<p className="text-xs text-[var(--text-muted)] italic" data-testid="addons-updates-empty">
				{i18nT("addons.updates.none", undefined, "Everything is up to date.")}
			</p>
		);
	}
	return (
		<div data-testid="addons-updates-tab">
			<div className="mb-2">
				<button
					type="button"
					onClick={() => {
						for (const x of parts) props.onUpdatePart(x.part.source);
						for (const p of core) props.onUpdateCore(p.name);
					}}
					className="text-xs px-3 py-1 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 flex items-center gap-1"
					data-testid="addons-update-all"
				>
					<Icon path={running ? mdiLoading : mdiArrowUpBold} size={0.55} spin={running} />
					{i18nT("common.updateAll", { count: total }, `Update All (${total})`)}
				</button>
			</div>
			<div className="space-y-1">
				{core.map((p) => (
					<div key={`core-${p.name}`}>{props.renderCoreRow(p)}</div>
				))}
				{parts.map((x) => (
					<div key={`${x.feature.id}:${x.part.identity}`}>{props.renderPartRow(x)}</div>
				))}
			</div>
		</div>
	);
}
