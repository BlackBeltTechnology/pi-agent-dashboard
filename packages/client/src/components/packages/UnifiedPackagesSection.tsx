/**
 * Settings → Add-ons page. One "Add-ons" header, then three tabs:
 *
 *   - Installed — one row per catalog feature (`GET /api/addons/catalog`):
 *     dashboard plugin + bridge + pi packages joined, origin badge, part chips,
 *     one switch per feature, grouping and filter chips. Core pi rows keep their
 *     `usePackageOperations`-driven state.
 *   - Updates — every updatable package part + pi core, one "Update all".
 *   - Discover — recommended extensions, npm search, install from source.
 *
 * The component keeps its name and mount lifecycle (health fetch, update
 * auto-check on mount / every 30 min / after each package operation, Check now).
 * Core in-flight state is NOT component-local: pi-core updates ride the singleton
 * `packageQueue` (keyed `pi-core:<scoped-name>`) so a spinner survives this
 * component unmounting.
 *
 * See change: consolidate-packages-settings-ui, unify-pi-core-into-package-queue,
 * addons-hub-declutter, addons-hub-feature-catalog.
 */

import type {
	AddonFeature,
	AddonPackagePart,
	NpmPackageResult,
	PackageHealthListResponseData,
	PiCorePackage,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiAlertCircle, mdiArrowUpBold, mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAddonCatalog } from "../../hooks/useAddonCatalog.js";
import { useLaunchSource } from "../../hooks/useLaunchSource.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { usePersistedBoolean } from "../../hooks/usePersistedBoolean.js";
import { usePiChangelog } from "../../hooks/usePiChangelog.js";
import { usePiCoreVersions } from "../../hooks/usePiCoreVersions.js";
import {
	type AddonFilter,
	type AddonGrouping,
	EMPTY_ADDON_FILTER,
	filterFeatures,
	groupFeatures,
	isAddonFilterActive,
	isLocalSourceFeature,
	originCounts,
	originStripLabel,
} from "../../lib/addons/addon-feature-helpers.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { ADDONS_NPM_SEARCH_EVENT } from "../../lib/package/installed-list-helpers.js";
import { classifySource } from "../../lib/package/package-classifier.js";
import { applyPackageCleanup, fetchPackageHealth } from "../../lib/package/package-health-api.js";
import { piCoreSource } from "../../lib/package/package-queue.js";
import { logRejection } from "../../lib/report-error.js";
import { PinDirectoryDialog } from "../workspace/PinDirectoryDialog.js";
import { AddonFeatureRow } from "./AddonFeatureRow.js";
import { AddonsDiscoverTab } from "./AddonsDiscoverTab.js";
import { AddonsExplainer } from "./AddonsExplainer.js";
import { AddonsUpdatesTab, type UpdatablePart, updatableParts } from "./AddonsUpdatesTab.js";
import { AddonReloadBanner, AddonToggleConfirm, useAddonToggle } from "./AddonToggleConfirm.js";
import { countHealthIssues, PackageHealthPanel } from "./PackageHealthPanel.js";
import { PackagePartialSuccessBanner } from "./PackagePartialSuccessBanner.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";
import { PackageRow, type PackageRowProps } from "./PackageRow.js";
import { WhatsNewDialog } from "./WhatsNewDialog.js";
import { WhatsNewPackageRow } from "./WhatsNewPackageRow.js";

/** Single core package the breaking-change icon is wired for. v1 scope. */
const PI_CORE_PKG = "@earendil-works/pi-coding-agent";

export type AddonsTab = "installed" | "updates" | "discover";
const TABS: readonly AddonsTab[] = ["installed", "updates", "discover"];

/** `?tab=` → tab; an unknown value selects Installed. */
function parseAddonsTab(search: string): AddonsTab {
	const v = new URLSearchParams(search).get("tab");
	return TABS.includes(v as AddonsTab) ? (v as AddonsTab) : "installed";
}

/**
 * Extract the bare npm package name from an installed-package `source`
 * (`npm:<name>` or `npm:<name>@<version>`). Returns null for non-npm
 * sources (git/local) where a changelog query is not meaningful.
 */
function npmNameFromSource(source: string): string | null {
	if (!source.startsWith("npm:")) return null;
	const spec = source.slice(4);
	const at = spec.lastIndexOf("@");
	// at>0 strips a trailing @version while preserving a leading @scope.
	return at > 0 ? spec.slice(0, at) : spec;
}

