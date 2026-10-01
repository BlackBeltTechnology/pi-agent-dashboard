/**
 * Client helper for plugin OAuth flows: `status` / `input` / `cancel` over the
 * host's `/api/provider-auth/flow/:flowId` routes, so plugin clients never
 * hard-code paths. Pair with the `ui:oauth-flow` primitive.
 * See change: expose-plugin-credential-and-oauth-seams (D3).
 */
import type { OAuthFlowStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

export interface OAuthFlowClient {
  /** Current status; rejects on 404 (unknown / pruned flow) or any non-2xx. */
  status(flowId: string): Promise<OAuthFlowStatus>;
  /** Answer the pending prompt. The value is never echoed back. */
  input(flowId: string, value: string): Promise<void>;
  cancel(flowId: string): Promise<void>;
}

const flowUrl = (flowId: string) => `/api/provider-auth/flow/${encodeURIComponent(flowId)}`;

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch { /* non-JSON error body */ }
  throw new Error(message);
}

export function createOAuthFlowClient(fetchFn: typeof fetch = (...a) => fetch(...a)): OAuthFlowClient {
  return {
    async status(flowId) {
      const res = await ensureOk(await fetchFn(flowUrl(flowId)));
      return (await res.json()) as OAuthFlowStatus;
    },
    async input(flowId, value) {
      await ensureOk(
        await fetchFn(`${flowUrl(flowId)}/input`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value }),
        }),
      );
    },
    async cancel(flowId) {
      await ensureOk(await fetchFn(flowUrl(flowId), { method: "DELETE" }));
    },
  };
}

/** Default client over the global `fetch`. */
export const oauthFlowClient: OAuthFlowClient = createOAuthFlowClient();
