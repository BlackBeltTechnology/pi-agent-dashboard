/**
 * One row per Add-ons feature: name, origin badge, part chips, version/update
 * per package part, a switch-styled `role="checkbox"` (so a `partial` feature
 * can expose `aria-checked="mixed"`), a `⋮` menu with per-part actions and an
 * expander showing "For the AI agent (pi)" / "For this dashboard".
 *
 * See change: addons-hub-feature-catalog (spec: addons-feature-catalog ›
 * The Installed tab SHALL render one row per feature).
 */
import type { AddonFeature, AddonPackagePart } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
	mdiAlertCircle,
	mdiArrowUpBold,
	mdiChevronDown,
	mdiChevronRight,
	mdiClockOutline,
	mdiDotsVertical,
	mdiLoading,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useId, useRef, useState } from "react";
import { featurePartChips, isLocalSourceFeature, originBadgeLabel, partLocalDescription } from "../../lib/addons/addon-feature-helpers.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { rowAnchorId } from "./AddonToggleConfirm.js";
import { PartChip, partLabel } from "./PartChip.js";

export interface AddonFeatureRowProps {
	feature: AddonFeature;
	/** Package sources with an available update (client overlay). */
	updates: ReadonlySet<string>;
	/** Per-source operation state from the package queue. */
	statusFor: (source: string) => string;
	/** The switch is busy (dry run / toggle in flight). */
	toggling: boolean;
	error?: string;
	/** Move/reset bypass the package queue and are disabled while any operation runs. */
	locked: boolean;
	lockedReason: string;
	onToggle: () => void;
	onUpdate: (source: string) => void;
	onUninstall: (source: string) => void;
	onMove: (source: string) => void;
	onResetToPublished: (source: string) => void;
	onViewReadme?: (npmName: string) => void;
	onOpenSettings?: (pluginId: string) => void;
	/** Feature ids of requirements, to link from the dashboard panel. */
	featureName: (id: string) => string;
}

const partName = (p: AddonPackagePart) => p.packageName ?? p.source.replace(/^npm:/, "").split(/[\\/]/).filter(Boolean).pop() ?? p.source;

function npmNameOf(p: AddonPackagePart): string | null {
	if (p.sourceKind !== "npm") return null;
	const spec = p.source.slice(4);
	const at = spec.lastIndexOf("@");
	return at > 0 ? spec.slice(0, at) : spec;
}

