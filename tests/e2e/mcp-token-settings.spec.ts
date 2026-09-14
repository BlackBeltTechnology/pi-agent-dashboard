/**
 * E2E: the Settings → Paired Devices MCP-client token flow (change:
 * mcp-legacy-clients-and-token-issuance, test-plan F1/F2/F3).
 *
 * Everything runs against the REAL harness: the real registry file mutates,
 * the minted bearer is real, and the legacy-era `/mcp` handshake proves the
 * token actually works — then stops working after revoke.
 *
 * F1  create → token + copy-ready `claude mcp add` snippet, host = page origin.
 * F2  dismiss → token unrecoverable, row listed as manually issued.
 * F3  revoke → row gone, and the token no longer authenticates on `/mcp`.
 */

import { COOKIE_NAME, signToken } from "../../packages/server/src/auth/auth.js";
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * The operator guard (D5) admits a browser ONLY via a dashboard login session
 * (`authVia === "session"`): the harness browser's peer is the docker gateway
 * IP, never loopback, and a trusted-network address alone must never mint
 * (X5). The shared harness seeds `bypassUrls: ["/"]`, which returns from the
 * auth hook BEFORE the cookie branch — so the spec narrows it for the duration
 * of the run (the `request` fixture keeps clearing the gate via its own
 * cookie) and restores it afterwards. Safe against racing: the suite runs with
 * `workers: 1`, one spec at a time. The secret is the KNOWN e2e constant
 * seeded by `docker/test-entrypoint.sh` (PI_E2E_OAUTH=1).
 */
const E2E_AUTH_SECRET = "e2e-auth-secret-32-chars-longxxxx";
const SESSION_USER = { sub: "e2e@example.com", name: "e2e operator", username: "e2e", provider: "github" };
/** The seed value written by docker/test-entrypoint.sh (PI_E2E_SEED=1). */
const SEEDED_TRUSTED_NETWORKS = ["0.0.0.0/0"];

let sessionToken = "";

function authedHeaders() {
  return { cookie: `${COOKIE_NAME}=${sessionToken}` };
}

async function readConfig(request: import("@playwright/test").APIRequestContext) {
  return (await (await request.get("/api/config", { headers: authedHeaders() })).json()) as {
    data?: { auth?: Record<string, unknown> };
  };
}

/**
 * Narrow the harness's trust-any seed so the auth hook actually runs the
 * cookie branch for the browser (`bypassHosts` from trust-any trustedNetworks
 * otherwise returns BEFORE the cookie validation, so `authVia` never lands).
 * Restored verbatim in afterAll. Safe against racing: `workers: 1`.
 */
async function armOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  sessionToken = signToken(SESSION_USER, E2E_AUTH_SECRET);
  const cur = await readConfig(request);
  await request.put("/api/config", {
    headers: authedHeaders(),
    data: {
      trustedNetworks: [],
      auth: { ...(cur.data?.auth ?? {}), bypassUrls: ["/v1/"] },
    },
  });
}

async function restoreOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const cur = await readConfig(request);
  await request.put("/api/config", {
    headers: authedHeaders(),
    data: {
      trustedNetworks: SEEDED_TRUSTED_NETWORKS,
      auth: { ...(cur.data?.auth ?? {}), bypassUrls: ["/"] },
    },
  });
}

const SECTION_TITLE = "Paired Devices";
const CREATE_BUTTON = "Create token for an MCP client";
const LABEL = "Token label";
const CREATE = "Create";
const DISMISS = "Dismiss";
const REVOKE = "Revoke device";

async function gotoPairedDevices(page: import("@playwright/test").Page): Promise<void> {
  await gotoDashboard(page);
  await page.goto("/settings/security");
  await expect(page.getByRole('heading', { name: SECTION_TITLE })).toBeVisible({ timeout: 20_000 });
}

