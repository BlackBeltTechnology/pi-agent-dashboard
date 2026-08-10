import { type APIRequestContext, expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";

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
 * WHY THE PROVIDER IS SEEDED AT CONTAINER BOOT, NOT BY THIS SPEC
 * --------------------------------------------------------------
 * `registerAuthPlugin` returns early when the boot-time provider registry is
 * empty ("Auth configured but no providers resolved — auth disabled") BEFORE
 * registering any `/auth/*` route and BEFORE installing `_reloadAuth`. So a
 * provider must be on disk BEFORE the server starts (design.md D6).
 *
 * An earlier revision of this spec tried to arrange that itself: seed via
 * `PUT /api/config`, then `POST /api/restart`. That CANNOT work here, and the
 * reason is worth recording because it is invisible from the spec:
 * `pi-state` is a RAM-backed tmpfs (`docker/compose.test.yml` — "ephemeral,
 * wiped each run"), mounted at `~/.pi`. Every container start therefore hands
 * the server a FRESH, EMPTY state dir and discards anything written through
 * the API. Observed directly: after the restart, `GET /api/config` reported
 * `auth: undefined`, `server.log` carried no auth line at all, and
 * `/auth/start/github` answered 200 (the SPA fallback) instead of 302.
 *
 * The seed therefore lives in `docker/test-entrypoint.sh` behind
 * `PI_E2E_OAUTH=1` (set by `tests/e2e/global-setup.ts`), which writes the
 * provider before the daemon launches — on every boot, so it survives restarts
 * by construction. No test in this file restarts the server.
 *
 * HARNESS SAFETY (read before editing)
 * ------------------------------------
 * Requests from the Playwright host arrive at the container as NON-loopback, so
 * arming OAuth without a bypass would auth-gate the SHARED harness and break
 * every spec that runs after this file. The boot seed writes
 * `auth.bypassUrls: ["/"]` alongside the provider: the prefix matches every
 * URL, so the gate registers its routes while denying nothing. `afterAll`
 * restores the seeded base so a later spec never inherits this file's edits.
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
    return null; // server unreachable
  }
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
  test.beforeAll(async ({ request }) => {
    const cfg = await request.get("/api/config");
    test.skip(!cfg.ok(), "/api/config unavailable — cannot read auth config");

    // The provider + bypass are already on disk (PI_E2E_OAUTH boot seed). If
    // they are not, the harness was started without that env: skip loudly
    // rather than fail with an unexplained 200 from `/auth/start`.
    const probe = await request.get(`/auth/start/${PROVIDER}`, { maxRedirects: 0 });
    test.skip(
      probe.status() !== 302,
      "no /auth/* routes — start the harness with PI_E2E_OAUTH=1 (see docker/test-entrypoint.sh)",
    );

    // Normalize the base to BASE_A through the hot-reload path this change
    // added, so each run starts from a known value regardless of test order.
    expect(
      (await request.put("/api/config", { data: { auth: { redirectBaseUrl: BASE_A } } })).ok(),
    ).toBe(true);
    await expect
      .poll(() => mintedRedirectUri(request), { timeout: 15_000, intervals: [250] })
      .toBe(`${BASE_A}/auth/callback/${PROVIDER}`);
  });

  test.afterAll(async ({ request }) => {
    // Restore the seeded base so a later spec never inherits this file's edits.
    // The provider itself is boot-seeded and intentionally left armed — its
    // `bypassUrls:["/"]` means the gate denies nothing.
    await request
      .put("/api/config", { data: { auth: { redirectBaseUrl: BASE_A } } })
      .catch(() => {});
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

    // `GET /api/config` answers the standard `{ success, data }` envelope —
    // reading `body.auth` directly yields undefined and silently "passes" only
    // because the value it compares against would also be undefined.
    const persisted = await request.get("/api/config");
    const body = (await persisted.json()) as {
      auth?: { redirectBaseUrl?: string };
      data?: { auth?: { redirectBaseUrl?: string } };
    };
    expect((body.data ?? body).auth?.redirectBaseUrl).toBe(BASE_A);
    expect(await mintedRedirectUri(request)).toBe(`${BASE_A}/auth/callback/${PROVIDER}`);
  });

  // F10 — the operator surface. Until this change the field was config-file
  // only: `writeConfigPartial` accepted the key and no UI ever sent it.
  test("F10: Settings ▸ Security persists the redirect base and /auth/start reflects it", async ({
    page,
    request,
  }) => {
    await gotoDashboard(page);
    await page.goto("/settings/security");
    const input = page.getByTestId("redirect-base-url-input");
    await input.waitFor({ state: "visible", timeout: 30_000 });

    await input.fill(BASE_B);
    await page.getByTestId("save-btn").click();

    await expect
      .poll(async () => {
        const body = (await (await request.get("/api/config")).json()) as {
          auth?: { redirectBaseUrl?: string };
          data?: { auth?: { redirectBaseUrl?: string } };
        };
        return (body.data ?? body).auth?.redirectBaseUrl;
      }, { timeout: 15_000, intervals: [500] })
      .toBe(BASE_B);

    await expect
      .poll(() => mintedRedirectUri(request), { timeout: 15_000, intervals: [250] })
      .toBe(`${BASE_B}/auth/callback/${PROVIDER}`);
  });
});
