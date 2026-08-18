/**
 * Client-side fetch helpers for pi runtime discovery + selection.
 *
 *   GET  /api/pi/installs
 *   POST /api/pi/runtime   body: { spawn?: string | null, module?: string | null }
 *
 * The selection is ONE request carrying BOTH consumers: two sequential writes
 * can fail between them and leave the runtime split in half.
 *
 * See change: select-pi-runtime-install (design D7).
 */
import type {
  PiInstallsResponse,
  SetPiRuntimeRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export type {
  PiInstallEntry,
  PiInstallsResponse,
  SetPiRuntimeRequest,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export async function fetchPiInstalls(): Promise<PiInstallsResponse> {
  const json = await fetchJson(`${getApiBase()}/api/pi/installs`);
  if (!json.success) throw new Error(json.error ?? "failed to list pi installs");
  return json.data as PiInstallsResponse;
}

/** Apply both consumer selections atomically. `null` = Automatic. */
export async function setPiRuntime(
  selection: SetPiRuntimeRequest,
): Promise<PiInstallsResponse> {
  const json = await fetchJson(`${getApiBase()}/api/pi/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(selection),
  });
  if (!json.success) throw new Error(json.error ?? "failed to set pi runtime");
  return json.data as PiInstallsResponse;
}
