/**
 * Subscribes to the shared Add-ons issue snapshot and keeps it fresh: refresh on
 * mount of the first consumer and on every `plugin-config-update` (plugin
 * toggle). A cleanup Apply calls `refresh` explicitly.
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
		window.addEventListener("plugin-config-update", onPluginToggle);
		return () => window.removeEventListener("plugin-config-update", onPluginToggle);
	}, []);
	return { ...snap, refresh: refreshAddonIssues };
}
