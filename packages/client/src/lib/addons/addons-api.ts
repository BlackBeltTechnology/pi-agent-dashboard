/**
 * REST client for the Add-ons feature catalog and combined toggle.
 * See change: addons-hub-feature-catalog.
 */
import type {
	AddonFeature,
	AddonFolderInfo,
	AddonFolderToggleResponse,
	AddonToggleRequest,
	AddonToggleResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "../api/api-context.js";
import type { ResourceTrustOption } from "../api/resources-api.js";

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

// ── Folder mode. See change: addons-hub-folder-view. ──

export interface FolderAddonCatalog {
	features: AddonFeature[];
	folder: AddonFolderInfo;
}

/** GET /api/addons/catalog?scope=local&cwd= — features with per-folder state. A read: never trust-gated. */
export async function fetchFolderAddonCatalog(cwd: string): Promise<FolderAddonCatalog> {
	const res = await fetch(`${getApiBase()}/api/addons/catalog?scope=local&cwd=${encodeURIComponent(cwd)}`);
	const body = await res.json().catch(() => ({}));
	if (!res.ok || !body?.success) throw new Error(body?.error ?? `folder catalog request failed (${res.status})`);
	return {
		features: Array.isArray(body.features) ? (body.features as AddonFeature[]) : [],
		folder: body.folder ?? { cwd, looseCounts: { skills: 0, agents: 0, prompts: 0, extensions: 0, themes: 0 } },
	};
}

export type FolderToggleOutcome =
	| { kind: "ok"; report: AddonFolderToggleResponse }
	| {
			kind: "trust";
			message: string;
			options: ResourceTrustOption[];
			implicitlyTrusted: boolean;
			preselected?: "trust";
			dashboardSource?: string;
	  }
	| { kind: "error"; status: number; error: string };

/** POST /api/addons/:featureId/toggle with `scope: "local"`. Never throws on an HTTP error; network errors reject. */
export async function postFolderToggle(
	featureId: string,
	cwd: string,
	enabled: boolean,
	opts: { removeUnowned?: boolean } = {},
): Promise<FolderToggleOutcome> {
	const req: AddonToggleRequest = { scope: "local", cwd, enabled, ...(opts.removeUnowned ? { removeUnowned: true } : {}) };
	const res = await fetch(`${getApiBase()}/api/addons/${encodeURIComponent(featureId)}/toggle`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(req),
	});
	const body = await res.json().catch(() => ({}));
	if (res.ok && body?.success) return { kind: "ok", report: body as AddonFolderToggleResponse };
	if (res.status === 403 && body?.data?.trustRequired && Array.isArray(body.data.trustOptions)) {
		return {
			kind: "trust",
			message: body.error ?? "",
			options: body.data.trustOptions as ResourceTrustOption[],
			implicitlyTrusted: body.data.implicitlyTrusted === true,
			...(body.data.preselected ? { preselected: body.data.preselected } : {}),
			...(body.data.dashboardSource ? { dashboardSource: body.data.dashboardSource } : {}),
		};
	}
	return { kind: "error", status: res.status, error: body?.error ?? body?.reason ?? `toggle failed (${res.status})` };
}
