/**
 * One "From Global" row on the folder Add-ons page: name, `global` scope badge,
 * origin badge, part chips, an `off in this folder` badge and an "on here" switch
 * (`role="checkbox"`, `aria-checked="mixed"` when partly off) that turns the
 * feature's AI-agent part off for this folder only.
 *
 * Notes the row owes the user: a plugin-backed feature keeps its dashboard UI
 * (plugins are global), package agents keep loading (pi cannot filter agents), a
 * globally-off feature cannot be re-enabled here, a `keptOn` reply names the
 * feature that needs the package, and a `notOwned` reply offers the confirmed
 * "Remove this folder entry".
 *
 * See change: addons-hub-folder-view (spec: addons-folder-view › folder page).
 */
import type { AddonFeature } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { FolderNotOwnedPrompt, KeptOnNote } from "../../hooks/useFolderAddons.js";
import { featurePartChips, originBadgeLabel } from "../../lib/addons/addon-feature-helpers.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { PartChip, partLabel } from "../packages/PartChip.js";

interface Props {
	feature: AddonFeature;
	busy: boolean;
	error?: string;
	keptOn?: KeptOnNote;
	notOwned?: FolderNotOwnedPrompt;
	/** Display name of a feature id (for the `keptOn` note). */
	featureName: (id: string) => string;
	onToggle: () => void;
	onConfirmRemove: () => void;
	onCancelRemove: () => void;
}

const BADGE = "text-[10px] px-1.5 py-0.5 rounded border";

const NOTE = "text-[11px] text-[var(--text-muted)] mt-0.5";

/** What the row owes the user once the feature is off here / off globally / kept on / failed. */
function RowNotes({ f, keptOn, error, featureName }: Pick<Props, "keptOn" | "error" | "featureName"> & { f: AddonFeature }) {
	const offAnywhere = f.folderState === "off-here" || f.folderState === "partly-off-here";
	const keptNames = keptOn?.by.map(featureName).join(", ");
	return (
		<>
			{offAnywhere && f.plugin && (
				<div className={NOTE} data-testid={`folder-addon-plugin-note-${f.id}`}>
					{i18nT("addons.folder.pluginStays", undefined, "The dashboard UI stays on here: dashboard plugins are global and apply to every folder.")}
				</div>
			)}
			{offAnywhere && (f.packageAgents ?? 0) > 0 && (
				<div className={NOTE} data-testid={`folder-addon-agents-note-${f.id}`}>
					{i18nT(
						"addons.folder.agentsStillLoad",
						{ count: f.packageAgents ?? 0 },
						`${f.packageAgents} agents from this add-on still load here (pi cannot turn agents off per folder).`,
					)}
				</div>
			)}
			{f.folderState === "off-globally" && (
				<div className={NOTE} data-testid={`folder-addon-global-off-${f.id}`}>
					{i18nT("addons.folder.offGlobally", undefined, "This add-on is turned off globally. Turn it on in Global add-ons first.")}
				</div>
			)}
			{keptNames && (
				<div className="text-[11px] text-[var(--severity-warning-fg)] mt-0.5" role="status" data-testid={`folder-addon-kepton-${f.id}`}>
					{i18nT("addons.folder.keptOn", { names: keptNames }, `Stays on here: ${keptNames} needs it.`)}
				</div>
			)}
			{error && (
				<div className="text-[11px] text-[var(--severity-error-fg)] mt-0.5" role="alert" data-testid={`folder-addon-error-${f.id}`}>
					{error}
				</div>
			)}
		</>
	);
}

