import { type APIRequestContext, expect, test } from "@playwright/test";

/**
 * Browser/container E2E for change `config-override-oauth-redirect-base`
 * (review of PR #409). Test-plan rows F1, F2 (+ the localhost-fallback tail).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The vitest suite (`packages/server/src/__tests__/auth-redirect-base.test.ts`)
 * covers precedence and route wiring in-process. It cannot prove the chain that
 * actually breaks in production: a value written to a REAL config file on disk,
 * read by a REAL server process, producing a REAL 302 whose `Location` carries
 * the override — and then changing without a restart.
 *
 * WHY THIS SPEC RESTARTS THE SERVER
 * ---------------------------------
 * `registerAuthPlugin` returns early when the boot-time provider registry is
 * empty ("Auth configured but no providers resolved — auth disabled") BEFORE
 * registering any `/auth/*` route and BEFORE installing `_reloadAuth`. The
 * harness boots with zero providers, so `/auth/start/github` does not exist
 * until a provider is seeded AND the server is restarted. See design.md D6.
 *
 * HARNESS SAFETY (read before editing)
 * ------------------------------------
 * Requests from the Playwright host arrive at the container as NON-loopback, so
 * arming OAuth without a bypass would auth-gate the shared harness and break
 * every spec that runs after this file. Two mitigations, both load-bearing:
 *   1. `auth.bypassUrls: ["/"]` is seeded alongside the provider, so the gate
 *      matches every URL and denies nothing while this file runs.
 *   2. `afterAll` blanks the provider credentials (the providers map is
 *      additive-only in `writeConfigPartial` — a provider can be blanked but
 *      never deleted), clears the override, restores the bypass list, and
 *      restarts. With no resolvable provider the auth plugin no-ops entirely.
 */

const PROVIDER = "github";
const BASE_A = "https://pi-e2e-a.example.com";
const BASE_B = "https://pi-e2e-b.example.com";

/** `{ pid, startedAt }` identifying the current server process, or null while down. */
async function serverIdentity(
  request: APIRequestContext,
): Promise<{ pid: number; startedAt: string } | null> {
  try {
    const res = await request.get("/api/health", { timeout: 5_000 });
    if (!res.ok()) return null;
    const body = (await res.json()) as { pid?: number; startedAt?: string };
    return body.pid == null ? null : { pid: body.pid, startedAt: body.startedAt! };
  } catch {
    return null; // mid-restart: connection refused
  }
}

/** POST /api/restart and wait until a DIFFERENT server process answers /api/health. */
async function restartServer(request: APIRequestContext): Promise<void> {
  const before = await serverIdentity(request);
  expect(before, "server identity must be readable before restart").not.toBeNull();

  await request.post("/api/restart", { timeout: 10_000 }).catch(() => {
    // The server tears the socket down mid-response; a transport error here is
    // the expected shape of a successful restart request.
  });

  await expect
    .poll(
      async () => {
        const now = await serverIdentity(request);
        return now !== null && (now.pid !== before!.pid || now.startedAt !== before!.startedAt);
      },
      { timeout: 120_000, intervals: [500] },
    )
    .toBe(true);
}

/** Read the `redirect_uri` the server mints for a provider, without following it. */
async function mintedRedirectUri(
  request: APIRequestContext,
  provider = PROVIDER,
): Promise<string> {
  const res = await request.get(`/auth/start/${provider}`, { maxRedirects: 0 });
  expect(res.status(), "auth start must redirect to the provider").toBe(302);
  const location = res.headers()["location"];
  expect(location, "302 must carry a Location header").toBeTruthy();
  return new URL(location).searchParams.get("redirect_uri") ?? "";
}

