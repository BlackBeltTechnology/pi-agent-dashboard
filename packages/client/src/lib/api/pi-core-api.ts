/**
 * Client-side fetch helpers for the `/api/pi-core/*` endpoint family.
 *
 * Today this file hosts only the changelog fetch — the existing
 * `usePiCoreVersions` hook fetches `/api/pi-core/versions` directly.
 * Future helpers (e.g. typed update calls) can land here.
 *
 * See change: pi-update-whats-new-panel.
 */
import { getApiBase } from "./api-context.js";
import type { ChangelogResponse } from "@blackbelt-technology/pi-dashboard-shared/changelog-types.js";

/**
 * Fetch the parsed changelog for a core package between two
 * versions. Throws on network error or non-2xx response — the hook
 * layer is responsible for catching and surfacing.
 */
export async function fetchPiChangelog(
  pkg: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<ChangelogResponse> {
  const url = `${getApiBase()}/api/pi-core/changelog?pkg=${encodeURIComponent(pkg)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = (body as { error?: string })?.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(
      detail
        ? `pi-changelog fetch failed (${res.status}): ${detail}`
        : `pi-changelog fetch failed (${res.status})`,
    );
  }
  return (await res.json()) as ChangelogResponse;
}
