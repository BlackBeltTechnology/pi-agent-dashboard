/**
 * Unified Settings → Packages section. Renders a single "Pi Ecosystem"
 * header followed by three sub-groups (Core / Recommended Extensions /
 * Other Packages), each using the same `<PackageRow>` component.
 *
 * Replaces the two prior sibling sections (`PiCoreVersionsSection` and
 * the inline "Installed Global Packages" block in `SettingsPanel.tsx`).
 *
 * Core in-flight state is NOT component-local: pi-core updates ride the
 * singleton `packageQueue` (keyed `pi-core:<scoped-name>`) so a spinner
 * survives this component unmounting. See change:
 * unify-pi-core-into-package-queue.
 *
 * See change: consolidate-packages-settings-ui.
 */

import type {
	InstalledPackage,NpmPackageResult, 
	PiCorePackage
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
	mdiAlertCircle,
	mdiArrowUpBold,
	mdiLoading,
	mdiRefresh,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInstalledPackages } from "../../hooks/useInstalledPackages.js";
import { useLaunchSource } from "../../hooks/useLaunchSource.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { usePiChangelog } from "../../hooks/usePiChangelog.js";
import { usePiCoreVersions } from "../../hooks/usePiCoreVersions.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import {
	classifySource,
	groupInstalledPackages,
	isSourceOverride,
} from "../../lib/package/package-classifier.js";
import { piCoreSource } from "../../lib/package/package-queue.js";
import { PackagePartialSuccessBanner } from "./PackagePartialSuccessBanner.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";
import { PackageRow, type PackageRowProps } from "./PackageRow.js";
import { PinDirectoryDialog } from "../workspace/PinDirectoryDialog.js";
import { WhatsNewDialog } from "./WhatsNewDialog.js";
import { WhatsNewPackageRow } from "./WhatsNewPackageRow.js";

/** Single core package the breaking-change icon is wired for. v1 scope. */
const PI_CORE_PKG = "@earendil-works/pi-coding-agent";
/** Legacy pre-rename scope, still accepted so installs on the old name keep the icon. */
const PI_CORE_PKG_LEGACY = "@mariozechner/pi-coding-agent";
const isPiCorePkg = (name: string): boolean =>
	name === PI_CORE_PKG || name === PI_CORE_PKG_LEGACY;

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
	if (isNaN(then)) return iso;
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

