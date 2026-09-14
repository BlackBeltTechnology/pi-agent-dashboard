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

let sessionToken = "";
/** SNAPSHOT of the harness config taken BEFORE the first mutation; afterAll
 * restores exactly what was captured (a reused, differently-seeded harness
 * must never be left with our narrowed trust-any values). */
let preTestConfig: { trustedNetworks?: unknown; auth?: Record<string, unknown> } | null = null;

function authedHeaders() {
  return { cookie: `${COOKIE_NAME}=${sessionToken}` };
}

async function readConfig(request: import("@playwright/test").APIRequestContext) {
  return (await (await request.get("/api/config", { headers: authedHeaders() })).json()) as {
    data?: { trustedNetworks?: unknown; auth?: Record<string, unknown> };
  };
}

/**
 * Narrow the harness's trust-any seed so the auth hook actually runs the
 * cookie branch for the browser (`bypassHosts` from trust-any trustedNetworks
 * otherwise returns BEFORE the cookie validation, so `authVia` never lands).
 * Snapshots the harness config BEFORE the first mutation and restores it
 * verbatim in afterAll. Safe against racing: `workers: 1`.
 */
async function armOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  sessionToken = signToken(SESSION_USER, E2E_AUTH_SECRET);
  const cur = await readConfig(request);
  preTestConfig = {
    trustedNetworks: cur.data?.trustedNetworks,
    auth: cur.data?.auth,
  };
  await request.put("/api/config", {
    headers: authedHeaders(),
    data: {
      trustedNetworks: [],
      auth: { ...(cur.data?.auth ?? {}), bypassUrls: ["/v1/"] },
    },
  });
}

async function restoreOperatorSession(request: import("@playwright/test").APIRequestContext): Promise<void> {
  if (!preTestConfig) return;
  const cur = await readConfig(request);
  await request.put("/api/config", {
    headers: authedHeaders(),
    data: {
      trustedNetworks: preTestConfig.trustedNetworks,
      auth: { ...(cur.data?.auth ?? {}), bypassUrls: preTestConfig.auth?.bypassUrls ?? ["/"] },
    },
  });
  preTestConfig = null;
}

const SECTION_TITLE = "Paired Devices";

/** Poll the registry until the minted device id disappears (revoke round-trip
 * is async through the UI reload). */
async function waitForRegistryDrain(
  request: import("@playwright/test").APIRequestContext,
  goneId: string,
  preMintIds: Set<string>,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const list = (await (await request.get("/api/paired-devices", { headers: authedHeaders() })).json())
      .data as Array<{ id: string; label: string }>;
    if (!list.some((d) => d.id === goneId)) return;
    // The pre-existing rows must still be there the whole time.
    for (const id of preMintIds) {
      if (list.some((d) => d.id === id) === false && preMintIds.has(id)) {
        throw new Error(`pre-existing device ${id} was revoked by the spec`);
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`device ${goneId} was never revoked`);
}
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
    const preMintList = (await (await request.get("/api/paired-devices", { headers: authedHeaders() })).json())
      .data as Array<{ id: string; label: string }>;
    const preMintIds = new Set(preMintList.map((d) => d.id));
    await page.getByText(CREATE_BUTTON).click();
    await page.getByLabel(LABEL).fill("claude-code");
    await page.getByRole("button", { name: CREATE }).click();
    const snippet = page.locator("code", { hasText: "claude mcp add" }).first();
    await expect(snippet).toBeVisible({ timeout: 20_000 });
    const token = (await snippet.textContent())?.match(/Bearer ([A-Za-z0-9_-]+)/)?.[1] ?? "";
    await page.getByRole("button", { name: DISMISS }).click();

    // Identify the row THIS test minted by diffing the registry against the
    // pre-mint snapshot — a pre-existing `claude-code` device must survive.
    const rows = page.locator("li", { hasText: "claude-code" });
    const postList = (await (await request.get("/api/paired-devices", { headers: authedHeaders() })).json())
      .data as Array<{ id: string; label: string }>;
    const mintedIds = postList.filter((d) => d.label === "claude-code" && !preMintIds.has(d.id)).map((d) => d.id);
    expect(mintedIds).toHaveLength(1);
    const mintedId = mintedIds[0] as string;
    // The dismissal reload may still be in flight — settle the DOM to the
    // server's truth before interacting with the rows.
    await expect(rows).toHaveCount(postList.filter((d) => d.label === "claude-code").length, { timeout: 20_000 });

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

    // Revoke the row this test minted (confirm step, same as pairing rows).
    // The minted row is the LAST claude-code row (registry append order).
    {
      const row = rows.last();
      await row.getByTitle(REVOKE).click();
      await row.getByText("Confirm revoke").click();
    }
    // The minted row is gone from the REAL registry; pre-existing rows survive.
    await waitForRegistryDrain(request, mintedId, preMintIds);
    const afterList = (await (await request.get("/api/paired-devices", { headers: authedHeaders() })).json())
      .data as Array<{ id: string; label: string }>;
    expect(afterList.some((d) => d.id === mintedId)).toBe(false);

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
