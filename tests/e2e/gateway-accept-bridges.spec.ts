/**
 * E2E (test-plan F8, change: prove-vault-bridge-tls, task 7.4): the Accept bridges
 * switch in the Gateway page's Built-in HTTPS section.
 *
 * F8  Built-in HTTPS on with a loopback bind (no certificates): toggling Accept
 *     bridges writes `tls.acceptBridges` for real, the switch is still on after a
 *     reload, no `wss://` endpoint is shown, and the `bind-reachable` fix is.
 *
 * Harness safety: the spec changes the stored `tls` block through the real
 * `PUT /api/config` and restores exactly what was there in `afterAll`, whatever
 * happened. Structure mirrors `gateway-url-action.spec.ts`.
 */
import { type APIRequestContext, expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { openGatewayPage } from "./helpers/remote-access.js";
import { BASE_URL } from "./lifecycle.js";

interface TlsSlice {
  enabled?: boolean;
  host?: string;
  acceptBridges?: boolean;
}

const op = new OperatorSession();

async function readTls(request: APIRequestContext): Promise<TlsSlice> {
  const res = await request.get("/api/config", { headers: op.headers() });
  expect(res.ok(), "/api/config must be readable").toBe(true);
  const body = (await res.json()) as { data?: { tls?: TlsSlice } };
  return body.data?.tls ?? {};
}

async function putTls(request: APIRequestContext, tls: TlsSlice): Promise<void> {
  const res = await request.put("/api/config", { headers: op.headers(), data: { tls } });
  expect(res.ok(), `PUT /api/config tls ${JSON.stringify(tls)}`).toBe(true);
}

test.describe.serial("Gateway — Accept bridges switch", () => {
  let original: TlsSlice = {};

  test.beforeEach(async ({ request, context }) => {
    await op.arm(request, context);
  });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      await request
        .put("/api/config", {
          headers: op.headers(),
          data: {
            tls: { enabled: original.enabled === true, host: original.host ?? "127.0.0.1", acceptBridges: original.acceptBridges === true },
          },
        })
        .catch(() => {});
    } finally {
      await request.dispose();
    }
  });

  test("F8: the switch persists across a reload, shows no wss:// on a loopback bind, and shows the bind-reachable fix", async ({
    page,
    request,
  }) => {
    original = await readTls(request);
    // Precondition: Built-in HTTPS on, loopback bind, no certificates, Accept bridges off.
    await putTls(request, { enabled: true, host: "127.0.0.1", acceptBridges: false });

    await gotoDashboard(page);
    await openGatewayPage(page);
    const section = page.getByTestId("gateway-tls");
    await expect(section).toBeVisible({ timeout: 30_000 });
    const sw = section.getByTestId("gateway-tls-accept-bridges");
    await expect(sw).toHaveAttribute("aria-checked", "false", { timeout: 20_000 });

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
    await expect(section.getByTestId("gateway-tls-bridges-error")).toHaveCount(0);

    // The write landed in the REAL config.
    await expect.poll(async () => (await readTls(request)).acceptBridges, { timeout: 15_000 }).toBe(true);

    // Reload: the switch is still on (read back from the server, not local state).
    await page.reload();
    const after = page.getByTestId("gateway-tls").getByTestId("gateway-tls-accept-bridges");
    await expect(after).toHaveAttribute("aria-checked", "true", { timeout: 30_000 });

    // Loopback bind: no bridge endpoint is advertised, and the bind-reachable fix is shown.
    const tls = page.getByTestId("gateway-tls");
    await expect(tls.getByTestId("gateway-tls-bridge-url")).toHaveCount(0);
    await expect(tls).not.toContainText("wss://");
    await expect(tls.getByTestId("gateway-tls-gate-bind-reachable")).toBeVisible();
  });
});