export function UnifiedPackagesSection() {
	const { t } = useI18n();
	// launchSource gates the Core sub-group. Under Electron, bundled
	// node_modules/ is read-only — pi-version upgrades flow via
	// electron-updater whole-app replacement. Recommended Extensions +
	// Other Packages still render in all arms.
	// See change: eliminate-electron-runtime-install (task 3.3).
	const launchSource = useLaunchSource();
	const hideCoreGroup = launchSource === "electron";

	// ── Core data (Pi Ecosystem core: pi, pi-dashboard, pi-model-proxy) ──
	const { status, isLoading, error, refresh } = usePiCoreVersions();

	// Live tick for "last checked N min ago"
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((n) => n + 1), 30_000);
		return () => clearInterval(id);
	}, []);

	const corePackages: PiCorePackage[] = status?.packages ?? [];
	const updatableCore = useMemo(
		() => corePackages.filter((p) => p.updateAvailable),
		[corePackages],
	);

	// ── pi changelog (breaking-change icon + WhatsNewDialog) ──────────────
	// Only fetched for pi-coding-agent when it has an update available.
	// See change: pi-update-whats-new-panel.
	const piPkg = useMemo(
		() => corePackages.find((p) => isPiCorePkg(p.name)),
		[corePackages],
	);
	const piChangelogEnabled =
		!!piPkg && !!piPkg.updateAvailable && !!piPkg.latestVersion && piPkg.latestVersion !== piPkg.currentVersion;
	const piChangelog = usePiChangelog(
		piPkg?.name ?? PI_CORE_PKG,
		piPkg?.currentVersion,
		piPkg?.latestVersion ?? undefined,
		{ enabled: piChangelogEnabled },
	);
	const piBreakingCount = useMemo(() => {
		if (!piChangelog.data || !piChangelog.data.hasBreaking) return 0;
		return piChangelog.data.releases.reduce((s, r) => s + r.breaking.length, 0);
	}, [piChangelog.data]);
	// Drive the icon's visual state from the changelog response. See
	// change: improve-pi-update-detection.
	const piWhatsNewKind = useMemo<"breaking" | "info" | undefined>(() => {
		if (!piChangelog.data) return undefined;
		if (piChangelog.data.hasBreaking) return "breaking";
		if (piChangelog.data.releases.length > 0) return "info";
		return undefined;
	}, [piChangelog.data]);
	const [whatsNewOpen, setWhatsNewOpen] = useState(false);

	// ── Installed-packages data (recommended + other) ─────────────────────
	const installed = useInstalledPackages("global");
	const operations = usePackageOperations("global", undefined, installed.refresh);
	const [updatesAvailable, setUpdatesAvailable] = useState<Set<string>>(new Set());
	const [checkingUpdates, setCheckingUpdates] = useState(false);
	const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);
	const [movePickerSource, setMovePickerSource] = useState<string | null>(null);

	// Core "Update All" gating. `queueBusy` covers the running op plus
	// anything still waiting in the FIFO, so a second click can't stack a
	// duplicate batch on top of an in-flight one.
	const queueBusy = operations.queueDepth + (operations.runningSource ? 1 : 0) > 0;
	const coreUpdateAllSpinning =
		queueBusy &&
		updatableCore.some((p) => {
			const s = operations.statusFor(piCoreSource(p.name));
			return s === "running" || s === "queued";
		});

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
				if (body.success) {
					setUpdatesAvailable(new Set(body.data.map((u: any) => u.source)));
				}
			} catch {
				/* swallow — next poll retries */
			}
			if (!opts.silent) setCheckingUpdates(false);
			checkInFlightRef.current = false;
			// Also refresh Core data when this is a manual check; auto-checks
			// don't disturb usePiCoreVersions' own polling.
			if (!opts.silent) refresh(true);
		},
		[refresh],
	);

	// Auto-check installed packages for updates: fires once after the
	// installed list resolves, then every 30 min, and after every
	// successful package operation. Mirrors pi's interactive-TUI startup
	// behaviour (`packageManager.checkForAvailableUpdates()`). See change:
	// improve-pi-update-detection.
	const initialCheckFiredRef = useRef(false);
	useEffect(() => {
		if (initialCheckFiredRef.current) return;
		if (installed.isLoading) return;
		if (installed.packages.length === 0) return;
		initialCheckFiredRef.current = true;
		handleCheckUpdates({ silent: true });
	}, [installed.isLoading, installed.packages.length, handleCheckUpdates]);

	// 30-minute poll while mounted.
	useEffect(() => {
		const id = setInterval(() => {
			handleCheckUpdates({ silent: true });
		}, 30 * 60 * 1000);
		return () => clearInterval(id);
	}, [handleCheckUpdates]);

	// Re-fire after every successful package operation. The dispatch
	// shape comes from useMessageHandler's `pi-package-event` CustomEvent.
	useEffect(() => {
		const handler = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "package_operation_complete" && msg.success) {
				handleCheckUpdates({ silent: true });
			}
		};
		window.addEventListener("pi-package-event", handler);
		return () => window.removeEventListener("pi-package-event", handler);
	}, [handleCheckUpdates]);

	// Group installed rows: Core whitelist members are dropped (Core wins).
	const coreNpmNames = useMemo(() => corePackages.map((p) => p.name), [corePackages]);
	const { recommended, other } = useMemo(
		() => groupInstalledPackages(installed.packages, coreNpmNames),
		[installed.packages, coreNpmNames],
	);

	const renderInstalledRow = (pkg: InstalledPackage) => {
		const opSource = pkg.source;
		const busy = operations.runningSource === opSource;
		const opStatus = operations.statusFor(opSource);
		const opMessage = operations.messageFor(opSource);
		const moveState = operations.moveStateFor(opSource);
		const rowBusy = busy || moveState?.phase === "running";
		const rowProgress = moveState?.phase === "running"
			? moveState.message
			: busy ? opMessage : undefined;
		const rowError = moveState?.phase === "error"
			? moveState.message
			: opStatus === "error" ? opMessage : undefined;
		const hasUpdate = updatesAvailable.has(pkg.source);
		const changelogPkg = npmNameFromSource(pkg.source);
		const rowProps: PackageRowProps = {
			displayName: pkg.displayName ?? pkg.source,
			source: pkg.source,
			sourceType: classifySource(pkg.source),
			isBundled: !!pkg.isBundled,
			currentVersion: pkg.version,
			updateAvailable: hasUpdate,
			busy: rowBusy,
			progress: rowProgress,
			error: rowError,
			isOverride: isSourceOverride(pkg),
			canUpdate: true,
			canUninstall: true,
			onUpdate: () => operations.update(pkg.source),
			onUninstall: () => operations.remove(pkg.source),
			onViewReadme: changelogPkg
				? () => setReadmePkg({ name: changelogPkg } as any)
				: undefined,
			onMove: () => setMovePickerSource(pkg.source),
			publishedVariantSource: pkg.publishedVariantSource,
			publishedVariantVersion: pkg.publishedVariantVersion,
			onResetToNpm: pkg.publishedVariantSource
				? () => operations.resetToNpm(pkg.source, { scope: "global" })
				: undefined,
			currentScope: "global",
			testId: `pkg-row-${pkg.source.replace(/[^a-z0-9]/gi, "-")}`,
		};
		return (
			<div key={pkg.source}>
				<WhatsNewPackageRow
					rowProps={rowProps}
					changelogPkg={changelogPkg}
					currentVersion={pkg.version}
					enabled={hasUpdate}
					dialogDisplayName={pkg.displayName ?? pkg.source}
					onUpdate={() => operations.update(pkg.source)}
				/>
				{moveState?.phase === "partial-success" && (
					<PackagePartialSuccessBanner
						state={moveState}
						onCleanup={() => operations.remove(pkg.source)}
						onDismiss={() => operations.clearMove(moveState.moveId)}
					/>
				)}
			</div>
		);
	};

	return (
		<div>
			<h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)] flex items-center justify-between">
				<span>{t("settings.piEcosystem", undefined, "Pi Ecosystem")}</span>
				<div className="flex items-center gap-2">
					{status?.lastChecked && (
						<span className="text-[10px] font-normal text-[var(--text-muted)]">
								{t("settings.lastChecked", { time: relativeTime(status.lastChecked, t) }, `Last checked: ${relativeTime(status.lastChecked, t)}`)}
						</span>
					)}
					<button
						onClick={() => {
							refresh(true);
							handleCheckUpdates();
						}}
						disabled={isLoading || checkingUpdates}
						className="text-xs px-2 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)] disabled:opacity-50 flex items-center gap-1"
						data-testid="unified-pkg-check-now"
					>
						<Icon path={isLoading || checkingUpdates ? mdiLoading : mdiRefresh} size={0.5} spin={isLoading || checkingUpdates} />
							{isLoading || checkingUpdates ? t("common.checking", undefined, "Checking...") : t("common.checkNow", undefined, "Check Now")}
					</button>
				</div>
			</h2>

			<p className="text-xs text-[var(--text-tertiary)] mb-3">
					{t("settings.piEcosystemDescription", undefined, "Pi tooling, recommended extensions, and any other packages your pi loads.")}
			</p>

			{error && (
				<div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2">
					<Icon path={mdiAlertCircle} size={0.6} className="flex-shrink-0 mt-0.5" />
					<span>{error}</span>
				</div>
			)}

			{/* ── Core sub-group ─────────────────────────────────────────── */}
			{!hideCoreGroup && <SubGroupHeader title={t("settings.core", undefined, "Core")} />}
			{!hideCoreGroup && (corePackages.length === 0 ? (
				<EmptyHint>{t("settings.noCorePackages", undefined, "No pi ecosystem core packages detected.")}</EmptyHint>
			) : (
				<>
					{updatableCore.length > 1 && (
						<div className="mb-2">
							<button
								onClick={() => updatableCore.forEach((p) => operations.coreUpdate(p.name))}
								disabled={queueBusy || updatableCore.length === 0}
								className="text-xs px-3 py-1 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50 flex items-center gap-1"
								data-testid="pi-core-update-all"
							>
								<Icon path={coreUpdateAllSpinning ? mdiLoading : mdiArrowUpBold} size={0.55} spin={coreUpdateAllSpinning} />
									{t("common.updateAll", { count: updatableCore.length }, `Update All (${updatableCore.length})`)}
							</button>
						</div>
					)}
					<div className="space-y-1 mb-4">
						{corePackages.map((pkg) => {
							const isPi = isPiCorePkg(pkg.name);
							const opSource = piCoreSource(pkg.name);
							const busy = operations.runningSource === opSource;
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
									progress={busy ? operations.operation.message : undefined}
									error={operations.statusFor(opSource) === "error" ? operations.messageFor(opSource) : undefined}
									canUpdate={true}
									canUninstall={false}
									onUpdate={() => operations.coreUpdate(pkg.name)}
									breakingChangeCount={isPi ? piBreakingCount : undefined}
									whatsNewKind={isPi ? piWhatsNewKind : undefined}
									onShowWhatsNew={isPi && piWhatsNewKind ? () => setWhatsNewOpen(true) : undefined}
									testId={`pi-core-row-${pkg.name}`}
								/>
							);
						})}
					</div>
				</>
			))}

			{/* ── Recommended Extensions sub-group ───────────────────────── */}
			<SubGroupHeader title={t("settings.recommendedExtensions", undefined, "Recommended Extensions")} />
			{recommended.length === 0 ? (
				<EmptyHint>{t("settings.noRecommendedExtensions", undefined, "No recommended extensions installed.")}</EmptyHint>
			) : (
				<div className="space-y-1 mb-4">{recommended.map(renderInstalledRow)}</div>
			)}

			{/* ── Other Packages sub-group ───────────────────────────────── */}
			<SubGroupHeader title={t("settings.otherPackages", undefined, "Other Packages")} />
			{other.length === 0 ? (
				<EmptyHint>{t("settings.otherPackagesHint", undefined, "Locally-developed and user-added packages will appear here.")}</EmptyHint>
			) : (
				<div className="space-y-1 mb-2">{other.map(renderInstalledRow)}</div>
			)}

			{readmePkg && (
				<PackageReadmeDialog
					pkg={readmePkg}
					installed={installed.packages.some((p) => p.source === `npm:${readmePkg.name}`)}
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
						operations.move(src, {
							fromScope: "global",
							toScope: "local",
							toCwd: targetCwd,
						});
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
			<h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
				{title}
			</h3>
			{right}
		</div>
	);
}

function EmptyHint({ children }: { children: React.ReactNode }) {
	return (
		<p className="text-xs text-[var(--text-muted)] italic mb-3">{children}</p>
	);
}
