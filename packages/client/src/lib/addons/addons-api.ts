/**
 * REST client for the Add-ons feature catalog and combined toggle.
 * See change: addons-hub-feature-catalog.
 */
import type {
	AddonFeature,
	AddonToggleRequest,
	AddonToggleResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "../api/api-context.js";

export async function fetchAddonCatalog(): Promise<AddonFeature[]> {
	const res = await fetch(`${getApiBase()}/api/addons/catalog`);
	const body = await res.json();
	if (!res.ok || !body?.success) throw new Error(body?.error ?? `catalog request failed (${res.status})`);
	return Array.isArray(body.features) ? (body.features as AddonFeature[]) : [];
}

export type ToggleOutcome =
	| { kind: "ok"; report: AddonToggleResponse }
	| { kind: "stale"; report: AddonToggleResponse }
	| { kind: "error"; status: number; reason?: string; error: string; blockers?: string[] };

/** POST /api/addons/:featureId/toggle. Never throws on an HTTP error; network errors reject. */
export async function postAddonToggle(featureId: string, req: AddonToggleRequest): Promise<ToggleOutcome> {
	const res = await fetch(`${getApiBase()}/api/addons/${encodeURIComponent(featureId)}/toggle`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(req),
	});
	const body = await res.json().catch(() => ({}));
	if (res.ok && body?.success) return { kind: "ok", report: body as AddonToggleResponse };
	if (res.status === 409 && body?.reason === "stale-confirmation") return { kind: "stale", report: body as AddonToggleResponse };
	return {
		kind: "error",
		status: res.status,
		reason: body?.reason,
		error: body?.error ?? body?.reason ?? `toggle failed (${res.status})`,
		blockers: body?.blockers,
	};
}