test.describe.serial("config-override-oauth-redirect-base", () => {
  let originalBypassUrls: string[] = [];

  test.beforeAll(async ({ request }) => {
    const cfg = await request.get("/api/config");
    test.skip(!cfg.ok(), "/api/config unavailable — cannot seed auth config");
    const body = (await cfg.json()) as { auth?: { bypassUrls?: string[] } };
    originalBypassUrls = body.auth?.bypassUrls ?? [];

    // Seed a resolvable provider (github needs no OIDC discovery, so it
    // resolves with no outbound network) + the override + the "deny nothing"
    // bypass, then restart so the auth plugin actually registers its routes.
    const seeded = await request.put("/api/config", {
      data: {
        auth: {
          providers: { [PROVIDER]: { clientId: "e2e-client-id", clientSecret: "e2e-client-secret" } },
          bypassUrls: ["/"],
          redirectBaseUrl: BASE_A,
        },
      },
    });
    expect(seeded.ok(), "seeding auth config must succeed").toBe(true);
    await restartServer(request);
  });

  test.afterAll(async ({ request }) => {
    // Disarm before any other spec file runs. Blanking the credentials empties
    // the resolvable registry, so after the restart the auth plugin no-ops and
    // the harness is exactly as unguarded as it was before this file.
    await request
      .put("/api/config", {
        data: {
          auth: {
            providers: { [PROVIDER]: { clientId: "", clientSecret: "" } },
            bypassUrls: originalBypassUrls,
            redirectBaseUrl: "",
          },
        },
      })
      .catch(() => {});
    await restartServer(request).catch(() => {});
  });

  // F1 — the config file on disk reaches a real 302 Location.
  test("F1: a configured redirectBaseUrl drives the emitted redirect_uri", async ({ request }) => {
    expect(await mintedRedirectUri(request)).toBe(`${BASE_A}/auth/callback/${PROVIDER}`);
  });

  // F1b — the single-provider auto-redirect on /auth/login is a SECOND call
  // site with its own buildRedirectUri() call. Exactly one provider is seeded,
  // so this path auto-redirects instead of rendering the picker.
  test("F1b: /auth/login auto-redirect carries the same base", async ({ request }) => {
    const res = await request.get("/auth/login", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const uri = new URL(res.headers()["location"]).searchParams.get("redirect_uri");
    expect(uri).toBe(`${BASE_A}/auth/callback/${PROVIDER}`);
  });

  // F2 — the hot-reload chain, end to end, with no restart:
  // PUT /api/config → writeConfigPartial → loadConfig → _reloadAuth → route.
  test("F2: changing the override takes effect without a restart", async ({ request }) => {
    const before = await serverIdentity(request);

    const res = await request.put("/api/config", {
      data: { auth: { redirectBaseUrl: BASE_B } },
    });
    expect(res.ok()).toBe(true);

    await expect
      .poll(() => mintedRedirectUri(request), { timeout: 15_000, intervals: [250] })
      .toBe(`${BASE_B}/auth/callback/${PROVIDER}`);

    // Same process — this proves reload, not a silent restart.
    const after = await serverIdentity(request);
    expect(after?.pid).toBe(before?.pid);
    expect(after?.startedAt).toBe(before?.startedAt);
  });

  // Tail of the precedence chain, observed through the real server: with the
  // override cleared and no tunnel active in the harness, the URI must fall
  // back to localhost — and must NOT become the relative "/auth/callback/..."
  // that a `??` instead of `||` would produce.
  test("F2b: clearing the override falls back to the localhost base", async ({ request }) => {
    const res = await request.put("/api/config", {
      data: { auth: { redirectBaseUrl: "" } },
    });
    expect(res.ok()).toBe(true);

    await expect
      .poll(() => mintedRedirectUri(request), { timeout: 15_000, intervals: [250] })
      .toMatch(/^http:\/\/localhost:\d+\/auth\/callback\/github$/);
  });

  // Unrelated auth writes must not silently drop the override (the failure mode
  // that `fix-trusted-networks-no-oauth` already had to repair once for
  // bypassHosts/bypassUrls in the same merge block).
  test("F2c: an unrelated auth write preserves the override", async ({ request }) => {
    expect((await request.put("/api/config", { data: { auth: { redirectBaseUrl: BASE_A } } })).ok()).toBe(true);
    await expect
      .poll(() => mintedRedirectUri(request), { timeout: 15_000, intervals: [250] })
      .toBe(`${BASE_A}/auth/callback/${PROVIDER}`);

    // Write a DIFFERENT auth field, omitting redirectBaseUrl entirely.
    expect((await request.put("/api/config", { data: { auth: { allowedUsers: [] } } })).ok()).toBe(true);

    const persisted = await request.get("/api/config");
    const body = (await persisted.json()) as { auth?: { redirectBaseUrl?: string } };
    expect(body.auth?.redirectBaseUrl).toBe(BASE_A);
    expect(await mintedRedirectUri(request)).toBe(`${BASE_A}/auth/callback/${PROVIDER}`);
  });
});