/** Confirmation before removing a folder entry the dashboard did not write (may be committed). */
function NotOwnedConfirm({
	featureId,
	prompt,
	onConfirm,
	onCancel,
}: {
	featureId: string;
	prompt: FolderNotOwnedPrompt;
	onConfirm: () => void;
	onCancel: () => void;
}) {
	return (
		<div
			className="mt-1.5 p-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)]"
			role="alertdialog"
			aria-label={i18nT("addons.folder.removeEntryTitle", undefined, "Remove this folder entry")}
			data-testid={`folder-addon-notowned-${featureId}`}
		>
			<p className="text-[11px] text-[var(--text-secondary)] mb-1">
				{i18nT(
					"addons.folder.notOwned",
					undefined,
					"This folder has its own entry for this add-on that the dashboard did not write. Turning it on here means removing that entry from .pi/settings.json (it may be committed).",
				)}
			</p>
			{prompt.items.map((it) => (
				<pre key={it.source} className="text-[10px] font-mono whitespace-pre-wrap break-words mb-1">
					{JSON.stringify(it.entry, null, 2)}
				</pre>
			))}
			<div className="flex gap-2">
				<button
					type="button"
					onClick={onConfirm}
					className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30"
					data-testid={`folder-addon-remove-unowned-${featureId}`}
				>
					{i18nT("addons.folder.removeEntry", undefined, "Remove this folder entry")}
				</button>
				<button type="button" onClick={onCancel} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
					{i18nT("common.cancel", undefined, "Cancel")}
				</button>
			</div>
		</div>
	);
}

const SWITCH_BG = { on: "bg-[var(--accent-primary)]", mixed: "bg-[var(--severity-warning-fg)]", off: "bg-[var(--bg-hover)]" } as const;
const SWITCH_KNOB = { on: "translate-x-3", mixed: "translate-x-1.5", off: "translate-x-0.5" } as const;

function StateBadge({ f }: { f: AddonFeature }) {
	if (f.folderState !== "off-here" && f.folderState !== "partly-off-here") return null;
	const label =
		f.folderState === "off-here"
			? i18nT("addons.folder.offHere", undefined, "off in this folder")
			: i18nT("addons.folder.partlyOffHere", undefined, "partly off here");
	return (
		<span className={`${BADGE} border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]`} data-testid={`folder-addon-state-${f.id}`}>
			{label}
		</span>
	);
}

export function FolderAddonRow({ feature: f, busy, error, keptOn, notOwned, featureName, onToggle, onConfirmRemove, onCancelRemove }: Props) {
	const offGlobally = f.folderState === "off-globally";
	const look = f.folderState === "partly-off-here" ? "mixed" : f.folderState === "off-here" || offGlobally ? "off" : "on";
	const aria: boolean | "mixed" = look === "mixed" ? "mixed" : look === "on";
	const chips = featurePartChips(f);

	return (
		<div
			className="py-1.5 px-2 rounded hover:bg-[var(--bg-hover)] text-xs"
			data-testid={`folder-addon-row-${f.id}`}
			data-folder-state={f.folderState}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[var(--text-primary)] font-medium">{f.displayName}</span>
						<span className={`${BADGE} border-[var(--border-secondary)] text-[var(--text-secondary)]`} data-testid={`folder-addon-scope-${f.id}`}>
							{i18nT("addons.folder.scopeGlobal", undefined, "global")}
						</span>
						<span className={`${BADGE} border-[var(--border-secondary)] text-[var(--text-secondary)]`}>{originBadgeLabel(f)}</span>
						<StateBadge f={f} />
						{chips.map((c) => (
							<PartChip key={c.kind} kind={c.kind}>
								{c.count ? `${partLabel(c.kind)} ×${c.count}` : undefined}
							</PartChip>
						))}
					</div>
					{f.description && <div className={NOTE}>{f.description}</div>}
					<RowNotes f={f} keptOn={keptOn} error={error} featureName={featureName} />
					{notOwned && <NotOwnedConfirm featureId={f.id} prompt={notOwned} onConfirm={onConfirmRemove} onCancel={onCancelRemove} />}
				</div>
				<div className="flex items-center gap-2 flex-shrink-0">
					<span className="text-[10px] text-[var(--text-muted)]">{i18nT("addons.folder.onHere", undefined, "on here")}</span>
					<button
						type="button"
						role="checkbox"
						aria-checked={aria}
						aria-label={i18nT("addons.folder.switchLabel", { name: f.displayName }, `${f.displayName}: on here`)}
						disabled={busy || offGlobally}
						onClick={onToggle}
						data-testid={`folder-addon-switch-${f.id}`}
						className={`shrink-0 relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors disabled:opacity-50 ${SWITCH_BG[look]}`}
					>
						<span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${SWITCH_KNOB[look]}`} />
					</button>
				</div>
			</div>
		</div>
	);
}
