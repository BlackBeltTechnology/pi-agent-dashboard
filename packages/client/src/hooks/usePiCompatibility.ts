/**
 * Hook for the pi-version-skew compatibility surface.
 *
 * Fetches GET /api/health on mount and every 60s, exposing the
 * `compatibility` field reactively. `null` when pi is unresolvable or the
 * field is absent (older server). See change: restore-pi-version-skew-surface.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { getApiBase } from "../lib/api-context.js";

/** Shape of `/api/health.compatibility` (subset the advisory reads). */
export interface PiCompatibility {
	minimum: string;
	recommended: string;
	maximum: string | null;
	current?: string;
	upgradeRecommended?: boolean;
	error?: string;
}

const POLL_INTERVAL_MS = 60 * 1000;

export function usePiCompatibility(): PiCompatibility | null {
	const [compatibility, setCompatibility] = useState<PiCompatibility | null>(null);
	const mountedRef = useRef(true);

	const fetchHealth = useCallback(async () => {
		try {
			const res = await fetch(`${getApiBase()}/api/health`);
			const body = await res.json();
			if (!mountedRef.current) return;
			setCompatibility((body?.compatibility as PiCompatibility | null) ?? null);
		} catch {
			/* network blip — keep the prior value */
		}
	}, []);

	useEffect(() => {
		mountedRef.current = true;
		fetchHealth();
		const timer = setInterval(() => fetchHealth(), POLL_INTERVAL_MS);
		return () => {
			mountedRef.current = false;
			clearInterval(timer);
		};
	}, [fetchHealth]);

	return compatibility;
}