function relativeTime(iso: string, t: ReturnType<typeof useI18n>["t"]): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const diff = Math.floor((Date.now() - then) / 1000);
	if (diff < 5) return t("time.justNow", undefined, "just now");
	if (diff < 60) return t("time.secondsAgo", { count: diff }, `${diff}s ago`);
	if (diff < 3600) {
		const count = Math.floor(diff / 60);
		return t("time.minutesAgo", { count }, `${count}m ago`);
	}
	if (diff < 86400) {
		const count = Math.floor(diff / 3600);
		return t("time.hoursAgo", { count }, `${count}h ago`);
	}
	const count = Math.floor(diff / 86400);
	return t("time.daysAgo", { count }, `${count}d ago`);
}

const partDisplayName = (f: AddonFeature, p: AddonPackagePart) =>
	f.packages.length > 1 ? `${f.displayName} — ${p.packageName ?? p.source}` : f.displayName;

export function UnifiedPackagesSection() {
	const { t } = useI18n();
	const [, navigate] = useLocation();
	// launchSource gates the Core pi rows. Under Electron, bundled node_modules/ is
	// read-only — pi-version upgrades flow via electron-updater whole-app replacement.
	// See change: eliminate-electron-runtime-install (task 3.3).
	const launchSource = useLaunchSource();
	const hideCoreGroup = launchSource === "electron";

	// ── Tab state, mirrored in `?tab=` so it survives reload ──
	const [tab, setTabState] = useState<AddonsTab>(() => parseAddonsTab(window.location.search));
	const setTab = useCallback((next: AddonsTab) => {
		setTabState(next);
		const url = new URL(window.location.href);
		url.searchParams.set("tab", next);
		window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
	}, []);
	useEffect(() => {
		const onPop = () => setTabState(parseAddonsTab(window.location.search));
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);

	// ── Core data (pi + pi-dashboard) ──
	const { status, isLoading, error, refresh } = usePiCoreVersions();
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((n) => n + 1), 30_000);
		return () => clearInterval(id);
	}, []);
	const corePackages: PiCorePackage[] = status?.packages ?? [];
	const updatableCore = useMemo(() => corePackages.filter((p) => p.updateAvailable), [corePackages]);

	// ── pi changelog (breaking-change icon + WhatsNewDialog). See change: pi-update-whats-new-panel.
	const piPkg = useMemo(() => corePackages.find((p) => p.name === PI_CORE_PKG), [corePackages]);
	const piChangelogEnabled =
		!!piPkg && !!piPkg.updateAvailable && !!piPkg.latestVersion && piPkg.latestVersion !== piPkg.currentVersion;
	const piChangelog = usePiChangelog(piPkg?.name ?? PI_CORE_PKG, piPkg?.currentVersion, piPkg?.latestVersion ?? undefined, {
		enabled: piChangelogEnabled,
	});
	const piBreakingCount = useMemo(() => {
		if (!piChangelog.data || !piChangelog.data.hasBreaking) return 0;
		return piChangelog.data.releases.reduce((s, r) => s + r.breaking.length, 0);
	}, [piChangelog.data]);
	const piWhatsNewKind = useMemo<"breaking" | "info" | undefined>(() => {
		if (!piChangelog.data) return undefined;
		if (piChangelog.data.hasBreaking) return "breaking";
		if (piChangelog.data.releases.length > 0) return "info";
		return undefined;
	}, [piChangelog.data]);
	const [whatsNewOpen, setWhatsNewOpen] = useState(false);

	// ── Feature catalog ──
	const catalog = useAddonCatalog();
	const operations = usePackageOperations("global", undefined, catalog.refresh);
	const toggle = useAddonToggle(catalog.features, catalog.refresh);
	const [updatesAvailable, setUpdatesAvailable] = useState<Set<string>>(new Set());
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);
	const [movePickerSource, setMovePickerSource] = useState<string | null>(null);

	// Installed-list filter + grouping + explainer disclosure.
	const [filter, setFilter] = useState<AddonFilter>(EMPTY_ADDON_FILTER);
	const [grouping, setGrouping] = useState<AddonGrouping>("kind");
	const [explainerDismissed, setExplainerDismissed] = usePersistedBoolean("dashboard:addons-explainer-dismissed");
	const explainerExpanded = explainerDismissed !== true;
	const explainerToggleRef = useRef<HTMLButtonElement | null>(null);
	const [focusExplainer, setFocusExplainer] = useState(0);
	useEffect(() => {
		if (focusExplainer > 0) explainerToggleRef.current?.focus();
	}, [focusExplainer]);

	// ── Package health (stale / missing / duplicate packages[] entries). See change: add-package-health-cleanup.
	const [health, setHealth] = useState<PackageHealthListResponseData | null>(null);
	const [restartRequired, setRestartRequired] = useState(false);
	const loadHealth = useCallback(async () => {
		try {
			setHealth(await fetchPackageHealth());
		} catch (err) {
			logRejection("UnifiedPackagesSection.health")(err);
		}
	}, []);
	useEffect(() => {
		loadHealth().catch(logRejection("UnifiedPackagesSection.health"));
	}, [loadHealth]);
	const applyHealthCleanup = useCallback(
		async (drop: string[]) => {
			await applyPackageCleanup(drop);
			setRestartRequired(true);
			await Promise.all([catalog.refresh(), loadHealth()]);
		},
		[catalog.refresh, loadHealth],
	);
	const healthIssueCount = health ? countHealthIssues(health) : 0;

	// Core "Update All" stays clickable while operations run: the queue's
	// (source, action) dedupe makes a repeat click idempotent.
	const coreUpdateAllSpinning = updatableCore.some((p) => {
		const s = operations.statusFor(piCoreSource(p.name));
		return s === "running" || s === "queued";
	});

	// Move / Reset-to-npm bypass `packageQueue` and take the server busy lock directly,
	// so they are the ONLY controls gated on "any op running".
	const moveLocked = operations.isAnyRunning;
	const moveLockedReason = t(
		"packages.moveLockedWhileBusy",
		undefined,
		"Unavailable while a package operation is running — move and reset can't be queued yet",
	);

	const checkInFlightRef = useRef(false);
	const handleCheckUpdates = useCallback(
		async (opts: { silent?: boolean } = {}) => {
			if (checkInFlightRef.current) return;
			checkInFlightRef.current = true;
			if (!opts.silent) setCheckingUpdates(true);
			try {
				const res = await fetch(`${getApiBase()}/api/packages/check-updates`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "{}",
				});
				const body = await res.json();
				if (body.success) setUpdatesAvailable(new Set(body.data.map((u: { source: string }) => u.source)));
			} catch {
				/* swallow — next poll retries */
			}
			if (!opts.silent) setCheckingUpdates(false);
			checkInFlightRef.current = false;
			if (!opts.silent) void refresh(true).catch(logRejection("UnifiedPackagesSection.refresh"));
		},
		[refresh],
	);

	// Auto-check for updates: once after the catalog resolves, every 30 min, and after
	// every successful package operation (mirrors pi's startup check).
	// See change: improve-pi-update-detection.
	const initialCheckFiredRef = useRef(false);
	const hasPackages = catalog.features.some((f) => f.packages.length > 0);
	useEffect(() => {
		if (initialCheckFiredRef.current) return;
		if (catalog.isLoading || !hasPackages) return;
		initialCheckFiredRef.current = true;
		void handleCheckUpdates({ silent: true }).catch(logRejection("UnifiedPackagesSection.initialCheck"));
	}, [catalog.isLoading, hasPackages, handleCheckUpdates]);
	useEffect(() => {
		const id = setInterval(() => {
			void handleCheckUpdates({ silent: true }).catch(logRejection("UnifiedPackagesSection.poll"));
		}, 30 * 60 * 1000);
		return () => clearInterval(id);
	}, [handleCheckUpdates]);
	useEffect(() => {
		const handler = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "package_operation_complete" && msg.success) {
				void handleCheckUpdates({ silent: true }).catch(logRejection("UnifiedPackagesSection.packageEvent"));
			}
		};
		window.addEventListener("pi-package-event", handler);
		return () => window.removeEventListener("pi-package-event", handler);
	}, [handleCheckUpdates]);

	// The installed filter's "search npm" link moves the query to the Discover tab.
	useEffect(() => {
		const onHandoff = (e: Event) => {
			if (tab === "discover") return;
			const detail = (e as CustomEvent).detail;
			setTab("discover");
			setTimeout(() => window.dispatchEvent(new CustomEvent(ADDONS_NPM_SEARCH_EVENT, { detail })), 0);
		};
		window.addEventListener(ADDONS_NPM_SEARCH_EVENT, onHandoff);
		return () => window.removeEventListener(ADDONS_NPM_SEARCH_EVENT, onHandoff);
	}, [tab, setTab]);

	// ── Derived lists ──
	// `core:pi` is the pi core rows above (their own queue-driven state); every other
	// feature renders as an `AddonFeatureRow`.
	const rowFeatures = useMemo(() => catalog.features.filter((f) => f.id !== "core:pi"), [catalog.features]);
	const localFeatureCount = useMemo(() => rowFeatures.filter(isLocalSourceFeature).length, [rowFeatures]);
	const filtering = isAddonFilterActive(filter);
	const shown = useMemo(() => filterFeatures(rowFeatures, filter), [rowFeatures, filter]);
	const groups = useMemo(() => groupFeatures(shown, grouping), [shown, grouping]);
	const counts = useMemo(() => originCounts(catalog.features), [catalog.features]);
	const updateCount = useMemo(
		() => updatableParts(catalog.features, updatesAvailable).length + updatableCore.length,
		[catalog.features, updatesAvailable, updatableCore.length],
	);
	const hubOffSources = useMemo(
		() => catalog.features.flatMap((f) => f.packages.filter((p) => p.entryOff).map((p) => p.source)),
		[catalog.features],
	);
	const featureName = useCallback((id: string) => toggle.byId.get(id)?.displayName ?? id, [toggle.byId]);

	// Core pi rows under a filter: only the text filter can match them, any chip hides them.
	const chipActive = filter.localOnly || filter.fromDashboard || filter.community || filter.hasDashboardUi || filter.agentOnly || filter.disabled;
	const visibleCore = useMemo(() => {
		if (!filtering) return corePackages;
		if (chipActive) return [];
		const needle = filter.text.trim().toLowerCase();
		return corePackages.filter((p) => p.displayName.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle));
	}, [filtering, chipActive, corePackages, filter.text]);
	const coreRowsShown = !hideCoreGroup && grouping === "kind" && (!filtering || visibleCore.length > 0);
	const nothingMatches =
		filtering && shown.length === 0 && (hideCoreGroup || grouping !== "kind" || visibleCore.length === 0);

	// ── Row builders ──
	const buildPartRowProps = (f: AddonFeature, p: AddonPackagePart): PackageRowProps => {
		const opStatus = operations.statusFor(p.source);
		const moveState = operations.moveStateFor(p.source);
		const busy = operations.runningSource === p.source || moveState?.phase === "running";
		const changelogPkg = npmNameFromSource(p.source);
		return {
			displayName: partDisplayName(f, p),
			source: p.source,
			sourceType: classifySource(p.source),
			currentVersion: p.version,
			updateAvailable: updatesAvailable.has(p.source),
			busy,
			queued: opStatus === "queued",
			locked: moveLocked,
			lockedReason: moveLockedReason,
			progress: moveState?.phase === "running" ? moveState.message : busy ? operations.messageFor(p.source) : undefined,
			error: moveState?.phase === "error" ? moveState.message : opStatus === "error" ? operations.messageFor(p.source) : undefined,
			canUpdate: true,
			canUninstall: false,
			onUpdate: () => operations.update(p.source),
			onViewReadme: changelogPkg ? () => setReadmePkg({ name: changelogPkg } as NpmPackageResult) : undefined,
			testId: `pkg-row-${p.source.replace(/[^a-z0-9]/gi, "-")}`,
		};
	};

	const renderPartUpdateRow = ({ feature, part }: UpdatablePart) => {
		const rowProps = buildPartRowProps(feature, part);
		return (
			<WhatsNewPackageRow
				rowProps={rowProps}
				changelogPkg={npmNameFromSource(part.source)}
				currentVersion={part.version}
				enabled
				dialogDisplayName={rowProps.displayName}
				onUpdate={() => operations.update(part.source)}
			/>
		);
	};

	const renderCoreRow = (pkg: PiCorePackage) => {
		const isPi = pkg.name === PI_CORE_PKG;
		const opSource = piCoreSource(pkg.name);
		const busy = operations.runningSource === opSource;
		const opStatus = operations.statusFor(opSource);
		return (
			<PackageRow
				key={pkg.name}
				displayName={pkg.displayName}
				source={pkg.name}
				sourceType={pkg.installSource === "managed" ? "local" : "global"}
				currentVersion={pkg.currentVersion}
				latestVersion={pkg.latestVersion}
				updateAvailable={pkg.updateAvailable}
				busy={busy}
				queued={opStatus === "queued"}
				progress={busy ? operations.operation.message : undefined}
				error={opStatus === "error" ? operations.messageFor(opSource) : undefined}
				canUpdate={true}
				canUninstall={false}
				onUpdate={() => operations.coreUpdate(pkg.name)}
				breakingChangeCount={isPi ? piBreakingCount : undefined}
				whatsNewKind={isPi ? piWhatsNewKind : undefined}
				onShowWhatsNew={isPi && piWhatsNewKind ? () => setWhatsNewOpen(true) : undefined}
				testId={`pi-core-row-${pkg.name}`}
			/>
		);
	};

	const renderFeatureRow = (f: AddonFeature) => {
		const moveStates = f.packages.map((p) => operations.moveStateFor(p.source)).filter(Boolean);
		return (
			<div key={f.id}>
				<AddonFeatureRow
					feature={f}
					updates={updatesAvailable}
					statusFor={operations.statusFor}
					toggling={toggle.busyId === f.id}
					error={toggle.rowError?.featureId === f.id ? toggle.rowError.message : undefined}
					locked={moveLocked}
					lockedReason={moveLockedReason}
					onToggle={() => void toggle.request(f)}
					onUpdate={(source) => operations.update(source)}
					onUninstall={(source) => operations.remove(source)}
					onMove={(source) => setMovePickerSource(source)}
					onResetToPublished={(source) => operations.resetToNpm(source, { scope: "global" })}
					onViewReadme={(name) => setReadmePkg({ name } as NpmPackageResult)}
					onOpenSettings={(pluginId) => navigate(`/settings/plugins/${pluginId}`)}
					featureName={featureName}
				/>
				{moveStates.map(
					(ms) =>
						ms?.phase === "partial-success" && (
							<PackagePartialSuccessBanner
								key={ms.moveId}
								state={ms}
								onCleanup={() => f.packages[0] && operations.remove(f.packages[0].source)}
								onDismiss={() => operations.clearMove(ms.moveId)}
							/>
						),
				)}
			</div>
		);
	};

	const tabLabel = (id: AddonsTab) => {
		switch (id) {
			case "installed":
				return t("addons.tab.installed", { count: rowFeatures.length }, `Installed (${rowFeatures.length})`);
			case "updates":
				return t("addons.tab.updates", { count: updateCount }, `Updates (${updateCount})`);
			case "discover":
				return t("addons.tab.discover", undefined, "Discover");
		}
	};

	return (
		<div>
			<h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)] flex items-center justify-between">
				<span>{t("addons.heading", undefined, "Add-ons")}</span>
				<div className="flex items-center gap-2">
					{healthIssueCount > 0 && (
						<span
							className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400"
							data-testid="pkg-health-badge"
						>
							{t("packages.health.issuesBadge", { count: healthIssueCount }, `Issues (${healthIssueCount})`)}
						</span>
					)}
					{status?.lastChecked && (
						<span className="text-[10px] font-normal text-[var(--text-muted)]">
							{t("settings.lastChecked", { time: relativeTime(status.lastChecked, t) }, `Last checked: ${relativeTime(status.lastChecked, t)}`)}
						</span>
					)}
					<button
						type="button"
						onClick={() => {
							void refresh(true).catch(logRejection("UnifiedPackagesSection.refresh"));
							void handleCheckUpdates().catch(logRejection("UnifiedPackagesSection.checkNow"));
						}}
						disabled={isLoading || checkingUpdates}
						className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)] disabled:opacity-50 flex items-center gap-1"
						data-testid="unified-pkg-check-now"
					>
						<Icon path={isLoading || checkingUpdates ? mdiLoading : mdiRefresh} size={0.5} spin={isLoading || checkingUpdates} className="fx-progress" />
						{isLoading || checkingUpdates ? t("common.checking", undefined, "Checking...") : t("common.checkNow", undefined, "Check Now")}
					</button>
				</div>
			</h2>

			<p className="text-xs text-[var(--text-tertiary)] mb-2">
				{t("addons.description", undefined, "Extensions, skills and plugins that your pi and this dashboard load.")}{" "}
				<button
					type="button"
					onClick={() => {
						setExplainerDismissed(false);
						setFocusExplainer((n) => n + 1);
					}}
					className="text-[var(--accent-primary)] hover:underline cursor-pointer"
					data-testid="addons-explainer-link"
				>
					{t("addons.explainerTitle", undefined, "What are extensions and plugins?")}
				</button>
			</p>

			<AddonsExplainer
				features={catalog.features}
				expanded={explainerExpanded}
				onToggle={() => setExplainerDismissed(explainerExpanded)}
				toggleRef={explainerToggleRef}
			/>

			{(error || catalog.error) && (
				<div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2">
					<Icon path={mdiAlertCircle} size={0.6} className="flex-shrink-0 mt-0.5" />
					<span>{error ?? catalog.error}</span>
				</div>
			)}

			{restartRequired && (
				<div
					className="mb-2 p-2 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs"
					role="status"
					data-testid="pkg-health-restart-banner"
				>
					{t("packages.health.restartRequired", undefined, "Restart required for package changes to take effect.")}
				</div>
			)}
			{health && (
				<PackageHealthPanel
					report={health}
					onApply={applyHealthCleanup}
					onRefresh={() => loadHealth().catch(logRejection("UnifiedPackagesSection.healthRefresh"))}
				/>
			)}

			<div role="tablist" aria-label={t("addons.heading", undefined, "Add-ons")} className="flex gap-1 mb-3 border-b border-[var(--border-secondary)]" data-testid="addons-tabs">
				{TABS.map((id) => (
					<button
						key={id}
						type="button"
						role="tab"
						id={`addons-tab-${id}`}
						aria-selected={tab === id}
						aria-controls={`addons-panel-${id}`}
						onClick={() => setTab(id)}
						data-testid={`addons-tab-${id}`}
						className={`text-xs px-3 py-1.5 -mb-px border-b-2 cursor-pointer ${
							tab === id
								? "border-[var(--accent-primary)] text-[var(--text-primary)]"
								: "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						}`}
					>
						{tabLabel(id)}
					</button>
				))}
			</div>

			{/* ── Installed ───────────────────────────────────────────── */}
			{tab === "installed" && (
				<div role="tabpanel" id="addons-panel-installed" aria-labelledby="addons-tab-installed">
					{toggle.reloadOffered && <AddonReloadBanner onDismiss={toggle.dismissReload} />}
					{toggle.pending && (
						<AddonToggleConfirm pending={toggle.pending} byId={toggle.byId} onConfirm={() => void toggle.confirm()} onCancel={toggle.cancel} />
					)}

					{localFeatureCount > 0 && (
						<div
							className="mb-2 p-2 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] flex items-center justify-between gap-2"
							data-testid="addons-local-banner"
						>
							<span>
								{t(
									"addons.localBanner",
									{ count: localFeatureCount },
									`${localFeatureCount} add-ons run from local source instead of a published version.`,
								)}
							</span>
							<button
								type="button"
								onClick={() => setFilter({ ...EMPTY_ADDON_FILTER, localOnly: true })}
								className="text-[var(--accent-primary)] hover:underline cursor-pointer shrink-0"
								data-testid="addons-local-banner-show"
							>
								{t("addons.show", undefined, "Show")}
							</button>
						</div>
					)}

					<div className="flex items-center gap-2 flex-wrap mb-2 text-[11px] text-[var(--text-muted)]" data-testid="addons-delivered-by">
						<span>{t("addons.deliveredBy", undefined, "Delivered by")}</span>
						{(["first-party", "mixed", "community", "upstream"] as const).map((o) => (
							<span key={o} className="px-1.5 py-0.5 rounded border border-[var(--border-secondary)]" data-testid={`addons-delivered-${o}`}>
								{originStripLabel(o)}{" "}
								<span className="text-[var(--text-primary)]">{counts[o]}</span>
							</span>
						))}
						<label className="ml-auto flex items-center gap-1">
							<span>{t("addons.groupBy", undefined, "Group by")}</span>
							<select
								value={grouping}
								onChange={(e) => setGrouping(e.target.value as AddonGrouping)}
								className="text-xs bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded px-1 py-0.5 text-[var(--text-primary)]"
								data-testid="addons-group-by"
							>
								<option value="kind">{t("addons.groupKind", undefined, "by kind")}</option>
								<option value="origin">{t("addons.groupOrigin", undefined, "by who delivers it")}</option>
								<option value="source">{t("addons.groupSource", undefined, "by install source")}</option>
								<option value="az">{t("addons.groupAz", undefined, "A–Z")}</option>
							</select>
						</label>
					</div>

					<div className="flex items-center gap-2 flex-wrap mb-3" data-testid="addons-filter">
						<input
							type="search"
							value={filter.text}
							onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
							placeholder={t("addons.filterPlaceholder", undefined, "Filter installed add-ons")}
							aria-label={t("addons.filterPlaceholder", undefined, "Filter installed add-ons")}
							className="flex-1 min-w-[10rem] px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
							data-testid="addons-filter-input"
						/>
						<FilterChip pressed={filter.localOnly} onClick={() => setFilter((f) => ({ ...f, localOnly: !f.localOnly }))} testId="addons-chip-local">
							{t("addons.chipLocal", undefined, "Local source")}
						</FilterChip>
						<FilterChip pressed={filter.fromDashboard} onClick={() => setFilter((f) => ({ ...f, fromDashboard: !f.fromDashboard }))} testId="addons-chip-from-dashboard">
							{t("addons.chipFromDashboard", undefined, "From pi-dashboard")}
						</FilterChip>
						<FilterChip pressed={filter.community} onClick={() => setFilter((f) => ({ ...f, community: !f.community }))} testId="addons-chip-community">
							{t("addons.chipCommunity", undefined, "Community")}
						</FilterChip>
						<FilterChip pressed={filter.hasDashboardUi} onClick={() => setFilter((f) => ({ ...f, hasDashboardUi: !f.hasDashboardUi }))} testId="addons-chip-dashboard-ui">
							{t("addons.chipDashboardUi", undefined, "Has dashboard UI")}
						</FilterChip>
						<FilterChip pressed={filter.agentOnly} onClick={() => setFilter((f) => ({ ...f, agentOnly: !f.agentOnly }))} testId="addons-chip-agent-only">
							{t("addons.chipAgentOnly", undefined, "Agent only")}
						</FilterChip>
						<FilterChip pressed={filter.disabled} onClick={() => setFilter((f) => ({ ...f, disabled: !f.disabled }))} testId="addons-chip-disabled">
							{t("addons.chipDisabled", undefined, "Disabled")}
						</FilterChip>
					</div>

					{nothingMatches && (
						<div className="mb-3 text-xs text-[var(--text-muted)]" data-testid="addons-no-match">
							<span>{t("addons.noMatch", undefined, "Nothing matches your filter.")}</span>{" "}
							{filter.text.trim() !== "" && (
								<button
									type="button"
									onClick={() => window.dispatchEvent(new CustomEvent(ADDONS_NPM_SEARCH_EVENT, { detail: { query: filter.text.trim() } }))}
									className="text-[var(--accent-primary)] hover:underline cursor-pointer"
									data-testid="addons-npm-search-link"
								>
									{t("addons.searchNpm", { query: filter.text.trim() }, `Search npm for "${filter.text.trim()}"`)}
								</button>
							)}
						</div>
					)}

					{/* pi core rows stay at the top of the "Core" group (by kind). */}
					{coreRowsShown && (
						<>
							<SubGroupHeader title={t("addons.group.core", undefined, "Core")} />
							{corePackages.length === 0 ? (
								<EmptyHint>{t("settings.noCorePackages", undefined, "No pi ecosystem core packages detected.")}</EmptyHint>
							) : (
								<>
									{updatableCore.length > 1 && (
										<div className="mb-2">
											<button
												type="button"
												onClick={() => updatableCore.forEach((p) => operations.coreUpdate(p.name))}
												className="text-xs px-3 py-1 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50 flex items-center gap-1"
												data-testid="pi-core-update-all"
											>
												<Icon path={coreUpdateAllSpinning ? mdiLoading : mdiArrowUpBold} size={0.55} spin={coreUpdateAllSpinning} className="fx-progress" />
												{t("common.updateAll", { count: updatableCore.length }, `Update All (${updatableCore.length})`)}
											</button>
										</div>
									)}
									<div className="space-y-1 mb-2">{visibleCore.map(renderCoreRow)}</div>
								</>
							)}
						</>
					)}

					{groups.map((g) => {
						const isCore = grouping === "kind" && g.key === "core";
						// The Core group heading is already rendered with the pi core rows.
						if (g.features.length === 0 && (filtering || isCore)) return null;
						return (
							<div key={g.key} data-testid={`addons-group-${g.key}`}>
								{g.heading && !(isCore && coreRowsShown) && <SubGroupHeader title={g.heading} />}
								{g.features.length === 0 ? (
									<EmptyHint>{t("addons.group.empty", undefined, "Nothing here yet.")}</EmptyHint>
								) : (
									<div className="space-y-1 mb-3">{g.features.map(renderFeatureRow)}</div>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* ── Updates ─────────────────────────────────────────────── */}
			{tab === "updates" && (
				<div role="tabpanel" id="addons-panel-updates" aria-labelledby="addons-tab-updates">
					<AddonsUpdatesTab
						features={catalog.features}
						updates={updatesAvailable}
						corePackages={hideCoreGroup ? [] : corePackages}
						statusFor={operations.statusFor}
						coreSource={piCoreSource}
						onUpdatePart={(source) => operations.update(source)}
						onUpdateCore={(name) => operations.coreUpdate(name)}
						renderPartRow={renderPartUpdateRow}
						renderCoreRow={renderCoreRow}
					/>
				</div>
			)}

			{/* ── Discover ────────────────────────────────────────────── */}
			{tab === "discover" && (
				<div role="tabpanel" id="addons-panel-discover" aria-labelledby="addons-tab-discover">
					<AddonsDiscoverTab hubOffSources={hubOffSources} />
				</div>
			)}

			{readmePkg && (
				<PackageReadmeDialog
					pkg={readmePkg}
					installed={catalog.features.some((f) => f.packages.some((p) => p.source === `npm:${readmePkg.name}`))}
					onInstall={() => {
						operations.install(`npm:${readmePkg.name}`);
						setReadmePkg(null);
					}}
					onUninstall={() => {
						operations.remove(`npm:${readmePkg.name}`);
						setReadmePkg(null);
					}}
					onClose={() => setReadmePkg(null)}
				/>
			)}
			{movePickerSource && (
				<PinDirectoryDialog
					onPin={(targetCwd) => {
						const src = movePickerSource;
						setMovePickerSource(null);
						void operations
							.move(src, { fromScope: "global", toScope: "local", toCwd: targetCwd })
							.catch(logRejection("UnifiedPackagesSection.move"));
					}}
					onCancel={() => setMovePickerSource(null)}
				/>
			)}
			{whatsNewOpen && piChangelog.data && piPkg && (
				<WhatsNewDialog
					open={whatsNewOpen}
					response={piChangelog.data}
					displayName={piPkg.displayName}
					latestVersion={piPkg.latestVersion ?? piChangelog.data.to}
					onClose={() => setWhatsNewOpen(false)}
					onUpdate={() => operations.coreUpdate(piPkg?.name ?? PI_CORE_PKG)}
				/>
			)}
		</div>
	);
}

function SubGroupHeader({ title, right }: { title: string; right?: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between mt-2 mb-1.5">
			<h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">{title}</h3>
			{right}
		</div>
	);
}

function FilterChip({
	pressed,
	onClick,
	testId,
	children,
}: {
	pressed: boolean;
	onClick: () => void;
	testId: string;
	children: React.ReactNode;
}) {
	const id = useId();
	return (
		<button
			id={id}
			type="button"
			aria-pressed={pressed}
			onClick={onClick}
			className={`text-xs px-2 py-1 rounded border cursor-pointer ${
				pressed
					? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/15 text-[var(--text-primary)]"
					: "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
			}`}
			data-testid={testId}
		>
			{children}
		</button>
	);
}

function EmptyHint({ children }: { children: React.ReactNode }) {
	return <p className="text-xs text-[var(--text-muted)] italic mb-3">{children}</p>;
}
