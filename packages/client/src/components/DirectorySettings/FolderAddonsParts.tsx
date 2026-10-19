/**
 * Presentational parts of the folder Add-ons page (`PackagesPage.tsx`): header,
 * effective-set strip, explainer, filter bar, the Added-in-this-folder group
 * (folder packages + the loose `.pi/` files row), the collapsed Dashboard-only
 * group and the off-here list of the Discover tab. No fetching: state and data
 * come from `useFolderAddons` through props.
 *
 * See change: addons-hub-folder-view (spec: addons-folder-view › folder page).
 */
import type { AddonFeature, AddonLooseCounts } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { type FolderFilter, type FolderStrip, looseTotal } from "../../lib/addons/folder-addons-helpers.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

function Seg({ value, label, testId, className = "" }: { value: string; label: string; testId: string; className?: string }) {
	return (
		<div className={`px-3 py-1.5 rounded border border-[var(--border-secondary)] ${className}`} data-testid={testId}>
			<b className="block text-[var(--text-primary)] text-sm">{value}</b>
			<small className="text-[10px] text-[var(--text-muted)]">{label}</small>
		</div>
	);
}

const Op = ({ children }: { children: string }) => (
	<div className="self-center text-[var(--text-muted)]" aria-hidden="true">
		{children}
	</div>
);

export function GroupHeader({ title, hint, testId }: { title: string; hint?: string; testId: string }) {
	return (
		<h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mt-3 mb-1.5" data-testid={testId}>
			{title}
			{hint && <span className="ml-2 normal-case font-normal tracking-normal text-[var(--text-muted)]">{hint}</span>}
		</h3>
	);
}

export function FolderHeader({ onGlobal }: { onGlobal: () => void }) {
	return (
		<div className="flex items-center justify-between gap-2 mb-3 pb-1 border-b border-[var(--border-secondary)]">
			<h2 className="text-sm font-semibold text-[var(--text-primary)]">{i18nT("addons.folder.heading", undefined, "Add-ons in this folder")}</h2>
			<div role="group" aria-label={i18nT("addons.folder.scope", undefined, "Scope")} className="flex text-xs" data-testid="folder-addons-scope">
				<button
					type="button"
					aria-pressed={false}
					onClick={onGlobal}
					className="px-2 py-1 rounded-l border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					data-testid="folder-addons-scope-global"
				>
					{i18nT("addons.folder.scopeGlobalButton", undefined, "Global")}
				</button>
				<button
					type="button"
					aria-pressed={true}
					className="px-2 py-1 rounded-r border border-l-0 border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
					data-testid="folder-addons-scope-folder"
				>
					{i18nT("addons.folder.scopeFolderButton", undefined, "This folder")}
				</button>
			</div>
		</div>
	);
}

/** The one question users have here: what will a session started in this folder load? */
export function FolderStripView({ strip }: { strip: FolderStrip }) {
	const added = [strip.addedHere > 0 ? String(strip.addedHere) : null, strip.files > 0 ? `${strip.files} files` : null].filter(Boolean).join(" + ");
	const total =
		strip.files > 0
			? i18nT("addons.folder.stripTotalFiles", { count: strip.total, files: strip.files }, `Sessions here load ${strip.total} add-ons + ${strip.files} own files`)
			: i18nT("addons.folder.stripTotal", { count: strip.total }, `Sessions here load ${strip.total} add-ons`);
	return (
		<div
			className="flex flex-wrap items-stretch gap-2 mb-3"
			role="group"
			aria-label={i18nT("addons.folder.stripLabel", undefined, "What sessions in this folder load")}
			data-testid="folder-addons-strip"
		>
			<Seg value={String(strip.fromGlobal)} label={i18nT("addons.folder.stripGlobal", undefined, "from Global")} testId="folder-strip-global" />
			<Op>+</Op>
			<Seg value={added || "0"} label={i18nT("addons.folder.stripAdded", undefined, "added in this folder")} testId="folder-strip-added" />
			<Op>−</Op>
			<Seg value={String(strip.turnedOffHere)} label={i18nT("addons.folder.stripOff", undefined, "turned off here")} testId="folder-strip-off" />
			<Op>=</Op>
			<Seg
				value={total}
				label={i18nT("addons.folder.stripNote", undefined, "Changes apply to new sessions started in this folder")}
				testId="folder-strip-total"
				className="flex-1 min-w-[14rem]"
			/>
		</div>
	);
}

function ExplainerCard({ title, body }: { title: string; body: string }) {
	return (
		<div>
			<h4 className="font-semibold text-[var(--text-primary)]">{title}</h4>
			<p className="text-[11px] text-[var(--text-secondary)]">{body}</p>
		</div>
	);
}

