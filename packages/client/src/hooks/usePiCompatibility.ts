/**
 * Hook for the pi-version-skew compatibility surface and the pi runtime
 * status row.
 *
 * Fetches GET /api/health on mount and every 60s, exposing `compatibility`
 * and `piRuntime` from the SAME response. Each is `null` when absent (older
 * server) or unresolvable. Instance-scoped: mount once per panel and pass the
 * fields down — a second mount puts a second 60s poller on the page.
 * See change: restore-pi-version-skew-surface, surface-pi-runtime-on-general.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "../lib/api/api-context.js";
import { logRejection } from "../lib/report-error.js";

/** Shape of `/api/health.compatibility` (subset the advisory reads). */
export interface PiCompatibility {
	minimum: string;
	recommended: string;
	maximum: string | null;
	current?: string;
	upgradeRecommended?: boolean;
	error?: string;
}

/**
 * Shape of `/api/health.piRuntime` — versions + divergence ONLY. Client-side
 * subset of the server's `PiDivergenceHealth` (system-routes.ts) covering
 * what the status row renders; the unauthenticated health shape never carries
 * a filesystem path or a pinned/override indicator.
 * See change: surface-pi-runtime-on-general (design D2 gate).
 */
export interface PiRuntimeHealth {
	spawnVersion: string | null;
	moduleVersion: string | null;
	consumerDiverged: boolean;
	consumerMessage: string | null;
}

export interface PiCompatibilityResult {
	compatibility: PiCompatibility | null;
	piRuntime: PiRuntimeHealth | null;
}

const POLL_INTERVAL_MS = 60 * 1000;

export function usePiCompatibility(): PiCompatibilityResult {
	const [compatibility, setCompatibility] = useState<PiCompatibility | null>(null);
	const [piRuntime, setPiRuntime] = useState<PiRuntimeHealth | null>(null);
	const mountedRef = useRef(true);

	const fetchHealth = useCallback(async () => {
		try {
			const res = await fetch(`${getApiBase()}/api/health`);
			const body = await res.json();
			if (!mountedRef.current) return;
			setCompatibility((body?.compatibility as PiCompatibility | null) ?? null);
			setPiRuntime((body?.piRuntime as PiRuntimeHealth | null) ?? null);
		} catch {
			/* network blip — keep the prior value */
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		// Discarded with a stated handler. See change: cleanup-client-plugin-promises.
		void fetchHealth().catch(logRejection("usePiCompatibility.mount"));
		const timer = setInterval(
			() => void fetchHealth().catch(logRejection("usePiCompatibility.poll")),
			POLL_INTERVAL_MS,
		);
		return () => {
			mountedRef.current = false;
			clearInterval(timer);
		};
	}, [fetchHealth]);

	return { compatibility, piRuntime };
}
