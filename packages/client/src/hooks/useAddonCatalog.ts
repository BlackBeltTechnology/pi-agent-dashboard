/**
 * Loads `GET /api/addons/catalog` and keeps it fresh: one refetch per
 * `package_operation_complete` (window `pi-package-event`) or
 * `plugin_config_update` (window `plugin-config-update`), debounced so a burst
 * of events yields a single request.
 *
 * See change: addons-hub-feature-catalog (test-plan #F4).
 */
import type { AddonFeature } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAddonCatalog } from "../lib/addons/addons-api.js";
import { logRejection } from "../lib/report-error.js";

export const ADDON_CATALOG_DEBOUNCE_MS = 150;

export function useAddonCatalog() {
	const [features, setFeatures] = useState<AddonFeature[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const mounted = useRef(true);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const refresh = useCallback(async () => {
		try {
			const next = await fetchAddonCatalog();
			if (!mounted.current) return;
			setFeatures(next);
			setError(null);
		} catch (err) {
			if (mounted.current) setError((err as Error).message);
		} finally {
			if (mounted.current) setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		mounted.current = true;
		void refresh().catch(logRejection("useAddonCatalog.mount"));
		const schedule = () => {
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				timer.current = null;
				void refresh().catch(logRejection("useAddonCatalog.event"));
			}, ADDON_CATALOG_DEBOUNCE_MS);
		};
		const onPackage = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "package_operation_complete" && msg.success) schedule();
		};
		window.addEventListener("pi-package-event", onPackage);
		window.addEventListener("plugin-config-update", schedule);
		return () => {
			mounted.current = false;
			if (timer.current) clearTimeout(timer.current);
			window.removeEventListener("pi-package-event", onPackage);
			window.removeEventListener("plugin-config-update", schedule);
		};
	}, [refresh]);

	return { features, isLoading, error, refresh };
}
