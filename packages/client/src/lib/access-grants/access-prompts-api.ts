/**
 * Transport for the Access page's prompt surfaces (change:
 * add-access-grant-dialog, tasks 8.1-8.3). Server routes:
 * `packages/server/src/routes/access-prompt-routes.ts`.
 *
 * - `fetchAccessPrompts`  GET    /api/access/prompts
 * - `answerPendingPrompt` POST   /api/access/prompts/:promptId  (any pending
 *   entry, prompted or not, with prompting disabled or not)
 * - `clearRefusal`        DELETE /api/access/refusals?plane=&subject=
 * - `setPromptEnabled`    PUT    /api/config  { accessGrants: { promptEnabled } }
 *   (the same write path the Settings Save uses; `accessGrants` holds only
 *   this field, so the top-level replace loses nothing)
 */
import type {
  AccessPlaneId,
  GrantVerdict,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { getApiBase } from "../api/api-context.js";
import type { AccessPromptsView } from "./access-prompts-types.js";

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(`${getApiBase()}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T> | null;
  return { ok: res.ok && json?.success === true, status: res.status, data: json?.data, error: json?.error };
}

export function fetchAccessPrompts(): Promise<ApiResult<AccessPromptsView>> {
  return call<AccessPromptsView>("GET", "/api/access/prompts");
}

export function answerPendingPrompt(
  promptId: string,
  answer: { plane: AccessPlaneId; subject: string; verdict: GrantVerdict },
): Promise<ApiResult> {
  return call("POST", `/api/access/prompts/${encodeURIComponent(promptId)}`, answer);
}

export function clearRefusal(plane: AccessPlaneId, subject: string): Promise<ApiResult> {
  const q = new URLSearchParams({ plane, subject });
  return call("DELETE", `/api/access/refusals?${q.toString()}`);
}

export function setPromptEnabled(enabled: boolean): Promise<ApiResult> {
  return call("PUT", "/api/config", { accessGrants: { promptEnabled: enabled } });
}
