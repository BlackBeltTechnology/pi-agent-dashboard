/**
 * Client API for pi's agent-level retry policy (pi-retry-settings capability).
 * Thin wrappers over GET/PUT /api/pi-retry. See change:
 * retry-forever-with-stop-control.
 */
import type {
  GetPiRetryPolicyResponse,
  PiRetryPolicy,
  PutPiRetryPolicyResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJson } from "./fetch-json.js";

export type {
  PiRetryPolicy,
  PiRetryProviderPolicy,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

/** pi's own defaults — shown until the user opts in. `provider.timeoutMs` absent = SDK default. */
export const PI_RETRY_DEFAULTS: PiRetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2000,
  provider: { maxRetries: 0, maxRetryDelayMs: 60000 },
};

export async function getPiRetryPolicy(): Promise<PiRetryPolicy> {
  const json = await fetchJson<GetPiRetryPolicyResponse>(`${getApiBase()}/api/pi-retry`, {
    credentials: "same-origin",
  });
  // `ApiResponse<T>` carries `data?: T`, so a `success` check alone does not
  // narrow it — guard the payload too.
  if (!json.success || !json.data) throw new Error(json.error ?? "Failed to read retry policy");
  return json.data;
}

export interface PutPiRetryResult {
  policy: PiRetryPolicy;
  reloadedSessions: number;
}

export async function putPiRetryPolicy(policy: PiRetryPolicy): Promise<PutPiRetryResult> {
  const json = await fetchJson<PutPiRetryPolicyResponse>(`${getApiBase()}/api/pi-retry`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(policy),
  });
  if (!json.success || !json.data) throw new Error(json.error ?? "Failed to save retry policy");
  return json.data;
}
