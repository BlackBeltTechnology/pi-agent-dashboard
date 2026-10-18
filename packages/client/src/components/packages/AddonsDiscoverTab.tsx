/**
 * Add-ons → Discover tab: the recommended panel (with Install all missing), npm
 * search, type filter and install-from-source, plus the install-confirm and
 * README dialogs. Moved here from the Settings panel's "Browse Packages" block.
 *
 * `hubOffSources` are global package sources the hub turned off (all-empty
 * filter form): their recommended card is not repeated because the Installed tab
 * shows them as an off row.
 *
 * See change: addons-hub-feature-catalog (test-plan #E26).
 */
import type { NpmPackageResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useState } from "react";
import { useInstalledPackages } from "../../hooks/useInstalledPackages.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { PackageBrowser } from "./PackageBrowser.js";
import { PackageInstallConfirmDialog } from "./PackageInstallConfirmDialog.js";
import { PackageReadmeDialog } from "./PackageReadmeDialog.js";

export function AddonsDiscoverTab({ hubOffSources = [] }: { hubOffSources?: readonly string[] }) {
	const installed = useInstalledPackages("global");
	const operations = usePackageOperations("global", undefined, installed.refresh);
	const [confirmInstall, setConfirmInstall] = useState<{ source: string; pkg?: NpmPackageResult } | null>(null);
	const [readmePkg, setReadmePkg] = useState<NpmPackageResult | null>(null);

	const doInstall = () => {
		if (!confirmInstall) return;
		operations.install(confirmInstall.source);
		setConfirmInstall(null);
	};

	return (
		<div data-testid="addons-discover-tab">
			<h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-1.5">
				{i18nT("common.browsePackages", undefined, "Browse Packages")}
			</h3>
			<PackageBrowser
				scope="global"
				onViewReadme={setReadmePkg}
				onConfirmInstall={(source, pkg) => setConfirmInstall({ source, pkg })}
				showInstalledSection={false}
				hideGlobalInstalledRecommended
				hubOffSources={hubOffSources}
			/>
			{confirmInstall && (
				<PackageInstallConfirmDialog
					source={confirmInstall.source}
					packageName={confirmInstall.pkg?.name}
					scope="global"
					lockScope="global"
					onConfirm={doInstall}
					onCancel={() => setConfirmInstall(null)}
				/>
			)}
			{readmePkg && (
				<PackageReadmeDialog
					pkg={readmePkg}
					installed={installed.packages.some((p) => p.source === `npm:${readmePkg.name}`)}
					onInstall={() => {
						setConfirmInstall({ source: `npm:${readmePkg.name}`, pkg: readmePkg });
						setReadmePkg(null);
					}}
					onUninstall={() => {
						operations.remove(`npm:${readmePkg.name}`);
						setReadmePkg(null);
					}}
					onClose={() => setReadmePkg(null)}
				/>
			)}
		</div>
	);
}
