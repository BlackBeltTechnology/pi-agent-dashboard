import { expect, type Page, test } from "./fixtures.js";
import {
  openAddPicker,
  openProvidersSettings,
  type ProviderStatusFixture,
  providerStatusRow,
  routeProviderData,
} from "./helpers/index.js";

/**
 * L3 browser behaviour for the redesigned Add-provider flow
 * (change: redesign-providers-settings-page). Covers test-plan rows F1, F5,
 * F6 (both suppression directions), F13 and X6.
 *
 * The dialog is PRESENTATION ONLY (design D4): the section owns every flow's
 * poll timers and outcome. These scenarios stage `GET /api/provider-auth/status`
 * with `page.route` (the repo's established fault-injection pattern) and drive
 * the REAL dialog, the REAL picker and the REAL section-owned flow loop above
 * it — including a deferred `GET /flow/:flowId` fulfillment to prove an error
 * that lands after the dialog closed still surfaces on the section (X6).
 */

/** The picker's keyboard interaction happens in SearchableSelectDialog. */

function unconfiguredAuthCode(id: string, name?: string): ProviderStatusFixture {
  return providerStatusRow({ id, name: name ?? id });
}

/** Collect uncaught page errors for the degradation rows. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("redesign-providers-settings-page — Add-provider flow (L3)", () => {
  // ── F1 — the flow outlives the dialog (D4) ────────────────────────────────
  test("F1: dismissing the dialog mid-flow does not stop the poll; completion lands on the list", async ({
    page,
  }) => {
    const data = routeProviderData(page, {
      statuses: [unconfiguredAuthCode("anthropic", "Anthropic"), unconfiguredAuthCode("openai", "OpenAI")],
    });
    // The delegated contract (delegate-provider-oauth-to-pi-ai): the client
    // starts ONE flow and observes it through GET /flow/:flowId — no
    // /authorize route, no device-code pair.
    const flowId = "flow-e2e-anthropic";
    await page.route("**/api/provider-auth/start", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          flowId,
          provider: "anthropic",
          status: "pending",
          authUrl: "https://example.com/oauth/authorize",
          pending: { kind: "manual_code", message: "Paste the redirect URL" },
        }),
      }),
    );
    let complete = false;
    await page.route("**/api/provider-auth/flow/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          complete
            ? { flowId, provider: "anthropic", status: "complete" }
            : {
                flowId,
                provider: "anthropic",
                status: "pending",
                authUrl: "https://example.com/oauth/authorize",
                pending: { kind: "manual_code", message: "Paste the redirect URL" },
              },
        ),
      }),
    );
    await openProvidersSettings(page);

    // Start a sign-in from the dialog.
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible();

    // Dismiss the dialog WHILE the section polls the flow.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);

    // The flow completes server-side AFTER the dismissal — only the
    // section-owned poll can observe it (the dialog is gone).
    complete = true;
    data.serveStatuses([
      providerStatusRow({
        id: "anthropic",
        name: "Anthropic",
        authenticated: true,
        configured: true,
        expires: Date.now() + 30 * 86_400_000,
      }),
      unconfiguredAuthCode("openai", "OpenAI"),
    ]);

    // Convergence: the list refreshes and shows the provider connected; the
    // dialog stays closed (completion closes it — it is already closed).
    const row = page.locator('[data-testid="provider-row"][data-row-id="anthropic"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Connected");
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
  });

  // ── F5 — keyboard-only picker ─────────────────────────────────────────────
  test("F5: filter + ArrowDown + Enter opens the highlighted provider's pane, no pointer event", async ({
    page,
  }) => {
    // 35 selectable entries: three "zed" matches plus 32 non-matching fillers.
    const statuses: ProviderStatusFixture[] = [
      unconfiguredAuthCode("zed-alpha", "Zed Alpha"),
      unconfiguredAuthCode("zed-beta", "Zed Beta"),
      providerStatusRow({ id: "zed-gamma", name: "Zed Gamma", flowType: "api_key" }),
    ];
    for (let i = 1; i <= 32; i++) {
      statuses.push(unconfiguredAuthCode(`prov-${i}`, `Provider ${i}`));
    }
    routeProviderData(page, { statuses });
    await openProvidersSettings(page);

    const count = page.getByTestId("add-provider-count");
    await expect(count).toHaveText(/\b35\b/); // the control names the selectable count

    const picker = await openAddPicker(page);
    const search = picker.getByPlaceholder("Search providers…");
    await expect(search).toBeFocused(); // keyboard-only starts from the autofocus
    await page.keyboard.type("zed"); // filter — the pinned Custom endpoint stays
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown"); // highlight moves to the third match
    await page.keyboard.press("Enter"); // selects it — no pointer event anywhere

    // The highlighted provider's PANE opened (api_key flowType → key pane).
    await expect(page.getByText("Add Zed Gamma")).toBeVisible();
    await expect(page.locator("#provider-api-key-input")).toBeVisible();
  });

  // ── F6 — cross-type suppression, both directions ──────────────────────────
  test("F6: the -api twin is non-selectable while the OAuth sibling is connected, and names the remove-first path", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [
        providerStatusRow({
          id: "anthropic",
          name: "Anthropic",
          authenticated: true,
          configured: true,
          expires: Date.now() + 30 * 86_400_000,
        }),
        providerStatusRow({ id: "anthropic-api", name: "Anthropic (API key)", flowType: "api_key" }),
      ],
    });
    await openProvidersSettings(page);

    // Filter down to the suppressed entry (+ the pinned Custom endpoint).
    const picker = await openAddPicker(page);
    const search = picker.getByPlaceholder("Search providers…");
    await search.fill("anthropic");

    // Rendered visible, but non-selectable, with the remove-first path named.
    const entry = picker.getByRole("option", { name: /Anthropic \(API key\)/ });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("aria-disabled", "true");
    await expect(entry).toContainText("Sign out first to use a key instead");

    // Enter on the highlighted suppressed entry is a no-op — no pane opens.
    await search.press("Enter");
    await expect(page.locator("#provider-api-key-input")).toHaveCount(0);
    await expect(page.getByTestId("dialog-sign-in")).toHaveCount(0);
    await expect(search).toBeVisible();
  });

  test("F6b: the OAuth entry is non-selectable while the twin holds a stored key, and names the remove-first path", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [
        unconfiguredAuthCode("anthropic", "Anthropic"),
        providerStatusRow({
          id: "anthropic-api",
          name: "Anthropic (API key)",
          flowType: "api_key",
          authenticated: true,
          configured: true,
          maskedKey: "sk-an…21",
        }),
      ],
    });
    await openProvidersSettings(page);

    const picker = await openAddPicker(page);
    const search = picker.getByPlaceholder("Search providers…");
    await search.fill("anthropic");

    // The configured twin itself is absent from the picker (managed by its
    // row); the OAuth entry renders suppressed, naming the way out.
    await expect(picker.getByRole("option", { name: /Anthropic \(API key\)/ })).toHaveCount(0);
    const entry = picker.getByRole("option", { name: /^Anthropic/ });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("aria-disabled", "true");
    await expect(entry).toContainText("must be removed first to sign in");

    await search.press("Enter");
    await expect(page.getByTestId("dialog-sign-in")).toHaveCount(0);
    await expect(search).toBeVisible();
  });

  // ── F13 — the peer hint never attaches to Add-provider surfaces ───────────
  test("F13: unconfigured anthropic with a failing peer probe shows no hint in the list, picker or pane", async ({
    page,
  }) => {
    // Make the probe STRICTLY report the peer missing (ok === false), so the
    // hint is genuinely armed — the gate must withhold it, not the probe.
    const health = await (await page.request.get("/api/health")).json();
    const plugins: Array<Record<string, unknown>> = Array.isArray(health.plugins) ? health.plugins : [];
    const bridgeRow = (plugins.find((p) => p?.id === "flows-anthropic-bridge") ?? {}) as Record<string, unknown>;
    bridgeRow.id = "flows-anthropic-bridge";
    const lastProbe = (bridgeRow.lastProbe ?? {}) as Record<string, unknown>;
    lastProbe.peers = {
      ...((lastProbe.peers ?? {}) as Record<string, unknown>),
      "@pi/anthropic-messages": { ok: false, reason: "e2e fixture: peer unresolved" },
    };
    bridgeRow.lastProbe = lastProbe;
    health.plugins = plugins.some((p) => p?.id === "flows-anthropic-bridge") ? plugins : [...plugins, bridgeRow];
    await page.route("**/api/health", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(health) }),
    );

    routeProviderData(page, {
      statuses: [unconfiguredAuthCode("anthropic", "Anthropic"), unconfiguredAuthCode("openai", "OpenAI")],
    });
    await openProvidersSettings(page);

    // No row exists (the list carries only credentialed providers)…
    await expect(page.locator('[data-testid="provider-row"][data-row-id="anthropic"]')).toHaveCount(0);
    await expect(page.getByTestId("anthropic-peer-hint")).toHaveCount(0);

    // …and the picker and its pane carry no hint either.
    const picker = await openAddPicker(page);
    await expect(page.getByTestId("anthropic-peer-hint")).toHaveCount(0);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await expect(page.getByText("Sign in to Anthropic")).toBeVisible();
    await expect(page.getByTestId("anthropic-peer-hint")).toHaveCount(0);
  });

  // ── X6 — a refusal that lands after the dialog closed surfaces inline ─────
  test("X6: a flow error landing after the dialog closed renders on the section, provider not connected", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    routeProviderData(page, {
      statuses: [unconfiguredAuthCode("anthropic", "Anthropic"), unconfiguredAuthCode("openai", "OpenAI")],
    });
    const flowId = "flow-e2e-anthropic";
    await page.route("**/api/provider-auth/start", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          flowId,
          provider: "anthropic",
          status: "pending",
          authUrl: "https://example.com/oauth/authorize",
          pending: { kind: "manual_code", message: "Paste the redirect URL" },
        }),
      }),
    );
    // Defer the flow status read until the dialog is already dismissed. The
    // refused-write translation path is GONE for OAuth flows (see the change's
    // provider-auth-server spec, "Credential write refused after a successful
    // exchange"): the outcome surfaces as `status: "error"` carrying the
    // write path's RAW message, so the sentinel is asserted verbatim.
    let release!: () => void;
    const dismissed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let released = false;
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      if (!released) await dismissed;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          flowId,
          provider: "anthropic",
          status: "error",
          error: "CREDENTIAL_TYPE_CONFLICT_SENTINEL",
        }),
      });
    });
    await openProvidersSettings(page);

    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible();

    // Dismiss; the error then lands on a section with no dialog present.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    released = true;
    release();

    const refusal = page.getByTestId("provider-flow-error");
    await expect(refusal).toBeVisible({ timeout: 10_000 });
    await expect(refusal).toContainText("Anthropic");
    // The flow's own error message, passed through verbatim.
    await expect(refusal).toContainText("CREDENTIAL_TYPE_CONFLICT_SENTINEL");

    // The provider was never written — it must not show connected.
    await expect(page.locator('[data-testid="provider-row"][data-row-id="anthropic"]')).toHaveCount(0);
    expect(pageErrors.filter((e) => /TypeError|is not a function/i.test(e))).toEqual([]);
  });
});
