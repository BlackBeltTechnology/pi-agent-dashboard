/**
 * Directory Settings → Add-ons page ("Add-ons in this folder").
 *
 * Answers one question: what will a session started in this folder load? An
 * effective-set strip (from Global + added here − turned off here = loads here),
 * then the groups behind it: Added in this folder (folder packages with update /
 * uninstall, plus one row for loose `.pi/` files), From Global (a per-folder
 * "on here" switch that turns the feature's AI-agent part off for this folder
 * only) and Dashboard-only features (collapsed: plugins apply to every folder).
 * A Discover tab installs into this folder and turns an off-here add-on back on.
 *
 * The data and the switch flow live in `useFolderAddons`; the write is a
 * pi-standard project delta (`POST /api/addons/:id/toggle` with `scope: "local"`).
 *
 * See change: addons-hub-folder-view; earlier: directory-settings-page-and-scoped-md-editing.
 */
import { RECOMMENDED_EXTENSIONS } from "@blackbelt-technology/pi-dashboard-shared/recommended-extensions.js";
import type { AddonFeature, NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { sourcesMatch } from "@blackbelt-technology/pi-dashboard-shared/source-matching.js";
import { useCallback, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useFolderAddons } from "../../hooks/useFolderAddons.js";
import { useInstalledPackages } from "../../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import {
	computeStrip,
	EMPTY_FOLDER_FILTER,
	type FolderFilter,
	filterFolderFeatures,
	looseTotal,
	splitFolderGroups,
} from "../../lib/addons/folder-addons-helpers.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildFolderSettingsUrl } from "../../lib/nav/route-builders.js";
import { ResourceTrustDialog } from "../resource/ResourceTrustDialog.js";
import { AddonReloadBanner } from "../packages/AddonToggleConfirm.js";
import { PackageBrowser } from "../packages/PackageBrowser.js";
import { PackageInstallConfirmDialog } from "../packages/PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "../packages/PackageReadmeDialog.js";
import { FolderAddonRow } from "./FolderAddonRow.js";

interface Props {
	cwd: string;
}

type FolderTab = "loads" | "discover";

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

function GroupHeader({ title, hint, testId }: { title: string; hint?: string; testId: string }) {
	return (
		<h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mt-3 mb-1.5" data-testid={testId}>
			{title}
			{hint && <span className="ml-2 normal-case font-normal tracking-normal text-[var(--text-muted)]">{hint}</span>}
		</h3>
	);
}

