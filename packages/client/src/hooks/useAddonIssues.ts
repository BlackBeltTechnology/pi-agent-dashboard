/**
 * Subscribes to the shared Add-ons issue snapshot and keeps it fresh: refresh on
 * mount of the first consumer, on every `plugin-config-update` (plugin toggle)
 * and on every successful `pi-package-event` (package operation). A cleanup Apply calls `refresh` explicitly.
 *
 * See change: addons-hub-folder-view (design D9).
 */
import { useEffect, useSyncExternalStore } from "react";
import {
	getAddonIssues,
	refreshAddonIssues,
	subscribeAddonIssues,
} from "../lib/addons/addon-issues-store.js";
import { logRejection } from "../lib/report-error.js";

export function useAddonIssues() {
	const snap = useSyncExternalStore(subscribeAddonIssues, getAddonIssues, getAddonIssues);
	useEffect(() => {
		void refreshAddonIssues().catch(logRejection("useAddonIssues.mount"));
		const onPluginToggle = () => {
			void refreshAddonIssues().catch(logRejection("useAddonIssues.plugin"));
		};
		// A finished package operation can fix or cause `packages[]` health problems.
		const onPackage = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "package_operation_complete" && msg.success) onPluginToggle();
		};
		window.addEventListener("plugin-config-update", onPluginToggle);
		window.addEventListener("pi-package-event", onPackage);
		return () => {
			window.removeEventListener("plugin-config-update", onPluginToggle);
			window.removeEventListener("pi-package-event", onPackage);
		};
	}, []);
	return { ...snap, refresh: refreshAddonIssues };
}
