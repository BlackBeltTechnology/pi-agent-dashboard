import type { Locator, Page, Route } from "@playwright/test";
import { BASE_URL } from "../../lifecycle.js";

/**
 * Shared route-stub helpers for the retro-UX state fixtures. Every state is
 * reached by answering REST endpoints with `page.route` (never by seeding the
 * server), so the capture is client-only and deterministic.
 *
 * See change: retro-ux-identity-connectivity (design D2).
 */

/** `Access-Control-Allow-Origin` for fulfilled cross-origin probes (the selector fetches other servers directly). */
export const CORS = { "access-control-allow-origin": "*" } as const;

const hits = new Map<string, number>();

/** How many times the stub for `path` answered since the last `resetHits`. */
export function hitCount(path: string): number {
  return hits.get(path) ?? 0;
}

export function resetHits(): void {
  hits.clear();
}

const sameOrigin = (url: URL) => url.origin === new URL(BASE_URL).origin;

/**
 * Answer same-origin `path` (any method unless `method` is given) with `handler`.
 * The handler runs per request; a request it does not claim falls through.
 */
export async function stubApi(
  page: Page,
  path: string,
  handler: (route: Route, method: string) => Promise<void> | void,
  method?: string,
): Promise<void> {
  await page.route(
    (url) => sameOrigin(url) && url.pathname === path,
    async (route) => {
      const m = route.request().method();
      if (method && m !== method) return route.fallback();
      hits.set(path, (hits.get(path) ?? 0) + 1);
      await handler(route, m);
    },
  );
}

export const ok = (route: Route, data: unknown, extra: Record<string, unknown> = {}) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data, ...extra }) });

export const fail = (route: Route, error: string) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: false, error }) });

/** Never answers — the surface stays in its pending ("loading", "scanning", "checking") state. */
export const hold = (): Promise<void> => new Promise(() => {});

/** Settings section container, located by its `h2` title (the section's probe scope). */
export function settingsSection(page: Page, title: string): Locator {
  return page.getByRole("heading", { level: 2, name: title, exact: true }).locator("xpath=..");
}
