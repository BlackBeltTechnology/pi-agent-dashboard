/**
 * Shared rich-row list of installed packages, used in two places:
 *
 *   - Settings → Packages (scope=global, no cwd)
 *   - Pi Resources → Installed (scope=local|global, cwd from view)
 *
 * Each row is a `<PackageRow>` with version / update / uninstall /
 * view-readme / move actions. Rows expose a chevron that, when expanded,
 * shows the contained skills / extensions / prompts contributed by the
 * package (data threaded in via the `containedResources` prop — the
 * caller fetches once for its scope and passes the relevant slice in).
 *
 * Move semantics:
 *   - From a `local` list  → Move → Global  (no further input).
 *   - From a `global` list → Move → Local   (caller resolves the cwd:
 *     either from the surface, or via a folder-picker dialog opened
 *     by the `onResolveLocalCwd` callback).
 *
 * See change: unify-package-management-ui.
 */
import React, { useMemo, useState, useCallback } from "react";
import { Icon } from "@mdi/react";
import {
	mdiAlertCircle,
	mdiBookOpenPageVariant,
	mdiChevronDown,
	mdiChevronRight,
	mdiCloseCircle,
	mdiPuzzleOutline,
	mdiTextBoxOutline,
} from "@mdi/js";
import { PackageRow } from "./PackageRow.js";
import { classifySource, isSourceOverride } from "../lib/package-classifier.js";
import { useInstalledPackages } from "../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../hooks/usePackageOperations.js";
import type {
	InstalledPackage,
	NpmPackageResult,
	PiPackageInfo,
	PiResource,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { computeDestIdentity } from "../lib/installed-list-helpers.js";
import { t as i18nT } from "../lib/i18n";

interface Props {
	scope: "global" | "local";
	cwd?: string;
	/**
	 * Optional pi-resources data (already fetched by the caller) keyed by
	 * source, used to populate the inline expand-tree of each row. When
	 * omitted, rows still expand but show "(no resource info)".
	 */
	containedResources?: Map<string, PiPackageInfo>;
	/** Other-scope packages list, used to disable Move when already at destination. */
	otherScopePackages?: readonly InstalledPackage[];
	/** Triggered when user clicks View README on a row. */
	onViewReadme?: (pkg: NpmPackageResult) => void;
	/**
	 * Resolve the destination cwd when initiating a Move → Local from a global row.
	 * Return undefined to cancel. Pi Resources contexts can return their fixed
	 * cwd; Settings should open `<PinDirectoryDialog>`.
	 */
	onResolveLocalCwd?: () => Promise<string | undefined>;
	/**
	 * Optional click handler for a contained resource leaf (skill/ext/prompt).
	 * Lets Pi Resources route to the file preview.
	 */
	onViewResource?: (resource: PiResource) => void;
	testId?: string;
}

export function InstalledPackagesList({
	scope,
	cwd,
	containedResources,
	otherScopePackages,
	onViewReadme,
	onResolveLocalCwd,
	onViewResource,
	testId,
}: Props) {
	const installed = useInstalledPackages(scope, cwd);
	const operations = usePackageOperations(scope, cwd, installed.refresh);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const otherIdentities = useMemo(() => {
		const set = new Set<string>();
		if (Array.isArray(otherScopePackages)) {
			for (const p of otherScopePackages) {
				set.add(computeDestIdentity(p.source));
			}
		}
		return set;
	}, [otherScopePackages]);

	const toggleExpanded = useCallback((source: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(source)) next.delete(source);
			else next.add(source);
			return next;
		});
	}, []);

	const handleMove = useCallback(
		async (pkg: InstalledPackage) => {
			let toCwd: string | undefined;
			const toScope: "global" | "local" = scope === "global" ? "local" : "global";

			if (toScope === "local") {
				if (onResolveLocalCwd) {
					toCwd = await onResolveLocalCwd();
				} else {
					toCwd = cwd; // surface-supplied (Pi Resources passes its cwd)
				}
				if (!toCwd) return; // user cancelled the picker
			}

			// Use the full installed entry — currently we only have `source`
			// from the InstalledPackage shape (filters are server-side data
			// not yet exposed); pass as bare string. Future enhancement:
			// expose the raw entry from /api/packages/installed so filters
			// survive moves initiated from the UI.
			await operations.move(pkg.source, {
				fromScope: scope,
				fromCwd: scope === "local" ? cwd : undefined,
				toScope,
				toCwd,
			});
		},
		[scope, cwd, onResolveLocalCwd, operations],
	);

	const safePackages: InstalledPackage[] = Array.isArray(installed.packages) ? installed.packages : [];
	if (installed.isLoading && safePackages.length === 0) {
		return (
			<div className="text-[11px] text-[var(--text-muted)] italic px-2 py-1" data-testid={testId}>
				{i18nT("auto.loading", undefined, "Loading…")}
			</div>
		);
	}
	if (installed.error) {
		return (
			<div className="text-[11px] text-red-400 px-2 py-1 flex items-center gap-1" data-testid={testId}>
				<Icon path={mdiAlertCircle} size={0.45} />
				<span>{installed.error}</span>
				<button onClick={installed.refresh} className="ml-auto text-[var(--accent-primary)] hover:underline">
					{i18nT("auto.retry", undefined, "Retry")}
				</button>
			</div>
		);
	}
	if (safePackages.length === 0) {
		return (
			<div className="text-[11px] text-[var(--text-muted)] italic px-2 py-1" data-testid={testId}>
				{i18nT("auto.no_packages_installed_at", undefined, "(no packages installed at")} {scope} scope)
			</div>
		);
	}

	return (
		<div className="space-y-1" data-testid={testId}>
			{safePackages.map((pkg) => {
				const moveState = operations.moveStateFor(pkg.source);
				const opStatus = operations.statusFor(pkg.source);
				const opMessage = operations.messageFor(pkg.source);
				const queueRunning = operations.runningSource === pkg.source;

				const alreadyAtDest = otherIdentities.has(computeDestIdentity(pkg.source));
				const moveLabel = scope === "global" ? "local" : "global";
				const moveDisabledReason = alreadyAtDest
					? `Already installed in ${moveLabel} scope`
					: undefined;

				const isExpanded = expanded.has(pkg.source);
				const containers = containedResources?.get(pkg.source);

				return (
					<div key={pkg.source}>
						<div className="flex items-start gap-1">
							<button
								onClick={() => toggleExpanded(pkg.source)}
								className="mt-1.5 p-0.5 rounded hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)]"
								aria-label={isExpanded ? "Collapse" : "Expand"}
								data-testid={`installed-pkg-expand-${pkg.source}`}
							>
								<Icon path={isExpanded ? mdiChevronDown : mdiChevronRight} size={0.5} />
							</button>
							<div className="flex-1 min-w-0">
								<PackageRow
									displayName={pkg.displayName ?? pkg.source}
									source={pkg.source}
									sourceType={classifySource(pkg.source)}
									isBundled={!!pkg.isBundled}
									isOverride={isSourceOverride(pkg)}
									currentVersion={pkg.version}
									updateAvailable={!!pkg.updateAvailable}
									busy={queueRunning || moveState?.phase === "running"}
									progress={
										moveState?.phase === "running"
											? moveState.message
											: queueRunning
												? opMessage
												: undefined
									}
									error={
										moveState?.phase === "error"
											? moveState.message
											: opStatus === "error"
												? opMessage
												: undefined
									}
									canUpdate={true}
									canUninstall={true}
									onUpdate={() => operations.update(pkg.source)}
									onUninstall={() => operations.remove(pkg.source)}
									onViewReadme={
										pkg.source.startsWith("npm:") && onViewReadme
											? () => {
													const name = pkg.source.slice(4).split("@")[0];
													onViewReadme({ name } as any);
												}
											: undefined
									}
									onMove={() => handleMove(pkg)}
									currentScope={scope}
									moveDisabledReason={moveDisabledReason}
									testId={`installed-pkg-row-${pkg.source.replace(/[^a-z0-9]/gi, "-")}`}
								/>
								{moveState?.phase === "partial-success" && (
									<PartialSuccessBanner
										state={moveState}
										onCleanup={() => operations.remove(pkg.source)}
										onDismiss={() => operations.clearMove(moveState.moveId)}
									/>
								)}
								{isExpanded && (
									<ContainedResourcesTree
										containers={containers}
										onViewResource={onViewResource}
									/>
								)}
							</div>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function ContainedResourcesTree({
	containers,
	onViewResource,
}: {
	containers?: PiPackageInfo;
	onViewResource?: (resource: PiResource) => void;
}) {
	if (!containers) {
		return (
			<div className="ml-4 mt-1 text-[10px] text-[var(--text-muted)] italic">
				{i18nT("auto.no_resource_info", undefined, "(no resource info)")}
			</div>
		);
	}
	const skills = containers.resources?.skills ?? [];
	const extensions = containers.resources?.extensions ?? [];
	const prompts = containers.resources?.prompts ?? [];
	const total = skills.length + extensions.length + prompts.length;
	if (total === 0) {
		return (
			<div className="ml-4 mt-1 text-[10px] text-[var(--text-muted)] italic">
				{i18nT("auto.no_resources", undefined, "(no resources)")}
			</div>
		);
	}
	return (
		<div className="ml-4 mt-1 mb-1 space-y-0.5" data-testid="installed-pkg-resources">
			{skills.map((r) => (
				<ResourceLeaf key={`skill-${r.filePath}`} resource={r} icon={mdiBookOpenPageVariant} onView={onViewResource} />
			))}
			{extensions.map((r) => (
				<ResourceLeaf key={`ext-${r.filePath}`} resource={r} icon={mdiPuzzleOutline} onView={onViewResource} />
			))}
			{prompts.map((r) => (
				<ResourceLeaf key={`prompt-${r.filePath}`} resource={r} icon={mdiTextBoxOutline} onView={onViewResource} />
			))}
		</div>
	);
}

function ResourceLeaf({
	resource,
	icon,
	onView,
}: {
	resource: PiResource;
	icon: string;
	onView?: (r: PiResource) => void;
}) {
	const clickable = !!onView;
	return (
		<div
			className={`flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded ${
				clickable ? "cursor-pointer hover:bg-[var(--bg-hover)]" : ""
			}`}
			onClick={clickable ? () => onView!(resource) : undefined}
			role={clickable ? "button" : undefined}
		>
			<Icon path={icon} size={0.4} className="text-[var(--text-tertiary)]" />
			<span className="text-[var(--text-secondary)] font-medium truncate">{resource.name}</span>
			{resource.description && (
				<span className="text-[var(--text-muted)] truncate">— {resource.description}</span>
			)}
		</div>
	);
}

function PartialSuccessBanner({
	state,
	onCleanup,
	onDismiss,
}: {
	state: { source: string; fromScope: "global" | "local"; message: string };
	onCleanup: () => void;
	onDismiss: () => void;
}) {
	return (
		<div
			className="mt-1 ml-2 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/5 text-[10px] flex items-start gap-2"
			data-testid="installed-pkg-partial-success"
		>
			<Icon path={mdiAlertCircle} size={0.45} className="text-amber-400 flex-shrink-0 mt-0.5" />
			<div className="flex-1 min-w-0">
				<div className="text-amber-400 font-medium">{i18nT("auto.move_partially_succeeded", undefined, "Move partially succeeded")}</div>
				<div className="text-[var(--text-muted)] truncate" title={state.message}>
					{i18nT("auto.installed_at_destination_but_failed_to", undefined, "Installed at destination but failed to remove from")} {state.fromScope}: {state.message}
				</div>
			</div>
			<button
				onClick={onCleanup}
				className="text-[var(--accent-primary)] hover:underline whitespace-nowrap"
			>
				{i18nT("auto.cleanup_origin", undefined, "Cleanup origin")}
			</button>
			<button
				onClick={onDismiss}
				className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
				aria-label={i18nT("auto.dismiss", undefined, "Dismiss")}
			>
				<Icon path={mdiCloseCircle} size={0.45} />
			</button>
		</div>
	);
}
