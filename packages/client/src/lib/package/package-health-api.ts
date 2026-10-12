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

class PackageHealthApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(
		message: string,
		status: number,
		body: unknown,
	) {
		super(message);
	  this.status = status;
	  this.body = body;
		this.name = "PackageHealthApiError";
	}
}

async function parse<T>(res: Response): Promise<T> {
	const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
	if (res.ok && body.success && body.data) return body.data;
	throw new PackageHealthApiError(body.error ?? `Request failed (${res.status})`, res.status, body);
}

export async function fetchPackageHealth(): Promise<PackageHealthListResponseData> {
	const res = await fetch(`${getApiBase()}/api/packages/health`);
	const data = await parse<PackageHealthListResponseData>(res);
	// Guard an older server / unexpected payload: the panel dereferences `entries`.
	if (!Array.isArray(data.entries)) throw new PackageHealthApiError("Malformed health response", res.status, data);
	return data;
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