test.describe("MCP client token — Settings flow", () => {
  test.beforeEach(async ({ request, context }) => {
    await armOperatorSession(request);
    // The mint route needs a login-session browser (D5); the harness browser is
    // never loopback-sourced, so arm the seeded-secret session cookie.
    await context.addCookies([{ name: COOKIE_NAME, value: sessionToken, url: BASE_URL }]);
  });

  test.afterAll(async ({ request }) => {
    await restoreOperatorSession(request);
  });
  test("F1 — create flow shows a copy-ready snippet whose host matches the page origin", async ({
    page,
  }) => {
    await gotoPairedDevices(page);

    await page.getByText(CREATE_BUTTON).click();
    const input = page.getByLabel(LABEL);
    await input.fill("claude-code");
    await page.getByRole("button", { name: CREATE }).click();

    // The snippet: one code element matching the exact claude-command shape.
    const panel = page.getByTestId("mcp-token-result");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const snippet = panel.locator("code", { hasText: "claude mcp add" }).first();
    await expect(snippet).toBeVisible();
    const snippetText = (await snippet.textContent()) ?? "";
    const origin = new URL(page.url()).origin;
    expect(snippetText).toMatch(
      /^claude mcp add --transport http \S+ https?:\/\/[^/]+\/mcp --header "Authorization: Bearer [A-Za-z0-9_-]{32,}"$/,
    );
    // The snippet's host equals the origin the page was loaded from.
    expect(new URL(snippetText.match(/https?:\/\/[^/]+/)?.[0] ?? "").origin).toBe(origin);

    // The separate token element carries the SAME bearer as the snippet.
    const tokenInSnippet = snippetText.match(/Bearer ([A-Za-z0-9_-]+)/)?.[1] ?? "";
    const tokenEl = panel.locator("code", { hasText: tokenInSnippet }).first();
    expect(((await tokenEl.textContent()) ?? "").trim()).toBe(tokenInSnippet);
  });

  test("F2 — the token is not shown again after dismissal; the row is marked manual", async ({
    page,
    request,
  }) => {
    await gotoPairedDevices(page);

    await page.getByText(CREATE_BUTTON).click();
    await page.getByLabel(LABEL).fill("claude-code");
    await page.getByRole("button", { name: CREATE }).click();
    const snippet = page.locator("code", { hasText: "claude mcp add" }).first();
    await expect(snippet).toBeVisible({ timeout: 20_000 });
    const token = (await snippet.textContent())?.match(/Bearer ([A-Za-z0-9_-]+)/)?.[1] ?? "";
    expect(token.length).toBeGreaterThanOrEqual(32);

    await page.getByRole("button", { name: DISMISS }).click();

    // The token is unrecoverable from the DOM.
    await expect(page.getByText(CREATE_BUTTON)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(token)).toHaveCount(0);
    expect((await page.locator("body").textContent()) ?? "").not.toContain(token);

    // The list now has a claude-code row with a manual badge.
    const row = page.locator("li", { hasText: "claude-code" }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText("manual")).toBeVisible();

    // …and the REAL registry agrees.
    const devicesRes = await request.get("/api/paired-devices", { headers: authedHeaders() });
    const devices = (await devicesRes.json()).data as Array<{ label: string; source: string }>;
    expect(devices.some((d) => d.label === "claude-code" && d.source === "manual")).toBe(true);
  });

  test("F3 — a manual row is revocable and the token stops authenticating", async ({
    page,
    request,
  }) => {
    await gotoPairedDevices(page);

    // Mint through the UI (the same flow F1 exercises).
    await page.getByText(CREATE_BUTTON).click();
    await page.getByLabel(LABEL).fill("claude-code");
    await page.getByRole("button", { name: CREATE }).click();
    const snippet = page.locator("code", { hasText: "claude mcp add" }).first();
    await expect(snippet).toBeVisible({ timeout: 20_000 });
    const token = (await snippet.textContent())?.match(/Bearer ([A-Za-z0-9_-]+)/)?.[1] ?? "";
    await page.getByRole("button", { name: DISMISS }).click();

    // The token WORKS on /mcp before revoke (legacy era, header only).
    const before = await request.post("/mcp", {
      headers: {
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2025-06-18",
        "content-type": "application/json",
        ...authedHeaders(),
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(before.status()).toBe(200);

    // Revoke the claude-code row(s) (confirm step, same as pairing rows).
    // F1/F2 minted rows earlier in this run, so drain all of them.
    for (;;) {
      const row = page.locator("li", { hasText: "claude-code" }).first();
      if ((await row.count()) === 0) break;
      await row.getByTitle(REVOKE).click();
      await row.getByText("Confirm revoke").click();
      // Assert THIS row detaches, not a count computed from the DOM.
      await expect(row).toHaveCount(0, { timeout: 20_000 });
    }
    await expect(page.locator("li", { hasText: "claude-code" })).toHaveCount(0, { timeout: 20_000 });

    // The token no longer authenticates on /mcp.
    const after = await request.post("/mcp", {
      headers: {
        authorization: `Bearer ${token}`,
        "mcp-protocol-version": "2025-06-18",
        "content-type": "application/json",
        ...authedHeaders(),
      },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(after.status()).toBe(401);
  });
});
