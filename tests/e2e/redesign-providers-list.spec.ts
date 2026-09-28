import { expect, type Page, test } from "./fixtures.js";
import {
  type CustomEndpointFixture,
  dismissToasts,
  openAddPicker,
  openProvidersSettings,
  providerStatusRow,
  type ProviderStatusFixture,
  routeProviderData,
} from "./helpers/index.js";

/**
 * L3 browser behaviour for the redesigned Settings ▸ Providers CONNECTED LIST
 * (change: redesign-providers-settings-page). Covers test-plan rows F7-F11,
 * X7, X8, X9.
 *
 * The section merges two independent sources — `GET /api/provider-auth/status`
 * and `GET /api/providers` — plus the D5 catalogue-availability signal. The
 * scenarios stage those three reads with `page.route` (the repo's established
 * fault-injection pattern, cf. blackhole-settings.spec.ts): the rows are what
 * the real server would emit for the scenario's state, while the section, the
 * Settings shell and every interaction run for real. The server-side halves of
 * the same rows are L1 (`build-auth-status`, `provider-auth-routes` tests).
 *
 * F8/F9/F10 arm WRITE routes too — the client's post-write refresh re-reads
 * the (fixture) map, so a route handler that mutates its own payload mirrors
 * what the real server exhibits when a write persists.
 */

const CUSTOM_ENTRY: CustomEndpointFixture = {
  baseUrl: "http://localhost:8000/v1",
  apiKey: "sk-x",
  api: "openai-completions",
};

/** An OAuth row with a stored credential (what the seeded harness auth.json yields). */
function connectedSubscription(id = "anthropic"): ProviderStatusFixture {
  return providerStatusRow({
    id,
    authenticated: true,
    configured: true,
    expires: Date.now() + 30 * 86_400_000,
  });
}

