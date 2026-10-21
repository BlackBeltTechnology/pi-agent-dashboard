/**
 * Subscribes to the shared Add-ons issue snapshot and keeps it fresh: refresh on
 * mount of the first consumer, on every `plugin-config-update` (plugin toggle)
 * and on every successful `pi-package-event` (package operation: health only; plugin issues fold from `plugins_changed`). A cleanup Apply calls `refresh` explicitly.
 *
 * See change: addons-hub-folder-view (design D9).
 */
import { useEffect, useSyncExternalStore } from "react";
import {
	applyPluginsSnapshot,
	getAddonIssues,
	refreshAddonHealth,
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
		// A finished package operation can fix or cause `packages[]` health problems. Only HEALTH is refetched: the
		// plugin half arrives in the `plugins_changed` snapshot (no second `GET /api/plugins`, F6).
		const onPackage = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "package_operation_complete" && msg.success) {
				void refreshAddonHealth().catch(logRejection("useAddonIssues.package"));
			}
		};
		const onPluginsChanged = (e: Event) => {
			const plugins = (e as CustomEvent<{ plugins?: Parameters<typeof applyPluginsSnapshot>[0] }>).detail?.plugins;
			if (Array.isArray(plugins)) applyPluginsSnapshot(plugins);
		};
		window.addEventListener("plugin-config-update", onPluginToggle);
		window.addEventListener("pi-package-event", onPackage);
		window.addEventListener("plugins-changed", onPluginsChanged);
		return () => {
			window.removeEventListener("plugin-config-update", onPluginToggle);
			window.removeEventListener("pi-package-event", onPackage);
			window.removeEventListener("plugins-changed", onPluginsChanged);
		};
	}, []);
	return { ...snap, refresh: refreshAddonIssues };
}
