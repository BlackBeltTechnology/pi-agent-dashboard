import { expect, type Page, test } from "./fixtures.js";
import {
  openAddPicker,
  openProvidersSettings,
  providerStatusRow,
  type ProviderStatusFixture,
  routeProviderData,
} from "./helpers/index.js";

/**
 * L3 browser behaviour for the DELEGATED OAuth flow
 * (change: delegate-provider-oauth-to-pi-ai). Covers test-plan rows F1–F9
 * (F10 is manual-only).
 *
 * The server owns the whole handshake now: `POST /api/provider-auth/start`
 * opens the SYSTEM browser itself, so the page never calls `window.open` and
 * never touches an /authorize route. These specs mock `/start`,
 * `GET /flow/:flowId`, `POST /flow/:flowId/input` and `DELETE /flow/:flowId`
 * at the Playwright network layer (the redesign-provider-add-flow.spec.ts
 * pattern) and drive the REAL dialog plus the REAL section-owned poll (the
 * 2 s interval in ProviderAuthSection `startFlow`) on top of them.
 */

/** Body the client sends to `POST /api/provider-auth/start`. */
interface StartBody {
  provider?: string;
  enterpriseDomain?: string;
}

const FLOW_ID = "flow-e2e-anthropic";
const ANTHROPIC_AUTH_URL = "https://claude.ai/oauth/authorize";
const PASTED_REDIRECT_URL =
  "https://console.anthropic.com/oauth/code/callback?code=e2e-code&state=e2e-state";

/** A pending manual_code step — the pane renders the authUrl link + paste field. */
function pendingManualCode() {
  return {
    flowId: FLOW_ID,
    provider: "anthropic",
    status: "pending",
    authUrl: ANTHROPIC_AUTH_URL,
    pending: { kind: "manual_code", message: "Paste the redirect URL", placeholder: "https://…" },
  };
}

/** A pending device_code step — render-only (userCode + verification URI). */
function deviceStep(flowId: string, provider: string, userCode: string, verificationUri: string) {
  return {
    flowId,
    provider,
    status: "pending",
    pending: { kind: "device_code", userCode, verificationUri, expiresInSeconds: 900 },
  };
}

/** A connected status row for the post-completion list refresh. */
function connectedRow(id: string, name: string): ProviderStatusFixture {
  return providerStatusRow({
    id,
    name,
    authenticated: true,
    configured: true,
    expires: Date.now() + 30 * 86_400_000,
  });
}

/**
 * The device pane's structure — the SAME test ids for every provider whose
 * flow reports a `device_code` step (F3's invariant).
 */
async function expectDevicePane(page: Page, step: { userCode: string; verificationUri: string }): Promise<void> {
  const waiting = page.getByTestId("dialog-flow-waiting");
  await expect(waiting).toBeVisible();
  await expect(waiting.getByText("Enter this code at:")).toBeVisible();
  await expect(waiting.locator("code")).toHaveText(step.userCode);
  await expect(waiting.locator(`a[href="${step.verificationUri}"]`)).toBeVisible();
  await expect(waiting.getByRole("button", { name: "Open Registration Page" })).toBeVisible();
  // device_code is render-only: nothing answerable is rendered with it.
  await expect(page.getByTestId("dialog-input-field")).toHaveCount(0);
  await expect(page.locator('[data-testid^="dialog-option-"]')).toHaveCount(0);
}

/** The Add-provider picker's dialog (same discriminator openAddPicker uses). */
function pickerDialog(page: Page) {
  return page.getByRole("dialog").filter({ has: page.getByPlaceholder("Search providers…") });
}

/** Count every `window.open` call; each returns null (popup blocked). */
function stubWindowOpen(page: Page): void {
  void page.addInitScript(() => {
    const w = window as typeof window & { __openCalls?: number };
    w.__openCalls = 0;
    window.open = () => {
      w.__openCalls = (w.__openCalls ?? 0) + 1;
      return null;
    };
  });
}

