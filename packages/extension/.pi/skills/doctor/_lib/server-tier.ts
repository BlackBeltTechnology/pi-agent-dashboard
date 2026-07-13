/**
 * Server-tier helpers — the additive `/api/*` enrichment tier. These DEGRADE
 * cleanly: when the dashboard server is down every call resolves to
 * `{ ok: false, reason }` instead of throwing, so the file-derived baseline
 * still produces a report. Never a dependency, always a bonus.
 *
 * See change: add-modular-doctor-skill (design.md D4, spec: server enrichment).
 */

export type ServerResult<T> =
	| { ok: true; data: T }
	| { ok: false; reason: string };

const DEFAULT_TIMEOUT_MS = 1500;

async function getJson<T>(url: string, timeoutMs: number): Promise<ServerResult<T>> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
		return { ok: true, data: (await res.json()) as T };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : "server unavailable" };
	} finally {
		clearTimeout(timer);
	}
}

export interface HealthLike {
	mode?: string;
	piVersion?: string;
	compatibility?: unknown;
	plugins?: unknown;
	[k: string]: unknown;
}

/** Fetch `/api/health`; `{ ok:false }` when the server is unreachable. */
export function fetchHealth(
	baseUrl: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServerResult<HealthLike>> {
	return getJson<HealthLike>(`${baseUrl.replace(/\/$/, "")}/api/health`, timeoutMs);
}

export interface PiCoreVersionsLike {
	installed?: string;
	latest?: string;
	installSource?: string;
	[k: string]: unknown;
}

/** Fetch `/api/pi-core/versions`; `{ ok:false }` when unreachable. */
export function fetchPiCoreVersions(
	baseUrl: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ServerResult<PiCoreVersionsLike>> {
	return getJson<PiCoreVersionsLike>(
		`${baseUrl.replace(/\/$/, "")}/api/pi-core/versions`,
		timeoutMs,
	);
}