export function FolderExplainer() {
	return (
		<details className="mb-3 rounded border border-[var(--border-secondary)] text-xs" data-testid="folder-addons-explainer">
			<summary className="px-2 py-1.5 cursor-pointer text-[var(--text-secondary)]">
				{i18nT("addons.folder.explainerTitle", undefined, "How global and folder add-ons combine")}
			</summary>
			<div className="p-2 grid gap-2 sm:grid-cols-3">
				<ExplainerCard
					title={i18nT("addons.folder.exGlobal", undefined, "Global")}
					body={i18nT("addons.folder.exGlobalBody", undefined, "Loads in every folder. Install here when you want it everywhere.")}
				/>
				<ExplainerCard
					title={i18nT("addons.folder.exAdded", undefined, "Added in this folder")}
					body={i18nT(
						"addons.folder.exAddedBody",
						undefined,
						"Loads only in sessions started here. Stored in this folder's .pi/settings.json, which can be committed with the repo so teammates get it too.",
					)}
				/>
				<ExplainerCard
					title={i18nT("addons.folder.exOff", undefined, "Turned off here")}
					body={i18nT("addons.folder.exOffBody", undefined, "A global add-on you switched off for this folder. It keeps working everywhere else.")}
				/>
			</div>
			<p className="px-2 pb-2 text-[11px] text-[var(--text-secondary)]">
				{i18nT("addons.folder.exPlugins", undefined, "Dashboard plugins change the dashboard itself, so they always apply to every folder.")}
			</p>
		</details>
	);
}

const CHIPS = [
	["addedHere", "folder-chip-added", "addons.folder.chipAdded", "Added here"],
	["turnedOffHere", "folder-chip-off", "addons.folder.chipOff", "Turned off here"],
] as const;

export function FolderFilterBar({ filter, onChange }: { filter: FolderFilter; onChange: (f: FolderFilter) => void }) {
	const placeholder = i18nT("addons.folder.filterPlaceholder", undefined, "Filter add-ons in this folder");
	return (
		<div className="flex items-center gap-2 flex-wrap mb-2">
			<input
				type="search"
				value={filter.text}
				onChange={(e) => onChange({ ...filter, text: e.target.value })}
				placeholder={placeholder}
				aria-label={placeholder}
				className="flex-1 min-w-[10rem] px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
				data-testid="folder-addons-filter-input"
			/>
			{CHIPS.map(([key, testId, i18nKey, label]) => (
				<button
					key={key}
					type="button"
					aria-pressed={filter[key]}
					onClick={() => onChange({ ...filter, [key]: !filter[key] })}
					data-testid={testId}
					className={`text-xs px-2 py-1 rounded border cursor-pointer ${
						filter[key]
							? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
							: "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					}`}
				>
					{i18nT(i18nKey, undefined, label)}
				</button>
			))}
		</div>
	);
}

interface AddedRowProps {
	feature: AddonFeature;
	onUpdate: (source: string) => void;
	onUninstall: (source: string) => void;
}

/** A folder package (or a global add-on loaded here): update + uninstall only for packages installed in this folder. */
function AddedRow({ feature: f, onUpdate, onUninstall }: AddedRowProps) {
	const part = f.packages[0];
	const own = part?.scope === "project";
	const partial = f.loading && f.loading.loaded < f.loading.total ? f.loading : undefined;
	return (
		<div className="py-1.5 px-2 rounded hover:bg-[var(--bg-hover)] text-xs" data-testid={`folder-added-row-${f.id}`}>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[var(--text-primary)] font-medium">{f.displayName}</span>
						<span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--accent-primary)]/40 text-[var(--accent-primary)]">
							{i18nT("addons.folder.scopeFolder", undefined, "this folder")}
						</span>
					</div>
					{f.description && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{f.description}</div>}
					{partial && (
						<div className="text-[11px] text-[var(--text-muted)] mt-0.5" data-testid={`folder-added-loading-${f.id}`}>
							{i18nT(
								"addons.folder.loadingOf",
								{ loaded: partial.loaded, total: partial.total },
								`Loads only ${partial.loaded} of its ${partial.total} resources here.`,
							)}
						</div>
					)}
				</div>
				{own && part && (
					<div className="flex items-center gap-2 shrink-0">
						{part.version && <span className="text-[10px] text-[var(--text-muted)]">{part.version}</span>}
						<button
							type="button"
							onClick={() => onUpdate(part.source)}
							className="px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
							data-testid={`folder-added-update-${f.id}`}
						>
							{i18nT("common.update", undefined, "Update")}
						</button>
						<button
							type="button"
							onClick={() => onUninstall(part.source)}
							className="px-2 py-0.5 rounded border border-[var(--severity-error-border)] text-[var(--severity-error-fg)] hover:bg-[var(--severity-error-bg)]"
							data-testid={`folder-added-uninstall-${f.id}`}
						>
							{i18nT("packages.uninstall", undefined, "Uninstall")}
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

/** One "Your files in .pi/" row: loose resources that are not part of any package. */
function OwnFilesRow({ counts, resourcesHref, onOpen }: { counts: AddonLooseCounts; resourcesHref: string; onOpen: () => void }) {
	const summary = (["skills", "agents", "prompts", "extensions", "themes"] as const)
		.filter((k) => counts[k] > 0)
		.map((k) => `${counts[k]} ${k}`)
		.join(" · ");
	return (
		<div className="py-1.5 px-2 rounded hover:bg-[var(--bg-hover)] text-xs" data-testid="folder-own-files-row">
			<div className="flex items-start justify-between gap-2">
				<div>
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[var(--text-primary)] font-medium">{i18nT("addons.folder.ownFiles", undefined, "Your files in .pi/")}</span>
						<span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)]">
							{i18nT("addons.folder.notAPackage", undefined, "not a package")}
						</span>
					</div>
					<div className="text-[11px] text-[var(--text-muted)] mt-0.5" data-testid="folder-own-files-counts">
						{summary}
					</div>
				</div>
				<a
					href={resourcesHref}
					onClick={(e) => {
						e.preventDefault();
						onOpen();
					}}
					className="text-[var(--accent-primary)] hover:underline shrink-0"
					data-testid="folder-own-files-link"
				>
					{i18nT("addons.folder.openResources", undefined, "Open in Resources →")}
				</a>
			</div>
		</div>
	);
}