async function windowOpenCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as typeof window & { __openCalls?: number }).__openCalls ?? -1);
}

test.describe("delegate-provider-oauth-to-pi-ai — delegated provider OAuth flow (L3)", () => {
  // ── F1 — remote paste (manual_code) completes the flow ────────────────────
  test("F1: pasting the redirect URL completes the flow — exactly one input POST, dialog closed, provider connected", async ({
    page,
  }) => {
    const data = routeProviderData(page, {
      statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })],
    });
    const startBodies: StartBody[] = [];
    await page.route("**/api/provider-auth/start", async (route) => {
      startBodies.push(JSON.parse(route.request().postData() ?? "{}") as StartBody);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(pendingManualCode()),
      });
    });
    const inputValues: string[] = [];
    await page.route("**/api/provider-auth/flow/*/input", async (route) => {
      inputValues.push((JSON.parse(route.request().postData() ?? "{}") as { value?: string }).value ?? "");
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let complete = false;
    const flowGetPaths: string[] = [];
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      flowGetPaths.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          complete ? { flowId: FLOW_ID, provider: "anthropic", status: "complete" } : pendingManualCode(),
        ),
      });
    });

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible();
    // The authUrl link renders above the paste field; the SYSTEM browser was
    // opened server-side — the page itself opens nothing (F2 proves it).
    await expect(page.locator(`a[href="${ANTHROPIC_AUTH_URL}"]`)).toBeVisible();

    await page.getByTestId("dialog-input-field").fill(PASTED_REDIRECT_URL);
    await page.getByTestId("dialog-input-submit").click();
    await expect.poll(() => inputValues).toEqual([PASTED_REDIRECT_URL]); // exactly one POST /input
    await expect(page.getByTestId("dialog-input-field")).toHaveValue(""); // cleared after submit

    // The flow completes server-side; the poll observes it and the refreshed
    // /status lists the provider connected.
    complete = true;
    data.serveStatuses([connectedRow("anthropic", "Anthropic")]);

    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0); // dialog closed
    const row = page.locator('[data-testid="provider-row"][data-row-id="anthropic"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Connected");
    expect(startBodies).toEqual([{ provider: "anthropic" }]);
    expect(flowGetPaths.every((p) => p === `/api/provider-auth/flow/${FLOW_ID}`)).toBe(true);
  });

  // ── F2 — the codex select step advances the SAME flow ─────────────────────
  test("F2: choosing the device method advances the SAME flow — no second /start, no tab opened", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "openai-codex", name: "OpenAI Codex" })],
    });
    stubWindowOpen(page);
    const popups: Page[] = [];
    page.on("popup", (p) => popups.push(p));
    const startBodies: StartBody[] = [];
    const codexSelect = {
      flowId: "flow-e2e-codex",
      provider: "openai-codex",
      status: "pending",
      pending: {
        kind: "select",
        message: "How do you want to sign in?",
        options: [
          { id: "browser", label: "Open in browser" },
          { id: "device_code", label: "Device code login" },
        ],
      },
    };
    await page.route("**/api/provider-auth/start", async (route) => {
      startBodies.push(JSON.parse(route.request().postData() ?? "{}") as StartBody);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(codexSelect) });
    });
    const inputValues: string[] = [];
    await page.route("**/api/provider-auth/flow/*/input", async (route) => {
      inputValues.push((JSON.parse(route.request().postData() ?? "{}") as { value?: string }).value ?? "");
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    let deviceChosen = false;
    const flowGetPaths: string[] = [];
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      flowGetPaths.push(new URL(route.request().url()).pathname);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          deviceChosen
            ? deviceStep("flow-e2e-codex", "openai-codex", "CODX-1234", "https://github.com/login/device")
            : codexSelect,
        ),
      });
    });

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^OpenAI Codex/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    await expect(page.getByText("How do you want to sign in?")).toBeVisible();

    await page.getByTestId("dialog-option-device_code").click();
    await expect.poll(() => inputValues).toEqual(["device_code"]);

    // The pane re-renders from the SAME flow's next status read — device step.
    deviceChosen = true;
    await expectDevicePane(page, { userCode: "CODX-1234", verificationUri: "https://github.com/login/device" });

    expect(startBodies).toEqual([{ provider: "openai-codex" }]); // no second /start
    expect(flowGetPaths.length).toBeGreaterThan(0); // the poll stayed on the one flow…
    expect(flowGetPaths.every((p) => p === "/api/provider-auth/flow/flow-e2e-codex")).toBe(true); // …same flowId
    // The browser is the SERVER's job — the page opened no tab.
    expect(await windowOpenCalls(page)).toBe(0);
    expect(popups).toEqual([]);
  });

  // ── F3 — the new device-code providers share GitHub Copilot's pane ────────
  test("F3: xai, kimi-coding and meta render the SAME device-pane structure as GitHub Copilot", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [
        providerStatusRow({ id: "github-copilot", name: "GitHub Copilot", flowType: "device_code" }),
        providerStatusRow({ id: "xai", name: "xAI", flowType: "device_code" }),
        providerStatusRow({ id: "kimi-coding", name: "Kimi", flowType: "device_code" }),
        providerStatusRow({ id: "meta", name: "Meta AI", flowType: "device_code" }),
      ],
    });
    const startBodies: StartBody[] = [];
    const deviceByProvider: Record<string, { userCode: string; verificationUri: string }> = {
      "github-copilot": { userCode: "COPI-0001", verificationUri: "https://github.com/login/device" },
      xai: { userCode: "XAI-0002", verificationUri: "https://accounts.x.ai/device" },
      "kimi-coding": { userCode: "KIMI-0003", verificationUri: "https://www.kimi.com/device" },
      meta: { userCode: "META-0004", verificationUri: "https://www.facebook.com/device" },
    };
    await page.route("**/api/provider-auth/start", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as StartBody;
      startBodies.push(body);
      const step = deviceByProvider[body.provider ?? ""];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          deviceStep(`flow-e2e-${body.provider}`, body.provider ?? "", step.userCode, step.verificationUri),
        ),
      });
    });
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      const flowId = new URL(route.request().url()).pathname.split("/")[4] ?? "";
      const provider = flowId.replace("flow-e2e-", "");
      const step = deviceByProvider[provider];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(deviceStep(flowId, provider, step.userCode, step.verificationUri)),
      });
    });

    await openProvidersSettings(page);

    // Reference structure: GitHub Copilot's device pane, reached through its
    // pre-flow domain prompt (F4 covers the domain itself, so it stays blank).
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^GitHub Copilot/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expectDevicePane(page, deviceByProvider["github-copilot"]);

    // Each new provider: the SAME pane, reached with a bare Sign In.
    for (const entry of [
      { option: /^xAI/, step: deviceByProvider["xai"] },
      { option: /^Kimi/, step: deviceByProvider["kimi-coding"] },
      { option: /^Meta AI/, step: deviceByProvider["meta"] },
    ]) {
      await page.getByRole("button", { name: "Back" }).click();
      await expect(pickerDialog(page)).toBeVisible();
      await pickerDialog(page).getByRole("option", { name: entry.option }).click();
      await page.getByTestId("dialog-sign-in").click();
      await expectDevicePane(page, entry.step);
    }

    expect(startBodies.map((b) => b.provider)).toEqual(["github-copilot", "xai", "kimi-coding", "meta"]);
  });

  // ── F4 — the GitHub Enterprise domain rides the /start pre-answer ─────────
  test("F4: the Copilot enterprise domain is sent as the /start pre-answer; no text prompt renders after", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "github-copilot", name: "GitHub Copilot", flowType: "device_code" })],
    });
    const startBodies: StartBody[] = [];
    const copilotDevice = () =>
      deviceStep("flow-e2e-copilot", "github-copilot", "COPI-5678", "https://company.ghe.com/login/device");
    await page.route("**/api/provider-auth/start", async (route) => {
      startBodies.push(JSON.parse(route.request().postData() ?? "{}") as StartBody);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(copilotDevice()) });
    });
    await page.route("**/api/provider-auth/flow/*", async (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(copilotDevice()) }),
    );

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^GitHub Copilot/ }).click();

    // The domain question comes BEFORE the flow and is pre-answered into /start.
    const domain = page.locator("#provider-enterprise-domain");
    await expect(domain).toBeVisible();
    await domain.fill("company.ghe.com");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect
      .poll(() => startBodies)
      .toEqual([{ provider: "github-copilot", enterpriseDomain: "company.ghe.com" }]);
    await expectDevicePane(page, { userCode: "COPI-5678", verificationUri: "https://company.ghe.com/login/device" });
    // The text prompt was consumed server-side — it never renders as a field.
    await expect(page.getByTestId("dialog-input-field")).toHaveCount(0);
    await expect(page.locator("#provider-enterprise-domain")).toHaveCount(0);
  });

  // ── F5 — Cancel deletes the flow once and stops the poll ──────────────────
  test("F5: Cancel DELETEs the flow exactly once, stops the poll and returns to the picker", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })],
    });
    await page.route("**/api/provider-auth/start", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) }),
    );
    const deletes: string[] = [];
    let flowGets = 0;
    let pollAfterCancel = false;
    let cancelAt = 0;
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      const req = route.request();
      if (req.method() === "DELETE") {
        cancelAt = Date.now();
        deletes.push(new URL(req.url()).pathname);
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      flowGets += 1;
      // A 250 ms grace absorbs an in-flight tick racing the cancel click; a
      // genuinely un-stopped 2 s interval trips this within one tick.
      if (cancelAt > 0 && Date.now() > cancelAt + 250) pollAfterCancel = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) });
    });

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible();
    await expect.poll(() => flowGets).toBeGreaterThan(0); // the poll is armed before cancelling

    await page.getByTestId("dialog-cancel").click();
    await expect(page.getByPlaceholder("Search providers…")).toBeVisible(); // picker again
    expect(deletes).toEqual([`/api/provider-auth/flow/${FLOW_ID}`]); // exactly one DELETE

    // The poll is stopped: no /flow GET lands in the 5 s after the cancel.
    await page.waitForTimeout(5_000);
    expect(pollAfterCancel).toBe(false);

    // The provider was never written — it is not listed connected.
    await expect(page.locator('[data-testid="provider-row"][data-row-id="anthropic"]')).toHaveCount(0);
  });

  // ── F6 — an expired flow offers Try Again, which starts a NEW flow ────────
  test("F6: an expired flow renders 'Authorization expired' with Try Again, which issues a new /start", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })],
    });
    let starts = 0;
    await page.route("**/api/provider-auth/start", async (route) => {
      starts += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) });
    });
    let expired = true;
    await page.route("**/api/provider-auth/flow/*", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          expired ? { flowId: FLOW_ID, provider: "anthropic", status: "expired" } : pendingManualCode(),
        ),
      }),
    );

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();

    // The section maps status "expired" to the existing providers.authExpired key.
    const errorPane = page.getByTestId("dialog-flow-error");
    await expect(errorPane).toBeVisible({ timeout: 10_000 });
    await expect(errorPane).toContainText("Authorization expired");
    await expect(page.getByTestId("dialog-try-again")).toBeVisible();

    await page.getByTestId("dialog-try-again").click();
    await expect.poll(() => starts).toBe(2); // a NEW /start for the same provider
    expired = false;
    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible({ timeout: 10_000 });
  });

  // ── F7 — a failed start is a terminal pane error and never polls ──────────
  test("F7: a failed start (500, then 504) shows the error verbatim with Try Again and issues zero /flow GETs", async ({
    page,
  }) => {
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })],
    });
    const startResponses = [
      { status: 500, body: { error: "Port 53692 in use" } },
      { status: 504, body: { error: "Provider did not respond" } },
    ];
    await page.route("**/api/provider-auth/start", async (route) => {
      const next = startResponses.shift() ?? { status: 500, body: { error: "unexpected extra start" } };
      await route.fulfill({ status: next.status, contentType: "application/json", body: JSON.stringify(next.body) });
    });
    // `flow/**` covers both the status read and the input route: a failed
    // start never produced a flow id, so NOTHING may ever be sent there.
    const flowTraffic: string[] = [];
    await page.route("**/api/provider-auth/flow/**", async (route) => {
      flowTraffic.push(new URL(route.request().url()).pathname);
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) });
    });

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();

    const pane = page.getByTestId("dialog-flow-error");
    await expect(pane).toContainText("Port 53692 in use");
    await page.getByTestId("dialog-try-again").click();
    await expect(pane).toContainText("Provider did not respond");
    await expect(page.getByTestId("dialog-try-again")).toBeVisible();

    // Longer than one poll interval — nothing was ever polled.
    await page.waitForTimeout(4_000);
    expect(flowTraffic).toEqual([]);
  });

  // ── F8 — the flow outlives the dialog (section-owned poll) ────────────────
  test("F8: dismissing the dialog keeps the poll running; completing out of sight refreshes the list", async ({
    page,
  }) => {
    const data = routeProviderData(page, {
      statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })],
    });
    await page.route("**/api/provider-auth/start", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) }),
    );
    let complete = false;
    const flowGetTimes: number[] = [];
    await page.route("**/api/provider-auth/flow/*", async (route) => {
      flowGetTimes.push(Date.now());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          complete ? { flowId: FLOW_ID, provider: "anthropic", status: "complete" } : pendingManualCode(),
        ),
      });
    });

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();
    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible();

    // Dismiss — the section, not the dialog, owns the poll timer.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    const dismissedAt = Date.now();

    // Reopen on the picker while the flow is still running server-side.
    await page.getByTestId("add-provider-button").click();
    await expect(page.getByPlaceholder("Search providers…")).toBeVisible();

    // ≥1 status read landed during the closed gap.
    await expect
      .poll(() => flowGetTimes.filter((t) => t > dismissedAt).length, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // The flow completes out of sight; the dialog closes itself and the list
    // refreshes without user action.
    complete = true;
    data.serveStatuses([connectedRow("anthropic", "Anthropic")]);
    await expect(page.getByTestId("provider-add-dialog")).toHaveCount(0);
    const row = page.locator('[data-testid="provider-row"][data-row-id="anthropic"]');
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText("Connected");
  });

  // ── F9 — a blocked popup still leaves the link + paste field ──────────────
  test("F9: with window.open stubbed to return null, the authUrl link AND the paste field are rendered", async ({
    page,
  }) => {
    stubWindowOpen(page);
    routeProviderData(page, {
      statuses: [providerStatusRow({ id: "anthropic", name: "Anthropic" })],
    });
    await page.route("**/api/provider-auth/start", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) }),
    );
    await page.route("**/api/provider-auth/flow/*", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pendingManualCode()) }),
    );

    await openProvidersSettings(page);
    const picker = await openAddPicker(page);
    await picker.getByRole("option", { name: /^Anthropic/ }).click();
    await page.getByTestId("dialog-sign-in").click();

    await expect(page.getByTestId("dialog-flow-waiting")).toBeVisible();
    // The server opened the browser itself; even with window.open returning
    // null, the copyable authUrl link and the paste field are both present.
    await expect(page.locator(`a[href="${ANTHROPIC_AUTH_URL}"]`)).toBeVisible();
    await expect(page.getByTestId("dialog-input-field")).toBeVisible();
    expect(await windowOpenCalls(page)).toBe(0); // the page never even tried
  });
});