/** Collect uncaught page errors so a degradation row can assert "no TypeError". */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test.describe("redesign-providers-settings-page — connected list (L3)", () => {
  // ── F7 — catalogue-unavailable is a scoped notice, never an empty state ──
  test("F7: catalogue-unavailable renders the notice, the rows and the Add control, and no empty state", async ({
    page,
  }) => {
    routeProviderData(page, {
      // What the real server emits with catalogue-ready:false: OAuth rows from
      // the local handler registry (catalogue-independent), no api-key rows.
      statuses: [connectedSubscription(), providerStatusRow({ id: "openai" })],
      catalogueReady: false,
    });
    await openProvidersSettings(page);

    // The subscription row renders (the notice does not replace the list).
    const row = page.locator('[data-testid="provider-row"][data-row-id="anthropic"]');
    await expect(row).toBeVisible();
    await expect(row.getByTestId("provider-badge")).toHaveText("Subscription");

    // The scoped per-source notice renders…
    const notice = page.getByTestId("catalogue-unavailable-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("API-key provider list unavailable.");
    await expect(notice).toContainText("out of date");

    // …the Add control remains (the only path to adding a credential)…
    await expect(page.getByTestId("add-provider-button")).toBeVisible();

    // …and the "nothing configured" empty state does NOT.
    await expect(page.getByTestId("providers-empty")).toHaveCount(0);
  });

  // ── F8 — the Save Bar is not a provider surface ───────────────────────────
  test("F8: add, edit and remove a credential without the Save Bar; Discard leaves provider writes alone", async ({
    page,
  }) => {
    // Mirror the real server: GET serves the map the writes have produced so
    // far; PATCH/DELETE mutate it exactly like the persistence layer would.
    let statuses: ProviderStatusFixture[] = [
      connectedSubscription(),
      providerStatusRow({
        id: "openrouter-api",
        flowType: "api_key",
        authenticated: true,
        configured: true,
        maskedKey: "sk-or…78",
      }),
    ];
    let providersMap: Record<string, CustomEndpointFixture> = { "local-vllm": { ...CUSTOM_ENTRY } };
    await page.route("**/api/provider-auth/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statuses) }),
    );
    await page.route("**/api/providers", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, providers: providersMap, health: {} }),
      }),
    );
    await page.route("**/api/provider-auth/catalogue-ready", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ready: true }) }),
    );
    await page.route("**/api/providers/edge-proxy", (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      providersMap = {
        ...providersMap,
        "edge-proxy": { baseUrl: "http://localhost:9000/v1", apiKey: "sk-edge", api: "openai-completions" },
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/provider-auth/openrouter-api", (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      statuses = statuses.filter((s) => s.id !== "openrouter-api");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    const saveBar = page.getByTestId("settings-save-bar");
    await openProvidersSettings(page);
    await expect(saveBar).toHaveCount(0);

    // ADD — a credential commits on its own action, no Save step.
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /Custom endpoint/ }).click();
    await page.locator("#custom-endpoint-name").fill("edge-proxy");
    await page.locator("#custom-endpoint-url").fill("http://localhost:9000/v1");
    await page.locator("#custom-endpoint-key").fill("sk-edge");
    await page.getByTestId("dialog-submit").click();
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    const addedRow = page.locator('[data-testid="provider-row"][data-row-id="edge-proxy"]');
    await expect(addedRow).toBeVisible();
    await expect(saveBar).toHaveCount(0);

    // EDIT — the row's own commit, still no Save Bar.
    await addedRow.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByTestId("custom-endpoint-edit")).toBeVisible();
    await page.getByTestId("custom-endpoint-edit").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("custom-endpoint-edit")).toHaveCount(0);
    await expect(saveBar).toHaveCount(0);

    // REMOVE — a credential removal is likewise not a draft source.
    const keyRow = page.locator('[data-testid="provider-row"][data-row-id="openrouter-api"]');
    await keyRow.getByRole("button", { name: "Remove" }).click();
    await expect(keyRow).toHaveCount(0);
    await expect(saveBar).toHaveCount(0);
    await dismissToasts(page);

    // An UNRELATED dirty field still lights the bar — and discarding it must
    // not revert the committed provider writes. (The API Proxy toggle is a
    // config-draft source living on this same page; the alias editor is no
    // good here — addRow does not call onChange and an empty-valued row
    // commits as a no-op.)
    await page.getByTestId("proxy-toggle").click();
    await expect(saveBar).toBeVisible();
    await page.getByTestId("discard-btn").click();
    await expect(saveBar).toHaveCount(0);
    await expect(page.locator('[data-testid="provider-row"][data-row-id="edge-proxy"]')).toBeVisible();
    await expect(page.locator('[data-testid="provider-row"][data-row-id="anthropic"]')).toBeVisible();
    await expect(page.locator('[data-testid="provider-row"][data-row-id="openrouter-api"]')).toHaveCount(0);
  });

  // ── F9 — one dispatch per successful write, whichever control initiated it ─
  test("F9: exactly one provider-auth-event per successful write; a refused write dispatches none", async ({
    page,
  }) => {
    let statuses: ProviderStatusFixture[] = [
      providerStatusRow({ id: "zed-api", flowType: "api_key" }),
      providerStatusRow({ id: "zed-conflict", flowType: "api_key" }),
    ];
    let providersMap: Record<string, CustomEndpointFixture> = {};
    await page.route("**/api/provider-auth/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(statuses) }),
    );
    await page.route("**/api/providers", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, providers: providersMap, health: {} }),
      }),
    );
    await page.route("**/api/provider-auth/catalogue-ready", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ready: true }) }),
    );
    await page.route("**/api/provider-auth/api-key", async (route) => {
      const body = route.request().postDataJSON() as { provider: string };
      if (body.provider === "zed-conflict") {
        // The server's cross-type refusal — a FAILED write must not dispatch.
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "provider_auth.credential_type_conflict",
            error: "conflict",
            vars: { storedType: "oauth" },
          }),
        });
      }
      statuses = statuses.map((s) =>
        s.id === body.provider ? { ...s, authenticated: true, configured: true, maskedKey: "sk-n…ew" } : s,
      );
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.route("**/api/providers/funnel-endpoint", (route) => {
      if (route.request().method() === "PATCH") {
        providersMap = { ...providersMap, "funnel-endpoint": { ...CUSTOM_ENTRY, baseUrl: "http://localhost:9001/v1" } };
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      if (route.request().method() === "DELETE") {
        const next = { ...providersMap };
        delete next["funnel-endpoint"];
        providersMap = next;
        return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      }
      return route.fallback();
    });

    await openProvidersSettings(page);
    await page.evaluate(() => {
      (window as unknown as { __paEvents: number }).__paEvents = 0;
      window.addEventListener("provider-auth-event", () => {
        (window as unknown as { __paEvents: number }).__paEvents += 1;
      });
    });
    const events = () => page.evaluate(() => (window as unknown as { __paEvents: number }).__paEvents);
    await expect(events()).resolves.toBe(0); // a mount is not a write

    // 1 — a successful key save from the dialog.
    const picker1 = await openAddPicker(page);
    await picker1.getByRole("option", { name: "zed-api" }).click();
    await page.locator("#provider-api-key-input").fill("sk-zed");
    await page.getByTestId("dialog-submit").click();
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    expect(await events()).toBe(1);

    // 2 — a custom-endpoint write from the dialog.
    const picker2 = await openAddPicker(page);
    await picker2.getByRole("option", { name: /Custom endpoint/ }).click();
    await page.locator("#custom-endpoint-name").fill("funnel-endpoint");
    await page.locator("#custom-endpoint-url").fill("http://localhost:9001/v1");
    await page.locator("#custom-endpoint-key").fill("sk-funnel");
    await page.getByTestId("dialog-submit").click();
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    expect(await events()).toBe(2);

    // 3 — a REFUSED key write: inline error, dialog stays open, no dispatch.
    const picker3 = await openAddPicker(page);
    await picker3.getByRole("option", { name: "zed-conflict" }).click();
    await page.locator("#provider-api-key-input").fill("sk-x");
    await page.getByTestId("dialog-submit").click();
    await expect(page.getByTestId("dialog-error")).toBeVisible();
    expect(await events()).toBe(2);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);

    // 4 — a removal from the row's own control.
    const row = page.locator('[data-testid="provider-row"][data-row-id="funnel-endpoint"]');
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
    expect(await events()).toBe(3);
  });

  // ── F10 — pending pill reconciles from exactly one health read ~2 s later ──
  test("F10: a saved custom endpoint shows the pending pill, then reconciles from one health read ~2 s later", async ({
    page,
  }) => {
    let written = false;
    const readAt: number[] = [];
    let writeAt = 0;
    await page.route("**/api/provider-auth/status", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await page.route("**/api/provider-auth/catalogue-ready", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ready: true }) }),
    );
    await page.route("**/api/providers", (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      readAt.push(Date.now());
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          providers: { "local-vllm": { ...CUSTOM_ENTRY } },
          health: written ? { "local-vllm": { ok: true, status: 200, modelCount: 3, testedAt: Date.now() } } : {},
        }),
      });
    });
    await page.route("**/api/providers/local-vllm", (route) => {
      if (route.request().method() !== "PATCH") return route.fallback();
      written = true;
      writeAt = Date.now();
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await openProvidersSettings(page);
    const row = page.locator('[data-testid="provider-row"][data-row-id="local-vllm"]');
    await expect(row).toBeVisible();

    // Save (the probe is detached from the response — D3), then the pill goes
    // pending immediately…
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByTestId("custom-endpoint-edit").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("custom-endpoint-edit")).toHaveCount(0);
    await expect(row.getByTestId("health-pill")).toHaveAttribute("data-state", "pending");

    // …and reconciles from EXACTLY ONE health read ~2 s after the write.
    await expect(row.getByTestId("health-pill")).toHaveAttribute("data-state", "ok", { timeout: 10_000 });
    const inWindow = readAt.filter((t) => t > writeAt + 1_200);
    expect(inWindow.length, "exactly one health read after the write-response window").toBe(1);
    expect(
      inWindow[0] - writeAt,
      "the reconciling read lands ~2 s (not immediately) after the write",
    ).toBeLessThan(5_000);

    // No further reads: the reconcile is a one-shot, not a poll.
    await page.waitForTimeout(2_500);
    expect(readAt.filter((t) => t > writeAt + 1_200).length).toBe(1);
  });

  // ── F11 — rows are identified by (source, id); both rows render ────────────
  test("F11: an OAuth credential and a providers.json entry with the same name render two rows", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [connectedSubscription()],
      providers: { anthropic: { ...CUSTOM_ENTRY } },
    });
    await openProvidersSettings(page);

    const authRow = page.locator('[data-testid="provider-row"][data-row-id="anthropic"][data-row-source="auth"]');
    const customRow = page.locator('[data-testid="provider-row"][data-row-id="anthropic"][data-row-source="custom"]');
    await expect(authRow).toBeVisible();
    await expect(customRow).toBeVisible();

    await expect(authRow.getByTestId("provider-badge")).toHaveText("Subscription");
    await expect(customRow.getByTestId("provider-badge")).toHaveText("Custom endpoint");
    await expect(customRow).toContainText("http://localhost:8000/v1");

    // Neither row replaces the other — exactly the pair, no duplicates.
    await expect(page.getByTestId("provider-row")).toHaveCount(2);
  });

  // ── X7 — a failed status read degrades per source, custom rows survive ────
  test("X7: status 500 keeps custom-endpoint rows and their actions; inline error; no ErrorBoundary", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    routeProviderData(page, { providers: { "local-vllm": { ...CUSTOM_ENTRY } } });
    // Registered AFTER the fixture routes → LIFO makes this the handler that
    // answers, while Retry's unroute strips both and reaches the real server.
    await page.route("**/api/provider-auth/status", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 500, error: "Internal Server Error", message: "boom" }),
      }),
    );
    await openProvidersSettings(page);

    const row = page.locator('[data-testid="provider-row"][data-row-id="local-vllm"]');
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(row.getByRole("button", { name: "Remove" })).toBeVisible();

    const error = page.getByTestId("provider-auth-status-error");
    await expect(error).toBeVisible();
    await expect(page.getByTestId("providers-list-error")).toHaveCount(0); // scoped to ONE source
    await expect(page.getByTestId("add-provider-button")).toBeVisible(); // section stays interactive
    await expect(page.getByTestId("settings-nav-rail")).toBeVisible(); // panel mounted
    await expect(page.getByText(/Render error:/i)).toHaveCount(0); // no ErrorBoundary

    // The repair path works from the degraded state: Retry re-reads for real.
    await page.unroute("**/api/provider-auth/status");
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("provider-auth-status-error")).toHaveCount(0);
    expect(pageErrors.filter((e) => /TypeError|is not a function/i.test(e))).toEqual([]);
  });

  // ── X8 — the inverse per-source degradation ────────────────────────────────
  test("X8: /api/providers 500 keeps credential rows; the error is scoped to the custom-endpoint source", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    routeProviderData(page, {
      statuses: [
        connectedSubscription(),
        providerStatusRow({
          id: "openrouter-api",
          flowType: "api_key",
          authenticated: true,
          configured: true,
          maskedKey: "sk-or…78",
        }),
      ],
    });
    await page.route("**/api/providers", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ statusCode: 500 }) }),
    );
    await openProvidersSettings(page);

    const authRow = page.locator('[data-testid="provider-row"][data-row-id="anthropic"]');
    const keyRow = page.locator('[data-testid="provider-row"][data-row-id="openrouter-api"]');
    await expect(authRow).toBeVisible();
    await expect(keyRow).toBeVisible();
    await expect(keyRow.getByRole("button", { name: "Edit" })).toBeVisible();

    const error = page.getByTestId("providers-list-error");
    await expect(error).toBeVisible();
    await expect(page.getByTestId("provider-auth-status-error")).toHaveCount(0); // scoped to ONE source
    await expect(page.getByText(/Render error:/i)).toHaveCount(0);

    await page.unroute("**/api/providers");
    await error.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("providers-list-error")).toHaveCount(0);
    expect(pageErrors.filter((e) => /TypeError|is not a function/i.test(e))).toEqual([]);
  });

  // ── X9 — a 200 non-array status body degrades without a TypeError ──────────
  test("X9: a 200 status response with an object body renders the inline error, custom rows survive, no TypeError", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    routeProviderData(page, { providers: { "local-vllm": { ...CUSTOM_ENTRY } } });
    // Registered AFTER the fixture route → LIFO makes this the handler that
    // answers (see X7).
    await page.route("**/api/provider-auth/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ statusCode: 200, message: "not an array" }),
      }),
    );
    await openProvidersSettings(page);

    await expect(page.getByTestId("provider-auth-status-error")).toBeVisible();
    await expect(page.locator('[data-testid="provider-row"][data-row-id="local-vllm"]')).toBeVisible();
    await expect(page.getByTestId("add-provider-button")).toBeVisible();
    await expect(page.getByText(/Render error:/i)).toHaveCount(0);
    // Let any stray async work settle, then prove no array method ever hit the body.
    await page.waitForTimeout(1_500);
    expect(
      pageErrors.filter((e) => /TypeError|is not a function|cannot read/i.test(e)),
      "no TypeError from the malformed body",
    ).toEqual([]);
  });
});