interface AddedGroupProps extends Omit<AddedRowProps, "feature"> {
	features: readonly AddonFeature[];
	counts: AddonLooseCounts;
	/** A filter hides the files row (it is not a feature). */
	filtering: boolean;
	resourcesHref: string;
	onOpenResources: () => void;
}

export function AddedGroup({ features, counts, filtering, resourcesHref, onOpenResources, onUpdate, onUninstall }: AddedGroupProps) {
	const showFiles = looseTotal(counts) > 0 && !filtering;
	return (
		<>
			<GroupHeader
				title={i18nT("addons.folder.groupAdded", undefined, "Added in this folder")}
				hint={i18nT("addons.folder.groupAddedHint", undefined, "loads only in sessions started here")}
				testId="folder-group-added"
			/>
			<div className="space-y-1">
				{features.map((f) => (
					<AddedRow key={f.id} feature={f} onUpdate={onUpdate} onUninstall={onUninstall} />
				))}
				{showFiles && <OwnFilesRow counts={counts} resourcesHref={resourcesHref} onOpen={onOpenResources} />}
				{features.length === 0 && !showFiles && (
					<p className="text-xs text-[var(--text-muted)] italic">{i18nT("addons.group.empty", undefined, "Nothing here yet.")}</p>
				)}
			</div>
		</>
	);
}

export function DashboardOnlyGroup({ features }: { features: readonly AddonFeature[] }) {
	return (
		<details className="mt-3" data-testid="folder-group-dashboard-only">
			<summary className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide cursor-pointer">
				{i18nT("addons.folder.groupDashboardOnly", undefined, "Dashboard-only features")}
				<span className="ml-2 normal-case font-normal tracking-normal text-[var(--text-muted)]">
					{i18nT(
						"addons.folder.groupDashboardOnlyHint",
						{ count: features.length },
						`(${features.length}) · always apply to every folder, no per-folder switch`,
					)}
				</span>
			</summary>
			<ul className="mt-1.5 space-y-0.5 text-xs text-[var(--text-secondary)]">
				{features.map((f) => (
					<li key={f.id} data-testid={`folder-dashboard-only-${f.id}`}>
						<span className="text-[var(--text-primary)]">{f.displayName}</span>
						{f.description && <span className="text-[var(--text-muted)]"> — {f.description}</span>}
					</li>
				))}
			</ul>
		</details>
	);
}

interface OffHereProps {
	entries: ReadonlyArray<{ name: string; feature: AddonFeature }>;
	busyId: string | null;
	onTurnOn: (featureId: string) => void;
}

/** Discover: recommended add-ons installed globally but off in this folder. */
export function DiscoverOffHere({ entries, busyId, onTurnOn }: OffHereProps) {
	if (entries.length === 0) return null;
	return (
		<div className="mb-3" data-testid="folder-discover-off-here">
			{entries.map(({ name, feature }) => (
				<div key={feature.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-[var(--border-secondary)] mb-1 text-xs">
					<div>
						<span className="text-[var(--text-primary)] font-medium">{name}</span>
						<span className="ml-2 text-[11px] text-[var(--text-muted)]">
							{i18nT("addons.folder.installedGloballyOffHere", undefined, "installed globally, off here")}
						</span>
					</div>
					<button
						type="button"
						onClick={() => onTurnOn(feature.id)}
						disabled={busyId === feature.id}
						className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50"
						data-testid={`folder-discover-turn-on-${feature.id}`}
					>
						{i18nT("addons.folder.turnOnHere", undefined, "Turn on here")}
					</button>
				</div>
			))}
		</div>
	);
}
