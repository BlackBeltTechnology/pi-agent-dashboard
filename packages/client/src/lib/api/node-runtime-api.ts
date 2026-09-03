/**
 * Client-side fetch helpers for Node family discovery + selection.
 *
 *   GET  /api/node/installs
 *   POST /api/node/installs/select   body: { root, discardHandSet? }
 *
 * The selection is ONE request writing the whole family (node+npm+npx)
 * atomically — see the pi picker's identical rationale.
 *
 * See change: add-node-runtime-family-selection.
 */
import type {
	NodeInstallsResponse,
	SelectNodeRuntimeRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export type {
	NodeInstallsResponse,
	SelectNodeRuntimeRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export async function fetchNodeInstalls(): Promise<NodeInstallsResponse> {
	const json = await fetchJson(`${getApiBase()}/api/node/installs`);
	if (!json.success) throw new Error(json.error ?? "failed to list node installs");
	return json.data as NodeInstallsResponse;
}

/** Select one installation; the server writes the family in ONE persist. */
export async function selectNodeRuntime(
	request: SelectNodeRuntimeRequest,
): Promise<void> {
	const json = await fetchJson(`${getApiBase()}/api/node/installs/select`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
	});
	if (!json.success) throw new Error(json.error ?? "failed to select node runtime");
}
