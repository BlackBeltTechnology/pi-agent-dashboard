/**
 * Add-ons → Issues tab: everything wrong with installed add-ons in one place.
 *
 * - plugins that are enabled but failed to load or miss a requirement (copyable
 *   error, the missing-requirement block with its Install pill, link to the
 *   plugin's settings page);
 * - `packages[]` health problems (stale / missing / duplicate) rendered by the
 *   existing `PackageHealthPanel`.
 *
 * Reads the shared issue snapshot (`useAddonIssues`), so its count always equals
 * the Settings rail badge. A failed health request shows plugin issues only, no
 * error.
 *
 * See change: addons-hub-folder-view (spec: addons-issues).
 */
import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import type { useAddonIssues } from "../../hooks/useAddonIssues.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { applyPackageCleanup } from "../../lib/package/package-health-api.js";
import type { PluginRow } from "../../lib/package/plugins-api.js";
import { logRejection } from "../../lib/report-error.js";
import { PackageHealthPanel } from "./PackageHealthPanel.js";
import { CopyableErrorBlock, MissingRequirementsBlock } from "./plugin-row-parts.js";

type Issues = ReturnType<typeof useAddonIssues>;

interface Props {
	issues: Issues;
	/** After a cleanup Apply: refresh the Installed catalog. */
	onCleaned?: () => Promise<void> | void;
}

const hasSettingsPage = (row: PluginRow) => row.claims.some((c) => c.slot === "settings-section");

export function AddonsIssuesTab({ issues, onCleaned }: Props) {
	const [, navigate] = useLocation();
	const [restartRequired, setRestartRequired] = useState(false);
	const { health, pluginIssues, count, refresh } = issues;

	const apply = useCallback(
		async (drop: string[]) => {
			await applyPackageCleanup(drop);
			setRestartRequired(true);
			await Promise.all([onCleaned?.(), refresh()]);
		},
		[onCleaned, refresh],
	);

	return (
		<div data-testid="addons-issues-tab">
			{restartRequired && (
				<div
					className="mb-2 p-2 rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] text-xs"
					role="status"
					data-testid="pkg-health-restart-banner"
				>
					{i18nT("packages.health.restartRequired", undefined, "Restart required for package changes to take effect.")}
				</div>
			)}
			{count === 0 && !restartRequired && (
				<p className="text-xs text-[var(--text-muted)] italic" data-testid="addons-issues-empty">
					{i18nT("addons.issues.none", undefined, "No issues")}
				</p>
			)}
			{pluginIssues.map((row) => (
				<div
					key={row.id}
					className="mb-2 p-2 rounded border border-[var(--border-secondary)] text-xs"
					data-testid={`addons-issue-plugin-${row.id}`}
				>
					<div className="flex items-center justify-between gap-2">
						<span className="text-[var(--text-primary)] font-medium">{row.displayName}</span>
						{hasSettingsPage(row) && (
							<button
								type="button"
								onClick={() => navigate(`/settings/plugins/${row.id}`)}
								className="text-[var(--text-primary)] underline underline-offset-2 hover:no-underline cursor-pointer"
								data-testid={`addons-issue-settings-${row.id}`}
							>
								{i18nT("addons.issues.openSettings", undefined, "Open settings")}
							</button>
						)}
					</div>
					{row.status?.error && <CopyableErrorBlock text={row.status.error} testId={`addons-issue-error-${row.id}`} />}
					<MissingRequirementsBlock row={row} />
				</div>
			))}
			{health && (
				<PackageHealthPanel
					report={health}
					onApply={apply}
					onRefresh={() => refresh().catch(logRejection("AddonsIssuesTab.refresh"))}
				/>
			)}
		</div>
	);
}
