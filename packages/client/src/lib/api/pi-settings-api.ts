/**
 * Client API for pi's global settings.json editor (pi-agent-settings-editor
 * capability). Thin wrappers over `/api/pi-settings*`. A non-2xx answer throws
 * {@link PiSettingsApiError} carrying the HTTP status and the JSON body so the
 * section can tell a `409` conflict (payload = current state) from a `400`
 * validation failure from a `413` / `503` transport-level refusal.
 * See change: edit-pi-agent-settings.
 */
import type {
  PiLegacyCredential,
  PiLegacyCredentialsResponse,
  PiSettingsConflict,
  PiSettingsPatch,
  PiSettingsReadResponse,
  PiSettingsSyncResponse,
  PiSettingsWriteResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJsonResponse } from "./fetch-json.js";

export type {
  PiLegacyCredential,
  PiLegacyCredentialsResponse,
  PiSettingsConflict,
  PiSettingsPatch,
  PiSettingsReadResponse,
  PiSettingsSyncResponse,
  PiSettingsWriteResponse,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

/** Field-level error from a `400`. */
export interface PiSettingsFieldError {
  field: string;
  message: string;
}

export class PiSettingsApiError extends Error {
  readonly status: number;
  /** Parsed JSON body of the failed response. */
  readonly payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(typeof payload.error === "string" ? payload.error : `HTTP ${status}`);
    this.name = "PiSettingsApiError";
    this.status = status;
    this.payload = payload;
  }

  /** The `409` body (current server state), or null for other statuses. */
  get conflict(): PiSettingsConflict | null {
    return this.status === 409 ? (this.payload as unknown as PiSettingsConflict) : null;
  }

  /** Refreshed masked legacy-credential list carried by the legacy endpoint's `400` / `409` bodies. */
  get legacyCredentials(): PiLegacyCredential[] | null {
    const l = this.payload.legacyCredentials;
    return Array.isArray(l) ? (l as PiLegacyCredential[]) : null;
  }

  /** Per-field errors of a `400`, when the server sent them. */
  get fieldErrors(): PiSettingsFieldError[] {
    const e = this.payload.errors;
    return Array.isArray(e) ? (e as PiSettingsFieldError[]) : [];
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { res, json } = await fetchJsonResponse<Record<string, unknown>>(`${getApiBase()}${path}`, {
    credentials: "same-origin",
    ...init,
  });
  if (!res.ok || json.success === false) throw new PiSettingsApiError(res.status, json);
  return json as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const getPiSettings = (): Promise<PiSettingsReadResponse> => call("/api/pi-settings");

export const patchPiSettings = (patch: PiSettingsPatch, baseEtag: string): Promise<PiSettingsWriteResponse> =>
  call("/api/pi-settings", jsonInit("PUT", { patch, baseEtag }));

export const putPiSettingsRaw = (raw: string, baseEtag: string): Promise<PiSettingsWriteResponse> =>
  call("/api/pi-settings/raw", jsonInit("PUT", { raw, baseEtag }));

export const syncPiDefaults = (): Promise<PiSettingsSyncResponse> =>
  call("/api/pi-settings/sync-defaults", { method: "POST" });

/** Move or remove legacy plain-text API keys. Sends key PATHS only; the server returns the refreshed masked list. */
export const migrateLegacyCredentials = (
  actions: { key: string; action: "move" | "remove" }[],
  baseEtag: string,
): Promise<PiLegacyCredentialsResponse> =>
  call("/api/pi-settings/legacy-credentials", jsonInit("POST", { baseEtag, actions }));
