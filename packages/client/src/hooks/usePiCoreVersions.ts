/**
 * Hook for pi core package version status.
 *
 * Fetches GET /api/pi-core/versions on mount, polls every 30 minutes,
 * refetches when a pi_core_update_complete WS event arrives, and
 * exposes `refresh(force?)` for manual / force-refresh.
 */

import type { PiCoreStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { t } from "../lib/i18n/i18n.js";

const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export interface UsePiCoreVersionsResult {
	status: PiCoreStatus | null;
	isLoading: boolean;
	error: string | null;
	refresh: (force?: boolean) => Promise<void>;
}

export function usePiCoreVersions(): UsePiCoreVersionsResult {
	const [status, setStatus] = useState<PiCoreStatus | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mountedRef = useRef(true);

	const fetchStatus = useCallback(async (force = false) => {
		setIsLoading(true);
		setError(null);
		try {
			const url = `${getApiBase()}/api/pi-core/versions${force ? "?refresh=true" : ""}`;
			const res = await fetch(url);
			const body = await res.json();
			if (!mountedRef.current) return;
			if (body.success) {
				setStatus(body.data as PiCoreStatus);
			} else {
				setError(body.error ?? t("piCore.fetchVersionsFailed", undefined, "Failed to fetch pi core versions"));
			}
		} catch (err: any) {
			if (!mountedRef.current) return;
			setError(err?.message ?? t("common.networkError", undefined, "Network error"));
		} finally {
			if (mountedRef.current) setIsLoading(false);
		}
	}, []);

	// Initial fetch + periodic polling.
	useEffect(() => {
		mountedRef.current = true;
		fetchStatus();
		const timer = setInterval(() => fetchStatus(), POLL_INTERVAL_MS);
		return () => {
			mountedRef.current = false;
			clearInterval(timer);
		};
	}, [fetchStatus]);

	// Refetch after a pi core update completes.
	useEffect(() => {
		const handler = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "pi_core_update_complete") {
				// Force refresh to bypass server-side cache.
				fetchStatus(true);
			}
		};
		window.addEventListener("pi-core-event", handler);
		return () => window.removeEventListener("pi-core-event", handler);
	}, [fetchStatus]);

	return { status, isLoading, error, refresh: fetchStatus };
}