export function AddonFeatureRow(props: AddonFeatureRowProps) {
	const { feature: f, updates, statusFor, toggling, error, locked, lockedReason } = props;
	const [expanded, setExpanded] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [resetFor, setResetFor] = useState<AddonPackagePart | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const panelId = useId();
	const descId = useId();

	useEffect(() => {
		if (!menuOpen) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [menuOpen]);

	const toggleable = f.kind !== "core";
	const multi = f.packages.length > 1;
	const chips = featurePartChips(f);
	const updatable = f.packages.filter((p) => updates.has(p.source));
	const anyBusy = f.packages.some((p) => ["running", "queued"].includes(statusFor(p.source)));
	const pkgItems = f.packages.filter((p) => p.sourceKind !== undefined);
	const label = (base: string, p: AddonPackagePart) => (multi ? `${base} — ${partName(p)}` : base);
	const hasMenu = pkgItems.length > 0 || (f.plugin?.hasSettings && !!props.onOpenSettings);
	const stateAttr = f.state === "partial" ? "mixed" : f.state === "on";
	const localDescriptions = f.packages.map(partLocalDescription).filter((d): d is string => !!d);

	return (
		<div
			id={rowAnchorId(f.id)}
			className="py-1.5 px-2 rounded hover:bg-[var(--bg-hover)] text-xs"
			data-testid={`addon-row-${f.id}`}
			data-state={f.state}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[var(--text-primary)] font-medium">{f.displayName}</span>
						<span
							className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
							data-testid={`addon-origin-${f.id}`}
						>
							{originBadgeLabel(f)}
						</span>
						{isLocalSourceFeature(f) && (
							<span
								className="text-[10px] px-1.5 py-0.5 rounded border border-teal-500/40 text-teal-400"
								title={localDescriptions.join(" ") || undefined}
								aria-describedby={localDescriptions.length ? descId : undefined}
								data-testid={`addon-local-${f.id}`}
							>
								{i18nT("addons.local", undefined, "local")}
							</span>
						)}
						{localDescriptions.length > 0 && (
							<span id={descId} className="sr-only">
								{localDescriptions.join(" ")}
							</span>
						)}
						{anyBusy && (
							<span className="text-[10px] flex items-center gap-0.5 text-[var(--accent-primary)]" data-testid={`addon-queued-${f.id}`}>
								<Icon path={mdiClockOutline} size={0.4} />
								{i18nT("common.queued", undefined, "Queued")}
							</span>
						)}
						{chips.map((c) => (
							<PartChip key={c.kind} kind={c.kind}>
								{c.count ? `${partLabel(c.kind)} ×${c.count}` : undefined}
							</PartChip>
						))}
					</div>
					{f.description && <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{f.description}</div>}
				</div>
				<div className="flex items-center gap-2 flex-shrink-0">
					{f.packages.map((p) =>
						p.version ? (
							<span key={p.identity} className="text-[10px] text-[var(--text-muted)]" data-testid={`addon-version-${f.id}`}>
								{updates.has(p.source) ? (
									<span className="text-[var(--accent-primary)]">{p.version} ↑</span>
								) : (
									p.version
								)}
							</span>
						) : null,
					)}
					{updatable.length > 0 && (
						<button
							type="button"
							onClick={() => {
								for (const p of updatable) props.onUpdate(p.source);
							}}
							disabled={anyBusy}
							className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50 flex items-center gap-1"
							data-testid={`addon-update-${f.id}`}
						>
							<Icon path={anyBusy ? mdiLoading : mdiArrowUpBold} size={0.45} spin={anyBusy} />
							{i18nT("common.update", undefined, "Update")}
						</button>
					)}
					{f.state === "partial" && (
						<span className="text-[10px] text-amber-400" data-testid={`addon-partial-${f.id}`}>
							{i18nT("addons.partlyOn", undefined, "partly on")}
						</span>
					)}
					{toggleable && (
						<button
							type="button"
							role="checkbox"
							aria-checked={stateAttr}
							aria-label={f.displayName}
							disabled={toggling}
							onClick={props.onToggle}
							data-testid={`addon-switch-${f.id}`}
							className={`shrink-0 relative inline-flex h-3.5 w-6 items-center rounded-full transition-colors disabled:opacity-50 ${
								f.state === "on" ? "bg-[var(--accent-primary)]" : f.state === "partial" ? "bg-amber-500/60" : "bg-[var(--bg-hover)]"
							}`}
						>
							<span
								className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${
									f.state === "on" ? "translate-x-3" : f.state === "partial" ? "translate-x-1.5" : "translate-x-0.5"
								}`}
							/>
						</button>
					)}
					{hasMenu && (
						<div ref={menuRef} className="relative">
							<button
								type="button"
								onClick={() => setMenuOpen((v) => !v)}
								aria-haspopup="menu"
								aria-expanded={menuOpen}
								className="p-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
								title={i18nT("common.moreActions", undefined, "More actions")}
								aria-label={i18nT("common.moreActions", undefined, "More actions")}
								data-testid={`addon-menu-${f.id}`}
							>
								<Icon path={mdiDotsVertical} size={0.55} />
							</button>
							{menuOpen && (
								<div
									role="menu"
									className="absolute right-0 top-full mt-1 z-10 min-w-[180px] rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg py-1 text-xs"
								>
									{f.plugin?.hasSettings && props.onOpenSettings && (
										<MenuItem onClick={() => { setMenuOpen(false); props.onOpenSettings?.(f.plugin?.id as string); }}>
											{i18nT("addons.menu.settings", undefined, "Settings")}
										</MenuItem>
									)}
									{pkgItems.map((p) => {
										const npm = npmNameOf(p);
										return (
											<div key={p.identity}>
												{props.onViewReadme && npm && (
													<MenuItem onClick={() => { setMenuOpen(false); props.onViewReadme?.(npm); }}>
														{label(i18nT("common.viewReadme", undefined, "View README"), p)}
													</MenuItem>
												)}
												{updates.has(p.source) && (
													<MenuItem onClick={() => { setMenuOpen(false); props.onUpdate(p.source); }}>
														{label(i18nT("common.update", undefined, "Update"), p)}
													</MenuItem>
												)}
												{f.kind !== "core" && (
												<MenuItem
													disabled={locked}
													title={locked ? lockedReason : undefined}
													testId={`addon-move-${f.id}`}
													onClick={() => { setMenuOpen(false); props.onMove(p.source); }}
												>
													{label(i18nT("addons.menu.moveLocal", undefined, "Move → Local"), p)}
												</MenuItem>
												)}
												{p.publishedVariantSource && (
													<MenuItem
														disabled={locked}
														title={locked ? lockedReason : undefined}
														testId={`addon-reset-${f.id}`}
														onClick={() => { setMenuOpen(false); setResetFor(p); }}
													>
														{label(
															p.publishedVariantVersion
																? i18nT("packages.resetToPublishedVersion", { version: p.publishedVariantVersion }, `Reset to published version (${p.publishedVariantVersion})`)
																: i18nT("packages.resetToPublished", undefined, "Reset to published version"),
															p,
														)}
													</MenuItem>
												)}
												{f.kind !== "core" && (
													<MenuItem danger onClick={() => { setMenuOpen(false); props.onUninstall(p.source); }}>
														{label(i18nT("packages.uninstall", undefined, "Uninstall"), p)}
													</MenuItem>
												)}
											</div>
										);
									})}
								</div>
							)}
						</div>
					)}
					<button
						type="button"
						onClick={() => setExpanded((v) => !v)}
						aria-expanded={expanded}
						aria-controls={panelId}
						aria-label={i18nT("addons.row.details", { name: f.displayName }, `Details of ${f.displayName}`)}
						className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)]"
						data-testid={`addon-expand-${f.id}`}
					>
						<Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.55} />
					</button>
				</div>
			</div>
			{error && (
				<div role="alert" className="text-[10px] text-red-400 mt-0.5 flex items-start gap-1">
					<Icon path={mdiAlertCircle} size={0.4} className="flex-shrink-0 mt-0.5" />
					<span>{error}</span>
				</div>
			)}
			{resetFor && (
				<div className="mt-1 px-2 py-1.5 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-[11px]" data-testid={`addon-reset-confirm-${f.id}`}>
					<div className="text-[var(--text-primary)] mb-1">
						{i18nT(
							"packages.resetConfirmBody",
							undefined,
							"This discards your local checkout link and installs the published version. Your working-tree files are not deleted — only the packages[] link is removed. The published version installs first.",
						)}
					</div>
					<div className="font-mono text-[10px] text-[var(--text-muted)] mb-2 break-all">
						<span className="text-red-400">{resetFor.source}</span>
						{" → "}
						<span className="text-[var(--accent-primary)]">{resetFor.publishedVariantSource}</span>
					</div>
					<div className="flex items-center gap-2 justify-end">
						<button type="button" onClick={() => setResetFor(null)} className="px-2 py-0.5 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]">
							{i18nT("common.cancel", undefined, "Cancel")}
						</button>
						<button
							type="button"
							onClick={() => { const s = resetFor.source; setResetFor(null); props.onResetToPublished(s); }}
							className="px-2 py-0.5 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30"
							data-testid={`addon-reset-accept-${f.id}`}
						>
							{i18nT("packages.resetToNpm", undefined, "Reset to npm")}
						</button>
					</div>
				</div>
			)}
			<div id={panelId} hidden={!expanded} className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2" data-testid={`addon-panels-${f.id}`}>
				{expanded && <FeaturePanels feature={f} featureName={props.featureName} />}
			</div>
		</div>
	);
}

function MenuItem({
	children,
	onClick,
	disabled,
	title,
	danger,
	testId,
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	title?: string;
	danger?: boolean;
	testId?: string;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			title={title}
			onClick={onClick}
			data-testid={testId}
			className={`block w-full text-left px-3 py-1.5 hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed ${danger ? "text-red-400" : "text-[var(--text-primary)]"}`}
		>
			{children}
		</button>
	);
}

function FeaturePanels({ feature: f, featureName }: { feature: AddonFeature; featureName: (id: string) => string }) {
	const delivered = originBadgeLabel(f);
	return (
		<>
			<section className="rounded border border-[var(--border-secondary)] p-2" data-testid={`addon-panel-agent-${f.id}`}>
				<h4 className="text-[11px] font-semibold text-[var(--text-primary)] mb-1">{i18nT("addons.panel.agent", undefined, "For the AI agent (pi)")}</h4>
				{f.packages.length === 0 && f.kind !== "core" ? (
					<p className="text-[11px] text-[var(--text-muted)]">{i18nT("addons.panel.noAgentPart", undefined, "Nothing for the AI agent.")}</p>
				) : (
					<ul className="space-y-1">
						{f.packages.map((p) => (
							<li key={p.identity} className="text-[11px] text-[var(--text-secondary)]">
								<code className="font-mono text-[10px] break-all">{p.source}</code>
								{p.publishedVariantSource && (
									<div className="text-[10px] text-[var(--text-muted)]">
										{i18nT("addons.panel.published", { target: p.publishedVariantSource }, `Published: ${p.publishedVariantSource}`)}
									</div>
								)}
								<div className="text-[10px] text-[var(--text-muted)]">
									{p.contents.extensions} {i18nT("addons.part.extension", undefined, "extension")} · {p.contents.skills}{" "}
									{i18nT("addons.part.skills", undefined, "skills")} · {p.contents.prompts} {i18nT("addons.part.prompts", undefined, "prompts")} · {p.contents.themes}{" "}
									{i18nT("addons.part.themes", undefined, "themes")}
								</div>
							</li>
						))}
					</ul>
				)}
				{f.bridge && (
					<p className="text-[10px] text-[var(--text-muted)] mt-1" data-testid={`addon-bridge-${f.id}`}>
						{i18nT("addons.panel.bridge", undefined, "bridge — managed by the dashboard")}:{" "}
						<code className="font-mono break-all">{f.bridge.path}</code>
					</p>
				)}
				<p className="text-[10px] text-[var(--text-muted)] mt-1">{i18nT("addons.panel.deliveredBy", { who: delivered }, `Delivered by: ${delivered}`)}</p>
			</section>
			<section className="rounded border border-[var(--border-secondary)] p-2" data-testid={`addon-panel-dashboard-${f.id}`}>
				<h4 className="text-[11px] font-semibold text-[var(--text-primary)] mb-1">{i18nT("addons.panel.dashboard", undefined, "For this dashboard")}</h4>
				{f.plugin ? (
					<div className="text-[11px] text-[var(--text-secondary)] space-y-0.5">
						<div>
							<code className="font-mono text-[10px]">{f.plugin.id}</code>{" "}
							<span className="text-[10px] text-[var(--text-muted)]">
								{f.plugin.error
									? f.plugin.error
									: f.plugin.enabled
										? f.plugin.loaded
											? i18nT("addons.panel.statusLoaded", undefined, "loaded")
											: i18nT("addons.panel.statusEnabled", undefined, "enabled")
										: i18nT("addons.panel.statusDisabled", undefined, "disabled")}
							</span>
						</div>
						{f.plugin.missingRequirements.length > 0 && (
							<div className="text-amber-400 text-[10px]">
								{i18nT("addons.panel.missing", { names: f.plugin.missingRequirements.join(", ") }, `Missing: ${f.plugin.missingRequirements.join(", ")}`)}
							</div>
						)}
						{f.plugin.dependsOn.length > 0 && (
							<div className="text-[10px] text-[var(--text-muted)]">
								{i18nT("addons.panel.dependsOn", { names: f.plugin.dependsOn.join(", ") }, `Depends on: ${f.plugin.dependsOn.join(", ")}`)}
							</div>
						)}
					</div>
				) : (
					<p className="text-[11px] text-[var(--text-muted)]">{i18nT("addons.panel.noDashboardPart", undefined, "Nothing for the dashboard.")}</p>
				)}
				{f.requiredBy.length > 0 && (
					<p className="text-[10px] text-[var(--text-muted)] mt-1">
						{i18nT("addons.panel.requiredBy", { names: f.requiredBy.map(featureName).join(", ") }, `Required by: ${f.requiredBy.map(featureName).join(", ")}`)}
					</p>
				)}
				{f.requires.length > 0 && (
					<p className="text-[10px] text-[var(--text-muted)] mt-1">
						{i18nT("addons.panel.requires", { names: f.requires.map((r) => r.name).join(", ") }, `Uses: ${f.requires.map((r) => r.name).join(", ")}`)}
					</p>
				)}
			</section>
		</>
	);
}
