/**
 * Generic row component used by every group of the unified packages
 * Settings section (Core, Recommended Extensions, Other Packages).
 *
 * Visual language is derived from the original PiCoreVersionsSection
 * row (display name, source caption, badge, version pill, optional
 * Update). Generalized to take an optional kebab menu with Uninstall /
 * View README / Reset actions.
 *
 * See change: consolidate-packages-settings-ui.
 */
import React, { useEffect, useRef, useState } from "react";
import { Icon } from "@mdi/react";
import {
	mdiAlertCircle,
	mdiAlertCircleOutline,
	mdiArrowUpBold,
	mdiCheckCircle,
	mdiDotsVertical,
	mdiInformationOutline,
	mdiLoading,
	mdiSwapHorizontal,
} from "@mdi/js";
import type { SourceType } from "../lib/package-classifier.js";
import { usePopoverFlip } from "../hooks/usePopoverFlip.js";
import { t as i18nT } from "../lib/i18n";

export interface PackageRowProps {
	displayName: string;
	source: string;
	sourceType: SourceType;
	isBundled?: boolean;
	isDev?: boolean;
	/**
	 * True when the row is a source override: a recommended (npm-identity)
	 * package actually installed from a local/git checkout. Renders a compact
	 * `override` pill with an explanatory tooltip. Purely informational — does
	 * NOT gate or alter the Update affordance.
	 * See change: flag-package-source-overrides.
	 */
	isOverride?: boolean;
	currentVersion?: string;
	latestVersion?: string | null;
	updateAvailable?: boolean;
	busy?: boolean;
	progress?: string;
	error?: string;
	canUpdate?: boolean;
	canUninstall?: boolean;
	onUpdate?: () => void;
	onUninstall?: () => void;
	onViewReadme?: () => void;
	onReset?: () => void;
	/**
	 * Move → button. Caller supplies the destination scope this row
	 * should offer; the button label is computed from `currentScope`.
	 * When undefined, no Move button is rendered.
	 * See change: unify-package-management-ui.
	 */
	onMove?: () => void;
	/** The scope this row currently lives in. Used to label the Move button. */
	currentScope?: "global" | "local";
	/** Hint for the Move button label/tooltip. Defaults to the opposite of `currentScope`. */
	moveDestinationScope?: "global" | "local";
	/** When true, the Move button renders disabled with a tooltip. */
	moveDisabledReason?: string;
	/**
	 * Number of breaking changes between the row's currentVersion and
	 * latestVersion. Used for the breaking-state tooltip text. Hidden
	 * tooltip detail when undefined / 0.
	 * See change: pi-update-whats-new-panel.
	 */
	breakingChangeCount?: number;
	/**
	 * Drives the what's-new icon's visual state and visibility.
	 * - `"breaking"` — amber alert-circle, warning tooltip with count.
	 * - `"info"` — muted information-outline, neutral "View what's new" tooltip.
	 * - `undefined` — icon hidden.
	 * See change: improve-pi-update-detection.
	 */
	whatsNewKind?: "breaking" | "info";
	/**
	 * Click handler for the what's-new icon. Caller opens its
	 * `WhatsNewDialog` here. Required for the icon to render.
	 * See change: pi-update-whats-new-panel.
	 */
	onShowWhatsNew?: () => void;
	testId?: string;
}

const SOURCE_BADGE_STYLE: Record<SourceType, string> = {
	npm: "border-[var(--border-secondary)] text-[var(--text-muted)]",
	git: "border-purple-500/40 text-purple-400",
	local: "border-teal-500/40 text-teal-400",
	global: "border-blue-500/40 text-blue-400",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return (
		<span
			className={`text-[10px] px-1.5 py-0.5 rounded border ${className}`}
		>
			{children}
		</span>
	);
}

