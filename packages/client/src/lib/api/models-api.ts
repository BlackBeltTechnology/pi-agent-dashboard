/**
 * Client fetch helper for the session-independent model catalogue
 * (`GET /api/models`, credential-filtered — no `?annotated=1`).
 *
 * Returns a DISCRIMINATED result so a successful-but-empty catalogue is never
 * confused with a 503 / non-2xx / network failure: the whole point of the
 * Settings catalogue-unavailable callout is that those two states render
 * differently. See change: settings-default-model-without-session.
 */

import type { CatalogueModelRow } from "@blackbelt-technology/pi-dashboard-shared/model-catalogue.js";
import { catalogueRowToModelInfo } from "@blackbelt-technology/pi-dashboard-shared/model-catalogue.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "./api-context.js";
import { fetchJsonResponse } from "./fetch-json.js";

/** Client-side bound on a catalogue request; expiry renders as `unavailable`. */
const MODEL_CATALOGUE_TIMEOUT_MS = 10_000;

export type ModelCatalogueResult =
  | { status: "ok"; models: ModelInfo[] }
  | { status: "unavailable" };

/**
 * Fetch + project the catalogue. Never throws: any non-2xx status (including
 * `503 MODEL_PROXY_RUNTIME_MISSING`), non-JSON body, network failure, or a
 * request exceeding `MODEL_CATALOGUE_TIMEOUT_MS` resolves to `unavailable`.
 */
export async function fetchModelCatalogue(): Promise<ModelCatalogueResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Raced, not merely aborted: a transport that ignores the abort signal (or a
  // stubbed one) must still resolve the caller instead of hanging the loading
  // state forever.
  const timeout = new Promise<ModelCatalogueResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "unavailable" });
    }, MODEL_CATALOGUE_TIMEOUT_MS);
  });

  const request = (async (): Promise<ModelCatalogueResult> => {
    try {
      const { res, json } = await fetchJsonResponse<{ data?: CatalogueModelRow[] }>(
        `${getApiBase()}/api/models`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        return { status: "unavailable" };
      }
      return { status: "ok", models: (json?.data ?? []).map(catalogueRowToModelInfo) };
    } catch {
      return { status: "unavailable" };
    }
  })();

  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type ScopeCatalogueResult =
  | { status: "ok"; rows: { id: string; provider: string }[] }
  | { status: "unavailable" };

/**
 * The FULL annotated catalogue (`GET /api/models?annotated=1`), including models
 * of providers without credentials, as `{ id: "provider/modelId", provider }`
 * rows. Feeds the pi settings page's model-scope editor. Never throws: any
 * failure resolves to `unavailable`. See change: pi-settings-full-coverage (D7).
 */
export async function fetchScopeCatalogue(): Promise<ScopeCatalogueResult> {
  try {
    const { res, json } = await fetchJsonResponse<{ data?: { id?: unknown; provider?: unknown }[] }>(
      `${getApiBase()}/api/models?annotated=1`,
    );
    if (!res.ok || !Array.isArray(json?.data)) return { status: "unavailable" };
    const rows = json.data.flatMap((r) =>
      typeof r.id === "string" && typeof r.provider === "string" ? [{ id: r.id, provider: r.provider }] : [],
    );
    return { status: "ok", rows };
  } catch {
    return { status: "unavailable" };
  }
}
