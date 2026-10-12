/**
 * Typed fetch wrappers for `GET /api/packages/health` and
 * `POST /api/packages/cleanup`. Both throw `PackageHealthApiError` carrying
 * the HTTP status and parsed response body so the UI can render the server's
 * message (and, for a 400, the offending `unknown` sources).
 *
 * See change: add-package-health-cleanup.
 */
import type {
	PackageCleanupResponse,
	PackageHealthListResponseData,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "../api/api-context.js";

export class PackageHealthApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body: unknown,
	) {
		super(message);
		this.name = "PackageHealthApiError";
	}
}

async function parse<T>(res: Response): Promise<T> {
	const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
	if (res.ok && body.success && body.data) return body.data;
	throw new PackageHealthApiError(body.error ?? `Request failed (${res.status})`, res.status, body);
}

export async function fetchPackageHealth(): Promise<PackageHealthListResponseData> {
	return parse(await fetch(`${getApiBase()}/api/packages/health`));
}

export async function applyPackageCleanup(drop: string[]): Promise<PackageCleanupResponse> {
	return parse(
		await fetch(`${getApiBase()}/api/packages/cleanup`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ drop }),
		}),
	);
}