export function PackagesPage({ cwd }: Props) {
	const [, navigate] = useLocation();
	const addons = useFolderAddons(cwd);
	const installed = useInstalledPackages("local", cwd);
	const operations = usePackageOperations("local", cwd, addons.refresh);
	const [tab, setTab] = useState<FolderTab>("loads");
	const [filter, setFilter] = useState<FolderFilter>(EMPTY_FOLDER_FILTER);
	const [confirmInstall, setConfirmInstall] = useState<{ source: string; pkg?: NpmPackageResult; scope: "global" | "local" } | null>(null);
	const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);

	const strip = useMemo(() => computeStrip(addons.features, addons.folder), [addons.features, addons.folder]);
	const shown = useMemo(() => filterFolderFeatures(addons.features, filter), [addons.features, filter]);
	const groups = useMemo(() => splitFolderGroups(shown), [shown]);
	const featureName = useCallback((id: string) => addons.features.find((f) => f.id === id)?.displayName ?? id, [addons.features]);
	const files = looseTotal(addons.folder.looseCounts);
	const filtering = filter.text.trim() !== "" || filter.addedHere || filter.turnedOffHere;

	// Recommended entries that are installed globally but off in this folder.
	const offHereRecommended = useMemo(() => {
		const out: Array<{ name: string; feature: AddonFeature }> = [];
		for (const f of addons.features) {
			if (f.folderState !== "off-here" && f.folderState !== "partly-off-here") continue;
			const rec = RECOMMENDED_EXTENSIONS.find((r) => f.packages.some((p) => sourcesMatch(p.source, r.source)));
			if (rec) out.push({ name: f.displayName, feature: f });
		}
		return out;
	}, [addons.features]);

	const doInstall = () => {
		if (!confirmInstall) return;
		operations.install(confirmInstall.source, confirmInstall.scope);
		setConfirmInstall(null);
	};

	const strHere = [strip.addedHere > 0 ? String(strip.addedHere) : null, strip.files > 0 ? `${strip.files} files` : null]
		.filter(Boolean)
		.join(" + ");

	return (
		<div className="p-3" data-testid="directory-settings-packages">
			<div className="flex items-center justify-between gap-2 mb-3 pb-1 border-b border-[var(--border-secondary)]">
				<h2 className="text-sm font-semibold text-[var(--text-primary)]">
					{i18nT("addons.folder.heading", undefined, "Add-ons in this folder")}
				</h2>
				<div role="group" aria-label={i18nT("addons.folder.scope", undefined, "Scope")} className="flex text-xs" data-testid="folder-addons-scope">
					<button
						type="button"
						aria-pressed={false}
						onClick={() => navigate("/settings/add-ons")}
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

			{addons.error && (
				<div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs" role="alert" data-testid="folder-addons-error">
					{addons.error}
				</div>
			)}
			{addons.folder.settingsError && (
				<div className="mb-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs" role="alert" data-testid="folder-addons-settings-error">
					{i18nT(
						"addons.folder.settingsError",
						{ error: addons.folder.settingsError },
						`This folder's .pi/settings.json cannot be read (${addons.folder.settingsError}); add-ons added or turned off here are not shown.`,
					)}
				</div>
			)}

			{/* The one question users have here: what will a session started in this folder load? */}
			<div
				className="flex flex-wrap items-stretch gap-2 mb-3"
				role="group"
				aria-label={i18nT("addons.folder.stripLabel", undefined, "What sessions in this folder load")}
				data-testid="folder-addons-strip"
			>
				<Seg value={String(strip.fromGlobal)} label={i18nT("addons.folder.stripGlobal", undefined, "from Global")} testId="folder-strip-global" />
				<Op>+</Op>
				<Seg value={strHere || "0"} label={i18nT("addons.folder.stripAdded", undefined, "added in this folder")} testId="folder-strip-added" />
				<Op>−</Op>
				<Seg value={String(strip.turnedOffHere)} label={i18nT("addons.folder.stripOff", undefined, "turned off here")} testId="folder-strip-off" />
				<Op>=</Op>
				<Seg
					value={
						strip.files > 0
							? i18nT("addons.folder.stripTotalFiles", { count: strip.total, files: strip.files }, `Sessions here load ${strip.total} add-ons + ${strip.files} own files`)
							: i18nT("addons.folder.stripTotal", { count: strip.total }, `Sessions here load ${strip.total} add-ons`)
					}
					label={i18nT("addons.folder.stripNote", undefined, "Changes apply to new sessions started in this folder")}
					testId="folder-strip-total"
					className="flex-1 min-w-[14rem]"
				/>
			</div>

			<details className="mb-3 rounded border border-[var(--border-secondary)] text-xs" data-testid="folder-addons-explainer">
				<summary className="px-2 py-1.5 cursor-pointer text-[var(--text-secondary)]">
					{i18nT("addons.folder.explainerTitle", undefined, "How global and folder add-ons combine")}
				</summary>
				<div className="p-2 grid gap-2 sm:grid-cols-3">
					<div>
						<h4 className="font-semibold text-[var(--text-primary)]">{i18nT("addons.folder.exGlobal", undefined, "Global")}</h4>
						<p className="text-[11px] text-[var(--text-secondary)]">
							{i18nT("addons.folder.exGlobalBody", undefined, "Loads in every folder. Install here when you want it everywhere.")}
						</p>
					</div>
					<div>
						<h4 className="font-semibold text-[var(--text-primary)]">{i18nT("addons.folder.exAdded", undefined, "Added in this folder")}</h4>
						<p className="text-[11px] text-[var(--text-secondary)]">
							{i18nT(
								"addons.folder.exAddedBody",
								undefined,
								"Loads only in sessions started here. Stored in this folder's .pi/settings.json, which can be committed with the repo so teammates get it too.",
							)}
						</p>
					</div>
					<div>
						<h4 className="font-semibold text-[var(--text-primary)]">{i18nT("addons.folder.exOff", undefined, "Turned off here")}</h4>
						<p className="text-[11px] text-[var(--text-secondary)]">
							{i18nT("addons.folder.exOffBody", undefined, "A global add-on you switched off for this folder. It keeps working everywhere else.")}
						</p>
					</div>
				</div>
				<p className="px-2 pb-2 text-[11px] text-[var(--text-secondary)]">
					{i18nT(
						"addons.folder.exPlugins",
						undefined,
						"Dashboard plugins change the dashboard itself, so they always apply to every folder.",
					)}
				</p>
			</details>

			<div role="tablist" aria-label={i18nT("addons.folder.heading", undefined, "Add-ons in this folder")} className="flex gap-1 mb-3 border-b border-[var(--border-secondary)]" data-testid="folder-addons-tabs">
				{(["loads", "discover"] as const).map((id) => (
					<button
						key={id}
						type="button"
						role="tab"
						aria-selected={tab === id}
						onClick={() => setTab(id)}
						data-testid={`folder-addons-tab-${id}`}
						className={`text-xs px-3 py-1.5 -mb-px border-b-2 cursor-pointer ${
							tab === id
								? "border-[var(--accent-primary)] text-[var(--text-primary)]"
								: "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						}`}
					>
						{id === "loads" ? i18nT("addons.folder.tabLoads", undefined, "What loads here") : i18nT("addons.tab.discover", undefined, "Discover")}
					</button>
				))}
			</div>

			{addons.reloadOffered && <AddonReloadBanner cwd={cwd} onDismiss={addons.dismissReload} />}

			{tab === "loads" && (
				<div role="tabpanel" data-testid="folder-addons-loads">
					<div className="flex items-center gap-2 flex-wrap mb-2">
						<input
							type="search"
							value={filter.text}
							onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
							placeholder={i18nT("addons.folder.filterPlaceholder", undefined, "Filter add-ons in this folder")}
							aria-label={i18nT("addons.folder.filterPlaceholder", undefined, "Filter add-ons in this folder")}
							className="flex-1 min-w-[10rem] px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
							data-testid="folder-addons-filter-input"
						/>
						{(
							[
								["addedHere", "folder-chip-added", i18nT("addons.folder.chipAdded", undefined, "Added here")],
								["turnedOffHere", "folder-chip-off", i18nT("addons.folder.chipOff", undefined, "Turned off here")],
							] as const
						).map(([key, testId, label]) => (
							<button
								key={key}
								type="button"
								aria-pressed={filter[key]}
								onClick={() => setFilter((f) => ({ ...f, [key]: !f[key] }))}
								data-testid={testId}
								className={`text-xs px-2 py-1 rounded border cursor-pointer ${
									filter[key]
										? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
										: "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
								}`}
							>
								{label}
							</button>
						))}
					</div>

					<GroupHeader
						title={i18nT("addons.folder.groupAdded", undefined, "Added in this folder")}
						hint={i18nT("addons.folder.groupAddedHint", undefined, "loads only in sessions started here")}
						testId="folder-group-added"
					/>
					<div className="space-y-1">
						{groups.added.map((f) => {
							const part = f.packages[0];
							const own = part?.scope === "project";
							return (
								<div key={f.id} className="py-1.5 px-2 rounded hover:bg-[var(--bg-hover)] text-xs" data-testid={`folder-added-row-${f.id}`}>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="text-[var(--text-primary)] font-medium">{f.displayName}</span>
												<span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--accent-primary)]/40 text-[var(--accent-primary)]">
													{i18nT("addons.folder.scopeFolder", undefined, "this folder")}
												</span>
											</div>
											{f.description && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{f.description}</div>}
											{f.loading && f.loading.loaded < f.loading.total && (
												<div className="text-[11px] text-[var(--text-muted)] mt-0.5" data-testid={`folder-added-loading-${f.id}`}>
													{i18nT(
														"addons.folder.loadingOf",
														{ loaded: f.loading.loaded, total: f.loading.total },
														`Loads only ${f.loading.loaded} of its ${f.loading.total} resources here.`,
													)}
												</div>
											)}
										</div>
										{own && part && (
											<div className="flex items-center gap-2 shrink-0">
												{part.version && <span className="text-[10px] text-[var(--text-muted)]">{part.version}</span>}
												<button
													type="button"
													onClick={() => operations.update(part.source)}
													className="px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
													data-testid={`folder-added-update-${f.id}`}
												>
													{i18nT("common.update", undefined, "Update")}
												</button>
												<button
													type="button"
													onClick={() => operations.remove(part.source)}
													className="px-2 py-0.5 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
													data-testid={`folder-added-uninstall-${f.id}`}
												>
													{i18nT("packages.uninstall", undefined, "Uninstall")}
												</button>
											</div>
										)}
									</div>
								</div>
							);
						})}
						{files > 0 && !filtering && (
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
											{(["skills", "agents", "prompts", "extensions", "themes"] as const)
												.filter((k) => addons.folder.looseCounts[k] > 0)
												.map((k) => `${addons.folder.looseCounts[k]} ${k}`)
												.join(" · ")}
										</div>
									</div>
									<a
										href={buildFolderSettingsUrl(cwd, "skills")}
										onClick={(e) => {
											e.preventDefault();
											navigate(buildFolderSettingsUrl(cwd, "skills"));
										}}
										className="text-[var(--accent-primary)] hover:underline shrink-0"
										data-testid="folder-own-files-link"
									>
										{i18nT("addons.folder.openResources", undefined, "Open in Resources →")}
									</a>
								</div>
							</div>
						)}
						{groups.added.length === 0 && (files === 0 || filtering) && (
							<p className="text-xs text-[var(--text-muted)] italic">{i18nT("addons.group.empty", undefined, "Nothing here yet.")}</p>
						)}
					</div>

					<GroupHeader
						title={i18nT("addons.folder.groupGlobal", undefined, "From Global")}
						hint={i18nT("addons.folder.groupGlobalHint", { count: groups.fromGlobal.length }, `(${groups.fromGlobal.length}) · switch one off to disable it in this folder only`)}
						testId="folder-group-global"
					/>
					<div className="space-y-1">
						{groups.fromGlobal.map((f) => (
							<FolderAddonRow
								key={f.id}
								feature={f}
								busy={addons.busyId === f.id}
								error={addons.rowErrors[f.id]}
								keptOn={addons.keptOn[f.id]}
								notOwned={addons.notOwned?.featureId === f.id ? addons.notOwned : undefined}
								featureName={featureName}
								onToggle={() => addons.toggle(f)}
								onConfirmRemove={addons.confirmRemoveUnowned}
								onCancelRemove={addons.dismissNotOwned}
							/>
						))}
						{groups.fromGlobal.length === 0 && (
							<p className="text-xs text-[var(--text-muted)] italic">{i18nT("addons.group.empty", undefined, "Nothing here yet.")}</p>
						)}
					</div>

					<details className="mt-3" data-testid="folder-group-dashboard-only">
						<summary className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide cursor-pointer">
							{i18nT("addons.folder.groupDashboardOnly", undefined, "Dashboard-only features")}
							<span className="ml-2 normal-case font-normal tracking-normal text-[var(--text-muted)]">
								{i18nT(
									"addons.folder.groupDashboardOnlyHint",
									{ count: groups.dashboardOnly.length },
									`(${groups.dashboardOnly.length}) · always apply to every folder, no per-folder switch`,
								)}
							</span>
						</summary>
						<ul className="mt-1.5 space-y-0.5 text-xs text-[var(--text-secondary)]">
							{groups.dashboardOnly.map((f) => (
								<li key={f.id} data-testid={`folder-dashboard-only-${f.id}`}>
									<span className="text-[var(--text-primary)]">{f.displayName}</span>
									{f.description && <span className="text-[var(--text-muted)]"> — {f.description}</span>}
								</li>
							))}
						</ul>
					</details>
				</div>
			)}

			{tab === "discover" && (
				<div role="tabpanel" data-testid="folder-addons-discover">
					{offHereRecommended.length > 0 && (
						<div className="mb-3" data-testid="folder-discover-off-here">
							{offHereRecommended.map(({ name, feature }) => (
								<div key={feature.id} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded border border-[var(--border-secondary)] mb-1 text-xs">
									<div>
										<span className="text-[var(--text-primary)] font-medium">{name}</span>
										<span className="ml-2 text-[11px] text-[var(--text-muted)]">
											{i18nT("addons.folder.installedGloballyOffHere", undefined, "installed globally, off here")}
										</span>
									</div>
									<button
										type="button"
										onClick={() => addons.turnOn(feature.id)}
										disabled={addons.busyId === feature.id}
										className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50"
										data-testid={`folder-discover-turn-on-${feature.id}`}
									>
										{i18nT("addons.folder.turnOnHere", undefined, "Turn on here")}
									</button>
								</div>
							))}
						</div>
					)}
					<PackageBrowser
						scope="local"
						cwd={cwd}
						onViewReadme={setReadmePkg}
						// Folder surface defaults to LOCAL scope; the dialog exposes a radio to switch to global.
						onConfirmInstall={(source, pkg) => setConfirmInstall({ source, pkg, scope: "local" })}
						showInstalledSection={false}
						hideGlobalInstalledRecommended
					/>
				</div>
			)}

			{confirmInstall && (
				<PackageInstallConfirmDialog
					source={confirmInstall.source}
					packageName={confirmInstall.pkg?.name}
					scope={confirmInstall.scope}
					onScopeChange={(s) => setConfirmInstall((prev) => (prev ? { ...prev, scope: s } : prev))}
					onConfirm={doInstall}
					onCancel={() => setConfirmInstall(null)}
				/>
			)}
			{readmePkg && (
				<PackageReadmeDialog
					pkg={readmePkg}
					installed={installed.packages.some((p) => p.source === `npm:${readmePkg.name}`)}
					onInstall={() => {
						setConfirmInstall({ source: `npm:${readmePkg.name}`, pkg: readmePkg, scope: "local" });
						setReadmePkg(null);
					}}
					onUninstall={() => {
						operations.remove(`npm:${readmePkg.name}`);
						setReadmePkg(null);
					}}
					onClose={() => setReadmePkg(null)}
				/>
			)}
			{addons.trustPrompt && (
				<ResourceTrustDialog
					cwd={cwd}
					message={addons.trustPrompt.message}
					options={addons.trustPrompt.options}
					preselected={addons.trustPrompt.preselected}
					dashboardSource={addons.trustPrompt.dashboardSource}
					onChoose={addons.resolveTrust}
					onDismiss={addons.dismissTrust}
				/>
			)}
		</div>
	);
}
