/**
 * REST client of the managed-services layer (`/api/services*`).
 *
 * Every helper resolves to a `ServicesResult` — never throws — so the pages can
 * show the server's error code and hint at the action that failed, and render a
 * 403 `operate_required` with its remedies instead of a toast. No helper ever
 * receives or returns a secret value except `setSecret`, which only SENDS one.
 * See change: add-services-settings-ui.
 */
import type {
  AddReview,
  LogsResponse,
  OffersResponse,
  PruneRequest,
  PruneResult,
  ResetDataResult,
  RuntimeReport,
  ServiceList,
  ServiceStatus,
  VolumeOutcome,
} from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { getApiBase } from "../api/api-context.js";
import { ApiHttpError, fetchJsonResponse } from "../api/fetch-json.js";
import { t as i18nT } from "../i18n/i18n.js";

export interface ServicesResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  /** Server `message` (or a client-side description). */
  error?: string;
  /** Machine code: the envelope's `error` (`operate_required`, `invalid-tail`, …) or `transport` / `network`. */
  code?: string;
  /** `operate_required` only: what the caller can do about it, server order. Unvalidated. */
  remedies?: unknown[];
  /** `operate_required` only. */
  reason?: string;
  /** Dry-run / validation errors arrive joined with `; `. */
  hint?: string;
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  remedies?: unknown[];
  reason?: string;
}

const fail = <T>(status: number, code: string, error: string): ServicesResult<T> => ({ ok: false, status, code, error });

function transportFailure<T>(err: unknown): ServicesResult<T> {
  if (!(err instanceof ApiHttpError)) return fail(0, "network", i18nT("services.networkError", undefined, "Can't reach the dashboard server"));
  // A 2xx that is not JSON is the SPA shell answering an /api route this server does not have.
  if (err.status >= 200 && err.status < 300) {
    return fail(err.status, "server_outdated", i18nT("services.serverOutdated", undefined, "This dashboard server does not have the services API yet."));
  }
  return fail(err.status, "transport", `HTTP ${err.status}${err.statusText ? ` ${err.statusText}` : ""}`);
}

function fromEnvelope<T>(res: Response, env: Envelope<T>): ServicesResult<T> {
  return {
    ok: res.ok && env.success === true,
    status: res.status,
    data: env.data,
    error: env.message ?? env.error,
    code: env.success === true ? undefined : env.error,
    remedies: Array.isArray(env.remedies) ? env.remedies : undefined,
    reason: typeof env.reason === "string" ? env.reason : undefined,
  };
}

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<ServicesResult<T>> {
  try {
    const { res, json } = await fetchJsonResponse<Envelope<T>>(`${getApiBase()}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return fromEnvelope(res, json);
  } catch (err) {
    return transportFailure(err);
  }
}

const enc = encodeURIComponent;

export type ServiceVerb = "start" | "stop" | "retry" | "pin" | "unpin" | "prefetch";

export const listServices = () => call<ServiceList>("GET", "/api/services");
/** Probes a running instance — only on opening a detail and on an explicit Refresh. */
export const getService = (id: string) => call<ServiceStatus>("GET", `/api/services/${enc(id)}`);
export const listOffers = () => call<OffersResponse>("GET", "/api/services/offers");
export const getRuntimes = () => call<RuntimeReport[]>("GET", "/api/services/runtimes");

export const runVerb = (id: string, verb: ServiceVerb, body?: { force?: boolean }) =>
  call<unknown>("POST", `/api/services/${enc(id)}/${verb}`, body ?? {});

export interface AddResponse {
  dryRun: boolean;
  review: AddReview;
  secrets?: Record<string, { configured: boolean }>;
}
export type AddSource = { offer: string; update?: boolean } | { definition: unknown };
export const addService = (source: AddSource, dryRun: boolean) => call<AddResponse>("POST", "/api/services", { ...source, dryRun });

export interface RemoveResponse {
  ok: boolean;
  hint?: string;
  volumes?: VolumeOutcome[];
}
/** `purgeData` is sent ONLY when true — the default Remove never carries it. */
export const removeService = (id: string, purgeData: boolean) =>
  call<RemoveResponse>("DELETE", `/api/services/${enc(id)}${purgeData ? "?purgeData=true" : ""}`);

export const setSecret = (id: string, name: string, value: string) =>
  call<{ configured: true }>("PUT", `/api/services/${enc(id)}/secrets/${enc(name)}`, { value });

export const getLogs = (id: string, tail: number) => call<LogsResponse>("GET", `/api/services/${enc(id)}/logs?tail=${tail}`);
export const resetData = (id: string) => call<ResetDataResult>("POST", `/api/services/${enc(id)}/reset-data`, {});
export const prune = (req: PruneRequest) => call<PruneResult>("POST", "/api/services/prune", req);
