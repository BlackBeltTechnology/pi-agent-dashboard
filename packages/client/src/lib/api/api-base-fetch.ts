import { getApiBase } from "./api-context.js";

/**
 * Wrap `window.fetch` once so a root-relative `/api/...` string request follows
 * the selected server. When the client is switched to a remote dashboard the
 * page stays on the local origin; plugin client code receives no API base and
 * calls `fetch("/api/...")`, which would otherwise hit the LOCAL server.
 *
 * Rewrites only `string` inputs starting with `/api/` (so not `//host/...`,
 * absolute URLs, `URL`, or `Request` — those express explicit intent), and only
 * while `getApiBase()` is non-empty. The base is read per call, so a server
 * switch needs no reinstall. Path, query and hash are preserved verbatim.
 *
 * ORDERING INVARIANT: install AFTER `installDeviceAuthFetch()` and
 * `installGrantChannelFetch()` (outermost). They then see the rewritten
 * cross-origin URL and do not attach the local device bearer / grant capability
 * to a remote. Idempotent via `window.__piApiBaseFetch`.
 * See change: fix-remote-relative-api-fetch.
 */
export function installApiBaseFetch(): void {
  const w = window as unknown as { __piApiBaseFetch?: boolean };
  if (w.__piApiBaseFetch) return;
  w.__piApiBaseFetch = true;

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (typeof input === "string" && input.startsWith("/api/")) {
      const base = getApiBase();
      if (base) return original(`${base}${input}`, init);
    }
    return original(input, init);
  };
}
