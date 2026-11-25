import { installGrantChannelFetch } from "../access-grants/grant-channel.js";
import { installCookieResetFetch } from "../live-preview/cookie-reset.js";
import { installDeviceAuthFetch } from "../pairing/device-auth.js";
import { installApiBaseFetch } from "./api-base-fetch.js";

/**
 * Install every global `fetch` wrapper in the ONE order that is safe. Each
 * install wraps the previous `window.fetch`, so the LAST installed runs FIRST:
 * `installApiBaseFetch` must be last so the credential wrappers see the
 * rewritten (possibly cross-origin) URL and never attach the local device
 * bearer / grant capability to a remote. Single seam shared by `main.tsx` and
 * the credential-isolation test, so a reorder cannot pass tests.
 * See change: fix-remote-relative-api-fetch.
 */
export function installFetchWrappers(): void {
  // Innermost: observes the real response (any 400 `duplicate_dashboard_cookie`) after every rewrite.
  installCookieResetFetch();
  installDeviceAuthFetch();
  installGrantChannelFetch();
  installApiBaseFetch();
}
