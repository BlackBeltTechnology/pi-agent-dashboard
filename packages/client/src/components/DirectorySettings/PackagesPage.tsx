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
 * Presentational parts: `FolderAddonsParts.tsx`, `FolderAddonRow.tsx`.
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
	splitFolderGroups,
} from "../../lib/addons/folder-addons-helpers.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildFolderSettingsUrl } from "../../lib/nav/route-builders.js";
import { AddonReloadBanner } from "../packages/AddonToggleConfirm.js";
import { PackageBrowser } from "../packages/PackageBrowser.js";
import { PackageInstallConfirmDialog } from "../packages/PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "../packages/PackageReadmeDialog.js";
import { ResourceTrustDialog } from "../resource/ResourceTrustDialog.js";
import { FolderAddonRow } from "./FolderAddonRow.js";
import {
	AddedGroup,
	DashboardOnlyGroup,
	DiscoverOffHere,
	FolderExplainer,
	FolderFilterBar,
	FolderHeader,
	FolderStripView,
	GroupHeader,
} from "./FolderAddonsParts.js";

interface Props {
	cwd: string;
}

type FolderTab = "loads" | "discover";
type InstallRequest = { source: string; pkg?: NpmPackageResult; scope: "global" | "local" };

/** Recommended entries that are installed globally but off in this folder. */
function offHereRecommended(features: readonly AddonFeature[]): Array<{ name: string; feature: AddonFeature }> {
	return features
		.filter((f) => f.folderState === "off-here" || f.folderState === "partly-off-here")
		.filter((f) => RECOMMENDED_EXTENSIONS.some((r) => f.packages.some((p) => sourcesMatch(p.source, r.source))))
		.map((feature) => ({ name: feature.displayName, feature }));
}

function TabBar({ tab, onChange }: { tab: FolderTab; onChange: (t: FolderTab) => void }) {
	return (
		<div
			role="tablist"
			aria-label={i18nT("addons.folder.heading", undefined, "Add-ons in this folder")}
			className="flex gap-1 mb-3 border-b border-[var(--border-secondary)]"
			data-testid="folder-addons-tabs"
		>
			{(["loads", "discover"] as const).map((id) => (
				<button
					key={id}
					type="button"
					role="tab"
					aria-selected={tab === id}
					onClick={() => onChange(id)}
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
	);
}

function Banner({ tone, testId, children }: { tone: "error" | "warn"; testId: string; children: React.ReactNode }) {
	const cls = tone === "error" ? "border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]" : "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]";
	return (
		<div className={`mb-2 p-2 rounded border text-xs ${cls}`} role="alert" data-testid={testId}>
			{children}
		</div>
	);
}

export function PackagesPage({ cwd }: Props) {
	const [, navigate] = useLocation();
	const addons = useFolderAddons(cwd);
	const installed = useInstalledPackages("local", cwd);
	const operations = usePackageOperations("local", cwd, addons.refresh);
	const [tab, setTab] = useState<FolderTab>("loads");
	const [filter, setFilter] = useState<FolderFilter>(EMPTY_FOLDER_FILTER);
	const [confirmInstall, setConfirmInstall] = useState<InstallRequest | null>(null);
	const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);

	const strip = useMemo(() => computeStrip(addons.features, addons.folder), [addons.features, addons.folder]);
	const groups = useMemo(() => splitFolderGroups(filterFolderFeatures(addons.features, filter)), [addons.features, filter]);
	const offHere = useMemo(() => offHereRecommended(addons.features), [addons.features]);
	const featureName = useCallback((id: string) => addons.features.find((f) => f.id === id)?.displayName ?? id, [addons.features]);
	const filtering = filter.text.trim() !== "" || filter.addedHere || filter.turnedOffHere;
	const resourcesUrl = buildFolderSettingsUrl(cwd, "skills");
	const { settingsError } = addons.folder;

	const doInstall = () => {
		if (confirmInstall) operations.install(confirmInstall.source, confirmInstall.scope);
		setConfirmInstall(null);
	};
	// The folder surface defaults to LOCAL scope; the dialog exposes a radio to switch to global.
	const askInstall = (source: string, pkg?: NpmPackageResult) => setConfirmInstall({ source, pkg, scope: "local" });

	return (
		<div className="p-3" data-testid="directory-settings-packages">
			<FolderHeader onGlobal={() => navigate("/settings/add-ons")} />
			{addons.error && (
				<Banner tone="error" testId="folder-addons-error">
					{addons.error}
				</Banner>
			)}
			{settingsError && (
				<Banner tone="warn" testId="folder-addons-settings-error">
					{i18nT(
						"addons.folder.settingsError",
						{ error: settingsError },
						`This folder's .pi/settings.json cannot be read (${settingsError}); add-ons added or turned off here are not shown.`,
					)}
				</Banner>
			)}
			<FolderStripView strip={strip} />
			<FolderExplainer />
			<TabBar tab={tab} onChange={setTab} />
			{addons.reloadOffered && <AddonReloadBanner cwd={cwd} onDismiss={addons.dismissReload} />}

			{tab === "loads" && (
				<div role="tabpanel" data-testid="folder-addons-loads">
					<FolderFilterBar filter={filter} onChange={setFilter} />
					<AddedGroup
						features={groups.added}
						counts={addons.folder.looseCounts}
						filtering={filtering}
						resourcesHref={resourcesUrl}
						onOpenResources={() => navigate(resourcesUrl)}
						onUpdate={(source) => operations.update(source)}
						onUninstall={(source) => operations.remove(source)}
					/>
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
					<DashboardOnlyGroup features={groups.dashboardOnly} />
				</div>
			)}

			{tab === "discover" && (
				<div role="tabpanel" data-testid="folder-addons-discover">
					<DiscoverOffHere entries={offHere} busyId={addons.busyId} onTurnOn={addons.turnOn} />
					<PackageBrowser
						scope="local"
						cwd={cwd}
						onViewReadme={setReadmePkg}
						onConfirmInstall={askInstall}
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
						askInstall(`npm:${readmePkg.name}`, readmePkg);
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
