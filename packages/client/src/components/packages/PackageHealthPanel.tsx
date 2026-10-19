/**
 * Panel listing unhealthy `packages[]` entries (stale npm / missing path /
 * duplicates) with per-row drop checkboxes and a single Apply. The user
 * decides what goes; nothing is pre-selected except missing-path members of a
 * duplicate group (they can only be dead weight).
 *
 * Renders nothing when every entry is ok. Collapse state is sticky for the
 * browser session (sessionStorage).
 *
 * See change: add-package-health-cleanup.
 */
import type {
	PackageHealthListResponseData,
	PackageHealthReport,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiChevronDown, mdiChevronRight, mdiLoading, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useMemo, useState } from "react";
import { t } from "../../lib/i18n/i18n.js";
import { classifySource } from "../../lib/package/package-classifier.js";
import { countHealthIssues } from "../../lib/package/package-health-api.js";
import { logRejection } from "../../lib/report-error.js";

const PACKAGE_HEALTH_COLLAPSED_KEY = "pi.packageHealth.collapsed";

export interface PackageHealthPanelProps {
	report: PackageHealthListResponseData;
	/** Perform the cleanup. Reject to surface the message inline. */
	onApply: (drop: string[]) => Promise<void>;
	onRefresh: () => void;
}

// The count lives in the api module so `lib/addons/addon-issues-store.ts` can use it without importing a component.
export { countHealthIssues };

function initialDrops(entries: PackageHealthReport[]): Set<string> {
	return new Set(entries.filter((e) => e.duplicateGroupId && e.status === "missing-path").map((e) => e.source));
}

function readCollapsed(): boolean {
	try {
		return sessionStorage.getItem(PACKAGE_HEALTH_COLLAPSED_KEY) === "1";
	} catch {
		return false;
	}
}

