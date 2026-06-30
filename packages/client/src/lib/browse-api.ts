/**
 * Client-side browse API helper for the PathPicker component.
 */
import type {
  BrowseFlagEntry,
  BrowseResult,
  MkdirResult,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";
import { fetchJson, fetchJsonResponse } from "./fetch-json.js";

/**
 * Thrown when a browse call is refused by the server's network guard
 * (HTTP 403 with `error: "network_not_allowed"`). Carries the server's
 * remedy `hint` so the UI can render an actionable surface instead of a
 * bare "Access denied". `code` lets callers branch without importing the
 * class (duck-typing survives module mocks).
 * See change: distinguish-offline-from-network-denied.
 */
export class NetworkNotAllowedError extends Error {
  readonly code = "network_not_allowed" as const;
  readonly hint?: string;
  readonly reason?: string;
  constructor(hint?: string, reason?: string) {
    super(hint ?? "network_not_allowed");
    this.name = "NetworkNotAllowedError";
    this.hint = hint;
    this.reason = reason;
  }
}

export interface BrowseOptions {
  /** Optional substring query. Empty / whitespace is treated as no filter. */
  q?: string;
  /** Optional AbortSignal to cancel in-flight requests. */
  signal?: AbortSignal;
}

export async function browseDirectory(
  path?: string,
  options?: BrowseOptions,
): Promise<BrowseResult> {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  const qTrim = (options?.q ?? "").trim();
  if (qTrim) params.set("q", qTrim);
  const qs = params.toString();
  const url = qs ? `${getApiBase()}/api/browse?${qs}` : `${getApiBase()}/api/browse`;

  // Use the response-preserving variant so a 403 policy-denial JSON body is
  // parsed (it carries `error: "network_not_allowed"` + `hint`) instead of
  // being collapsed into an opaque ApiHttpError. A non-JSON body (proxy HTML)
  // still throws ApiHttpError via the content-type guard inside.
  const { res, json } = await fetchJsonResponse(url, { signal: options?.signal });
  if (res.status === 403 && json?.error === "network_not_allowed") {
    throw new NetworkNotAllowedError(json.hint, json.reason);
  }
  if (!res.ok || !json?.success) {
    throw new Error(json?.error ?? `browse failed (HTTP ${res.status})`);
  }
  return json.data;
}

/**
 * Bulk-classify a list of absolute paths via `GET /api/browse/flags`.
 * Returns a `Record<path, { isGit, isPi }>`. Paths that fail to probe
 * server-side surface as `{ isGit: false, isPi: false }` — the call
 * itself never throws on per-path failures.
 *
 * The PathPicker uses this as its lazy second-phase fetch after the
 * fast `browseDirectory` enumeration completes.
 *
 * See change: split-browse-flags.
 */
export async function classifyPaths(
  paths: string[],
  options?: { signal?: AbortSignal },
): Promise<Record<string, BrowseFlagEntry>> {
  if (paths.length === 0) return {};
  const params = new URLSearchParams();
  params.set("paths", JSON.stringify(paths));
  const url = `${getApiBase()}/api/browse/flags?${params.toString()}`;
  const json = await fetchJson(url, { signal: options?.signal });
  if (!json.success) {
    throw new Error(json.error ?? "classify failed");
  }
  return json.data.flags;
}

/**
 * Create a new directory named `name` under `parent`.
 * Returns the absolute path of the new directory.
 */
export async function createDirectory(
  parent: string,
  name: string,
): Promise<MkdirResult> {
  const json = await fetchJson(`${getApiBase()}/api/browse/mkdir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent, name }),
  });
  if (!json.success) {
    throw new Error(json.error ?? "mkdir failed");
  }
  return json.data;
}
