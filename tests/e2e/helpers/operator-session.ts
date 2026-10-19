/**
 * Operator login-session for specs that call operate-authority routes
 * (`/api/vault*`, minting tokens).
 *
 * The harness browser reaches the container through a published port, so the
 * server sees the docker bridge address, never loopback, and a trusted-network
 * address alone never grants `operate`. The guard admits a browser only via a
 * dashboard login session (`authVia === "session"`). The harness seeds
 * `bypassUrls: ["/"]`, which returns from the auth hook BEFORE the cookie
 * branch, so this narrows it for the test through `narrowTrust` (restored per
 * test by the reap fixture). The secret is the KNOWN e2e constant seeded by
 * `docker/test-entrypoint.sh` (PI_E2E_OAUTH=1), kept in `./trust-access.ts`.
 *
 * See changes: add-credential-vault, triage-browser-e2e-offbox-poison.
 */

import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { COOKIE_NAME } from "../../../packages/server/src/auth/auth.js";
import { narrowTrust } from "../fixtures.js";
import { BASE_URL } from "../lifecycle.js";
import { operatorHeaders } from "./trust-access.js";

export class OperatorSession {
  private token = "";

  /** Cookie header for REST calls. */
  headers(): Record<string, string> {
    return operatorHeaders();
  }

  /**
   * Narrow the harness trust seed (test scope) and arm the browser cookie.
   * There is deliberately no `restore()`: `narrowTrust` registers its own, and
   * the reap fixture runs it straight after the test body — on failure and
   * timeout too, where an `afterAll`/`afterEach` hook did not (#832).
   */
  async arm(request: APIRequestContext, context: BrowserContext): Promise<void> {
    this.token = operatorHeaders().cookie.slice(`${COOKIE_NAME}=`.length);
    await narrowTrust(request, { trustedNetworks: [], auth: { bypassUrls: ["/v1/"] } });
    await context.addCookies([{ name: COOKIE_NAME, value: this.token, url: BASE_URL }]);
  }
}
