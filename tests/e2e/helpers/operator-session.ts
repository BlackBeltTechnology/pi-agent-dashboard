/**
 * Operator login-session for specs that call operate-authority routes
 * (`/api/vault*`, minting tokens).
 *
 * The harness browser reaches the container through a published port, so the
 * server sees the docker bridge address, never loopback, and a trusted-network
 * address alone never grants `operate`. The guard admits a browser only via a
 * dashboard login session (`authVia === "session"`). The harness seeds
 * `bypassUrls: ["/"]`, which returns from the auth hook BEFORE the cookie
 * branch, so this narrows it for the run and restores the snapshot afterwards.
 * Safe against racing: the suite runs `workers: 1`. The secret is the KNOWN e2e
 * constant seeded by `docker/test-entrypoint.sh` (PI_E2E_OAUTH=1).
 *
 * Same flow as `mcp-token-settings.spec.ts`; kept separate rather than
 * refactoring that spec. See change: add-credential-vault.
 */

import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { COOKIE_NAME, signToken } from "../../../packages/server/src/auth/auth.js";
import { BASE_URL } from "../lifecycle.js";

const E2E_AUTH_SECRET = "e2e-auth-secret-32-chars-longxxxx";
const SESSION_USER = { sub: "e2e@example.com", name: "e2e operator", username: "e2e", provider: "github" };

interface ConfigShape {
  data?: { trustedNetworks?: unknown; auth?: Record<string, unknown> };
}

export class OperatorSession {
  private token = "";
  private snapshot: { trustedNetworks?: unknown; auth?: Record<string, unknown> } | null = null;

  /** Cookie header for REST calls. */
  headers(): Record<string, string> {
    return { cookie: `${COOKIE_NAME}=${this.token}` };
  }

  private async readConfig(request: APIRequestContext): Promise<ConfigShape> {
    return (await (await request.get("/api/config", { headers: this.headers() })).json()) as ConfigShape;
  }

  /** Narrow the harness trust seed, mint the session token, and arm the browser cookie. */
  async arm(request: APIRequestContext, context: BrowserContext): Promise<void> {
    this.token = signToken(SESSION_USER, E2E_AUTH_SECRET);
    if (!this.snapshot) {
      const cur = await this.readConfig(request);
      this.snapshot = { trustedNetworks: cur.data?.trustedNetworks, auth: cur.data?.auth };
      await request.put("/api/config", {
        headers: this.headers(),
        data: { trustedNetworks: [], auth: { ...(cur.data?.auth ?? {}), bypassUrls: ["/v1/"] } },
      });
    }
    await context.addCookies([{ name: COOKIE_NAME, value: this.token, url: BASE_URL }]);
  }

  /** Put the harness config back exactly as it was snapshotted. */
  async restore(request: APIRequestContext): Promise<void> {
    if (!this.snapshot) return;
    const cur = await this.readConfig(request);
    await request.put("/api/config", {
      headers: this.headers(),
      data: {
        trustedNetworks: this.snapshot.trustedNetworks,
        auth: { ...(cur.data?.auth ?? {}), bypassUrls: this.snapshot.auth?.bypassUrls ?? ["/"] },
      },
    });
    this.snapshot = null;
  }
}