export function PackageRow({
	displayName,
	source,
	sourceType,
	isBundled,
	isDev,
	isOverride,
	currentVersion,
	latestVersion,
	updateAvailable,
	busy,
	progress,
	error,
	canUpdate = true,
	canUninstall = false,
	onUpdate,
	onUninstall,
	onViewReadme,
	onReset,
	onMove,
	currentScope,
	moveDestinationScope,
	moveDisabledReason,
	breakingChangeCount,
	whatsNewKind,
	onShowWhatsNew,
	testId,
}: PackageRowProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
	const { flipUp: menuFlipUp, maxHeight: menuMaxHeight } = usePopoverFlip(menuTriggerRef, { open: menuOpen });

	useEffect(() => {
		if (!menuOpen) return;
		const onDocClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
			}
		};
		document.addEventListener("mousedown", onDocClick);
		return () => document.removeEventListener("mousedown", onDocClick);
	}, [menuOpen]);

	const destScope = moveDestinationScope ?? (currentScope === "global" ? "local" : "global");
	const showMove = !!onMove;
	const moveLabel = `Move → ${destScope === "global" ? "Global" : "Local"}`;

	const hasMenu =
		(canUninstall && !!onUninstall) || !!onViewReadme || !!onReset || showMove;

	return (
		<div
			className="py-1.5 px-2 rounded hover:bg-[var(--bg-hover)] text-xs"
			data-testid={testId}
		>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[var(--text-primary)] font-medium">{displayName}</span>
						<Badge className={SOURCE_BADGE_STYLE[sourceType]}>{sourceType}</Badge>
						{isBundled && (
							<Badge className="border-amber-500/40 text-amber-400">bundled</Badge>
						)}
						{isOverride && (
							<span
								className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-400 bg-amber-500/10"
								title={`Declared as npm:${displayName} but installed from a ${sourceType} source`}
								aria-label={`Declared as npm:${displayName} but installed from a ${sourceType} source`}
								data-testid={testId ? `${testId}-override` : undefined}
							>
								override
							</span>
						)}
						{isDev && (
							<span className="text-[10px] italic text-[var(--text-muted)]">dev</span>
						)}
					</div>
					<code className="text-[10px] text-[var(--text-muted)] font-mono break-all">{source}</code>
				</div>
				<div className="flex items-center gap-2 flex-shrink-0">
					{updateAvailable && currentVersion && latestVersion ? (
						<span className="text-[10px] text-[var(--text-muted)]">
							<span className="text-[var(--text-secondary)]">{currentVersion}</span>
							{" → "}
							<span className="text-[var(--accent-primary)]">{latestVersion}</span>
						</span>
					) : currentVersion ? (
						<span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
							<Icon path={mdiCheckCircle} size={0.45} className="text-green-500" />
							{currentVersion}
							{latestVersion === null && (
								<span className="italic">{i18nT("auto.registry_unreachable", undefined, "(registry unreachable)")}</span>
							)}
						</span>
					) : null}
					{whatsNewKind && onShowWhatsNew && (
						<button
							onClick={onShowWhatsNew}
							title={
								whatsNewKind === "breaking"
									? `${breakingChangeCount ?? 1} breaking change${(breakingChangeCount ?? 1) === 1 ? "" : "s"} since your version`
									: "View what's new"
							}
							aria-label={
								whatsNewKind === "breaking"
									? "Breaking changes since your version \u2014 click for details"
									: "View what's new \u2014 click to see release notes"
							}
							className={
								whatsNewKind === "breaking"
									? "p-0.5 rounded text-amber-400 hover:bg-amber-500/10"
									: "p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
							}
							data-testid={testId ? `${testId}-whats-new` : undefined}
						>
							<Icon
								path={whatsNewKind === "breaking" ? mdiAlertCircleOutline : mdiInformationOutline}
								size={0.5}
							/>
						</button>
					)}
					{updateAvailable && canUpdate && onUpdate && (
						<button
							onClick={onUpdate}
							disabled={busy}
							className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50 flex items-center gap-1"
							data-testid={testId ? `${testId}-update` : undefined}
						>
							{busy ? <Icon path={mdiLoading} size={0.45} spin /> : <Icon path={mdiArrowUpBold} size={0.45} />}
							{i18nT("auto.update", undefined, "Update")}
						</button>
					)}
					{hasMenu && (
						<div ref={menuRef} className="relative">
							<button
								ref={menuTriggerRef}
								onClick={() => setMenuOpen((v) => !v)}
								className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
								title={i18nT("auto.more_actions", undefined, "More actions")}
								data-testid={testId ? `${testId}-menu` : undefined}
							>
								<Icon path={mdiDotsVertical} size={0.55} />
							</button>
							{menuOpen && (
								<div
									style={{ maxHeight: menuMaxHeight }}
									className={`absolute right-0 z-10 min-w-[160px] overflow-y-auto rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg py-1 text-xs ${
										menuFlipUp ? "bottom-full mb-1" : "top-full mt-1"
									}`}
								>
									{showMove && (
										<button
											className="block w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
											disabled={!!moveDisabledReason || busy}
											title={moveDisabledReason}
											onClick={() => { setMenuOpen(false); onMove?.(); }}
											data-testid={testId ? `${testId}-move` : undefined}
										>
											<Icon path={mdiSwapHorizontal} size={0.45} />
											{moveLabel}
										</button>
									)}
									{onViewReadme && (
										<button
											className="block w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
											onClick={() => { setMenuOpen(false); onViewReadme(); }}
										>
											{i18nT("auto.view_readme", undefined, "View README")}
										</button>
									)}
									{onReset && (
										<button
											className="block w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
											onClick={() => { setMenuOpen(false); onReset(); }}
										>
											{i18nT("auto.reset_reinstall", undefined, "Reset (reinstall)")}
										</button>
									)}
									{canUninstall && onUninstall && (
										<button
											className="block w-full text-left px-3 py-1.5 hover:bg-red-400/10 text-red-400"
											onClick={() => { setMenuOpen(false); onUninstall(); }}
										>
											{i18nT("auto.uninstall", undefined, "Uninstall")}
										</button>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
			{busy && progress && (
				<div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5 truncate" title={progress}>
					{progress}
				</div>
			)}
			{error && (
				<div className="text-[10px] text-red-400 mt-0.5 flex items-start gap-1">
					<Icon path={mdiAlertCircle} size={0.4} className="flex-shrink-0 mt-0.5" />
					<span>{error}</span>
				</div>
			)}
		</div>
	);
}
