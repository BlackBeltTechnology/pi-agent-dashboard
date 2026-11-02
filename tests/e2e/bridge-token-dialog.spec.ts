/**
 * E2E (test-plan F9, change: prove-vault-bridge-tls, task 2.10): the Settings →
 * Paired Devices token dialog over a plain-HTTP dashboard with Built-in HTTPS off.
 *
 * F9  the "Bridge on another machine" purpose is disabled (a bridge token is only
 *     vault-eligible when issued over proven HTTPS) and links the Built-in HTTPS
 *     section; an MCP token is created exactly as before — no `pi_tls_` prefix.
 *
 * Runs against the REAL harness (plain HTTP, TLS listener off): the minted bearer
 * and the registry row are real; the row is revoked at the end so the shared
 * registry is left as found. Structure mirrors `mcp-token-settings.spec.ts`.
 */

import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { OperatorSession } from "./helpers/operator-session.js";
import { BASE_URL } from "./lifecycle.js";

const SECTION_TITLE = "Paired Devices";
const CREATE_BUTTON = "Create token for an MCP client";
const LABEL = "Token label";
const CREATE = "Create";
const DISMISS = "Dismiss";
const BRIDGE_PURPOSE = /Bridge on another machine/;
const HTTPS_LINK = "Turn on Built-in HTTPS to issue bridge tokens";

const op = new OperatorSession();

async function gotoPairedDevices(page: import("@playwright/test").Page): Promise<void> {
  await gotoDashboard(page);
  await page.goto("/settings/security");
  await expect(page.getByRole("heading", { name: SECTION_TITLE })).toBeVisible({ timeout: 20_000 });
}

test.describe("Bridge token dialog — plain HTTP, Built-in HTTPS off", () => {
  test.beforeEach(async ({ request, context }) => {
    // The mint route needs a login-session browser (D5); the harness browser is never loopback-sourced.
    await op.arm(request, context);
    const health = await request.get("/api/health");
    const body = (await health.json()) as { tls?: { enabled?: boolean } };
    test.skip(body.tls?.enabled === true, "needs Built-in HTTPS off (the precondition of F9)");
    expect(BASE_URL.startsWith("http://"), "the harness serves plain HTTP").toBe(true);
  });

  test("F9 — bridge purpose disabled with the Built-in HTTPS link; the MCP token is created as before", async ({
    page,
    request,
  }) => {
    await gotoPairedDevices(page);
    const preMintIds = new Set(
      (((await (await request.get("/api/paired-devices", { headers: op.headers() })).json()) as { data: Array<{ id: string }> }).data).map(
        (d) => d.id,
      ),
    );

    await page.getByText(CREATE_BUTTON).click();
    const form = page.getByTestId("create-token-form");
    await expect(form).toBeVisible({ timeout: 10_000 });

    // The bridge purpose cannot be chosen, and the dialog names the way out.
    await expect(form.getByLabel(BRIDGE_PURPOSE)).toBeDisabled();
    const unavailable = form.getByTestId("bridge-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText(/not vault-eligible/i);
    const link = unavailable.getByRole("link", { name: HTTPS_LINK });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/settings/gateway#gateway-built-in-https");

    // The MCP flow is unchanged: observe tier, plain token, claude snippet.
    await expect(form.getByLabel(/MCP client/)).toBeChecked();
    await page.getByLabel(LABEL).fill("f9-mcp");
    await page.getByRole("button", { name: CREATE }).click();
    const panel = page.getByTestId("mcp-token-result");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    const snippet = panel.locator("code", { hasText: "claude mcp add" }).first();
    await expect(snippet).toBeVisible();
    const token = ((await snippet.textContent()) ?? "").match(/Bearer ([A-Za-z0-9_-]+)/)?.[1] ?? "";
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(token.startsWith("pi_tls_")).toBe(false);
    await expect(panel.getByTestId("bridge-token-snippet")).toHaveCount(0);
    await panel.getByRole("button", { name: DISMISS, exact: true }).click();

    // The real registry holds a manual, observe-tier row — and the spec leaves none behind.
    const list = ((await (await request.get("/api/paired-devices", { headers: op.headers() })).json()) as {
      data: Array<{ id: string; label: string; source: string; tier: string }>;
    }).data;
    const minted = list.filter((d) => d.label === "f9-mcp" && !preMintIds.has(d.id));
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({ source: "manual", tier: "observe" });
    const revoke = await request.delete(`/api/paired-devices/${minted[0]?.id}`, { headers: op.headers() });
    expect(revoke.ok()).toBe(true);
  });
});
