/**
 * Validate an uploaded `client_secret_*.json` (design D7 step 5). Only a
 * Desktop client (`installed` block) is accepted; a `web` block is rejected with
 * step-4 guidance. Pure — used by the wizard (instant feedback) AND the server
 * route (authoritative). See change: add-gmail-plugin.
 */

interface ParsedClient {
  clientId: string;
  clientSecret: string;
  projectId?: string;
}

type ClientJsonError =
  | { code: "not_json"; step: 5 }
  | { code: "web_client"; step: 4 }
  | { code: "not_installed"; step: 4 }
  | { code: "bad_client_id"; step: 4 }
  | { code: "missing_secret"; step: 5 };

export type ClientJsonResult = { ok: true; client: ParsedClient } | { ok: false; error: ClientJsonError };

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,200}\.apps\.googleusercontent\.com$/;

export function validateClientJson(input: string | unknown): ClientJsonResult {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      return { ok: false, error: { code: "not_json", step: 5 } };
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: { code: "not_json", step: 5 } };
  }
  const obj = data as Record<string, unknown>;
  const installed = obj.installed;
  if (!installed || typeof installed !== "object") {
    if (obj.web) return { ok: false, error: { code: "web_client", step: 4 } };
    return { ok: false, error: { code: "not_installed", step: 4 } };
  }
  const i = installed as Record<string, unknown>;
  if (typeof i.client_id !== "string" || !CLIENT_ID_RE.test(i.client_id)) {
    return { ok: false, error: { code: "bad_client_id", step: 4 } };
  }
  if (typeof i.client_secret !== "string" || !i.client_secret.trim() || i.client_secret.length > 500) {
    return { ok: false, error: { code: "missing_secret", step: 5 } };
  }
  const client: ParsedClient = { clientId: i.client_id, clientSecret: i.client_secret };
  if (typeof i.project_id === "string" && /^[a-z][a-z0-9-]{4,62}$/.test(i.project_id)) client.projectId = i.project_id;
  return { ok: true, client };
}