export function PackageHealthPanel({ report, onApply, onRefresh }: PackageHealthPanelProps) {
	const [drops, setDrops] = useState<Set<string>>(() => initialDrops(report.entries));
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(readCollapsed);

	// A fresh report (after Apply / Rescan) resets the selection to its defaults.
	useEffect(() => {
		setDrops(initialDrops(report.entries));
	}, [report]);

	const { stale, missing, groups } = useMemo(() => {
		const byGroup = new Map<string, PackageHealthReport[]>();
		const staleRows: PackageHealthReport[] = [];
		const missingRows: PackageHealthReport[] = [];
		for (const e of report.entries) {
			if (e.duplicateGroupId) {
				const list = byGroup.get(e.duplicateGroupId);
				if (list) list.push(e);
				else byGroup.set(e.duplicateGroupId, [e]);
			} else if (e.status === "stale-npm") staleRows.push(e);
			else if (e.status === "missing-path") missingRows.push(e);
		}
		return { stale: staleRows, missing: missingRows, groups: [...byGroup.entries()] };
	}, [report]);

	if (countHealthIssues(report) === 0) return null;

	const toggle = (source: string) =>
		setDrops((prev) => {
			const next = new Set(prev);
			if (!next.delete(source)) next.add(source);
			return next;
		});
	const setAll = (rows: PackageHealthReport[], on: boolean) =>
		setDrops((prev) => {
			const next = new Set(prev);
			for (const r of rows) {
				if (on) next.add(r.source);
				else next.delete(r.source);
			}
			return next;
		});
	const toggleCollapsed = () => {
		const next = !collapsed;
		setCollapsed(next);
		try {
			sessionStorage.setItem(PACKAGE_HEALTH_COLLAPSED_KEY, next ? "1" : "0");
		} catch {
			/* storage unavailable — collapse stays per-mount */
		}
	};
	const apply = async () => {
		setPending(true);
		setError(null);
		try {
			await onApply([...drops]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	};

	const renderRow = (e: PackageHealthReport, showMeta: boolean) => (
		<label
			key={e.source}
			className="flex items-start gap-2 text-xs py-1 cursor-pointer"
			data-testid={`pkg-health-row-${e.source.replace(/[^a-z0-9]/gi, "-")}`}
		>
			<input
				type="checkbox"
				className="mt-0.5"
				checked={drops.has(e.source)}
				disabled={pending}
				onChange={() => toggle(e.source)}
				aria-label={t("packages.health.removeSource", { source: e.source }, `Remove ${e.source}`)}
			/>
			<span className="min-w-0 flex-1">
				<span className="block font-mono break-all text-[var(--text-primary)]">{e.source}</span>
				{showMeta ? (
					<span className="block text-[var(--text-muted)]">
						{[
							e.version && `v${e.version}`,
							classifySource(e.source),
							e.resolvedPath,
							e.mtime && new Date(e.mtime).toLocaleString(),
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				) : (
					e.reason && <span className="block text-[var(--text-muted)]">{e.reason}</span>
				)}
			</span>
		</label>
	);

	const renderSection = (testId: string, title: string, rows: PackageHealthReport[]) =>
		rows.length > 0 && (
			<section className="mb-2" data-testid={testId}>
				<div className="flex items-center justify-between">
					<h4 className="text-xs font-semibold text-[var(--text-secondary)]">
						{title} ({rows.length})
					</h4>
					<label className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 cursor-pointer">
						<input
							type="checkbox"
							checked={rows.every((r) => drops.has(r.source))}
							disabled={pending}
							onChange={(ev) => setAll(rows, ev.target.checked)}
						/>
						{t("packages.health.selectAll", undefined, "Select all")}
					</label>
				</div>
				{rows.map((r) => renderRow(r, false))}
			</section>
		);

	return (
		<div
			className="mb-3 p-2 rounded border border-amber-500/30 bg-amber-500/10"
			data-testid="package-health-panel"
		>
			<div className="flex items-center justify-between">
				<button
					type="button"
					onClick={toggleCollapsed}
					aria-expanded={!collapsed}
					className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1"
				>
					<Icon path={collapsed ? mdiChevronRight : mdiChevronDown} size={0.6} />
					{t("packages.health.title", undefined, "Package issues")}
				</button>
				<button
					type="button"
					onClick={onRefresh}
					disabled={pending}
					className="text-xs px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] disabled:opacity-50 flex items-center gap-1"
				>
					<Icon path={mdiRefresh} size={0.5} />
					{t("packages.health.rescan", undefined, "Rescan")}
				</button>
			</div>
			{!collapsed && (
				<div className="mt-2">
					{renderSection("pkg-health-stale", t("packages.health.stale", undefined, "Stale npm packages"), stale)}
					{renderSection("pkg-health-missing", t("packages.health.missing", undefined, "Missing paths"), missing)}
					{groups.length > 0 && (
						<section className="mb-2" data-testid="pkg-health-duplicates">
							<h4 className="text-xs font-semibold text-[var(--text-secondary)]">
								{t("packages.health.duplicates", undefined, "Duplicates")}
							</h4>
							<p className="text-[10px] text-[var(--text-muted)] mb-1">
								{t(
									"packages.health.duplicateHint",
									undefined,
									"Same package name loaded from several places. Check the ones to remove; keep at least one.",
								)}
							</p>
							{groups.map(([id, members]) => (
								<div
									key={id}
									className="mb-1 pl-2 border-l border-[var(--border-secondary)]"
									data-testid={`pkg-health-group-${id}`}
								>
									<div className="text-xs font-semibold">{members[0].packageName ?? id}</div>
									{members.map((m) => renderRow(m, true))}
								</div>
							))}
						</section>
					)}
					{error && (
						<div role="alert" className="text-xs text-red-400 mb-2" data-testid="pkg-health-error">
							{error}
						</div>
					)}
					<button
						type="button"
						onClick={() => apply().catch(logRejection("PackageHealthPanel.apply"))}
						disabled={drops.size === 0 || pending}
						className="text-xs px-3 py-1 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50 flex items-center gap-1"
						data-testid="pkg-health-apply"
					>
						{pending && <Icon path={mdiLoading} size={0.55} spin />}
						{pending
							? t("packages.health.applying", undefined, "Applying…")
							: t("packages.health.apply", { count: drops.size }, `Apply cleanup (${drops.size})`)}
					</button>
				</div>
			)}
		</div>
	);
}
