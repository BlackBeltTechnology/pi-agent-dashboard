import { expect, type Locator, type Page, test } from "./fixtures.js";
import { FAKE_GOOGLE_BASE, fakeGoogleConsent, fakeGoogleControl, fakeGoogleState } from "./helpers/fake-google.js";
import {
  accountRow,
  addOwnClient,
  cancelFlows,
  containerId as googleContainerId,
  googleState,
  openGoogleSettings,
  resetGoogle,
  seedAccount,
  trackFlows,
} from "./helpers/google-connect.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { gatewayUrlWithTicket, pairDeviceBearer } from "./helpers/bridge-credential.js";
import { BASE_URL } from "./lifecycle.js";

/*
 * gmail-plugin L3 (changes: add-gmail-plugin, add-google-connect D10). Account, client and setup management moved to
 * the Google plugin: the Gmail wizard/REST of the old F1–F6, setup-ux F2 (project id/owner) and auto-setup F5
 * were removed with it. What survives lives below against Settings → Google accounts; the Gmail tools lease through it.
 */

/**
 * harden-bridge-session-claim BE106 (L3): the REAL host lane refuses a session admitted as a paired device
 * (remote origin on a `device-ticket` socket) with `origin_denied` and discloses nothing, without touching the
 * DOM. The hub-local half (a unix-socket session leases) is the lane/gateway L1 suite; the harness spec runs
 * on the host, where the gateway sees a docker address, so every socket here is remote by construction.
 */
test("harden-bridge-session-claim BE106: a paired-device session gets origin_denied from gmail/lease and gmail/accounts", async ({ request }) => {
  const health = (await (await request.get("/api/health")).json()) as { piGatewayPort?: number | null };
  test.skip(!health.piGatewayPort, "harness health does not expose the bound gateway port");
  const bearer = await pairDeviceBearer(BASE_URL);
  const url = await gatewayUrlWithTicket(BASE_URL, health.piGatewayPort as number, bearer);
  const sessionId = `e2e-gmail-remote-${Date.now()}`;
  const frames: Array<Record<string, unknown>> = [];
  const ws = new WebSocket(url);
  ws.addEventListener("message", (ev) => { try { frames.push(JSON.parse(String(ev.data))); } catch { /* ignore */ } });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
    ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("socket error")); }, { once: true });
  });
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/tmp/e2e-gmail-remote", source: "tui", pid: 424242 }));
  await new Promise((r) => setTimeout(r, 500));
  ws.send(JSON.stringify({ type: "plugin_request", requestId: "lease-1", pluginId: "gmail", messageType: "gmail/lease", payload: { account: "any", op: "read" } }));
  ws.send(JSON.stringify({ type: "plugin_request", requestId: "acct-1", pluginId: "gmail", messageType: "gmail/accounts", payload: {} }));
  await expect.poll(() => frames.filter((f) => f.type === "plugin_reply").length, { timeout: 10_000 }).toBe(2);
  for (const f of frames.filter((x) => x.type === "plugin_reply")) {
    expect(f.ok).toBe(false);
    expect(String(f.error)).toMatch(/^origin_denied: /);
    expect(JSON.stringify(f)).not.toMatch(/accessToken|@/);
  }
  ws.close();
});


/**
 * L3 — product changes on a connected Google account, and the Gmail settings pointer (change: add-google-connect;
 * test-plan #A100, #A111, #B140). The account lives in the Google plugin (own installed client, paste consent
 * through the in-container fake Google); Gmail's own settings page is only a pointer to it.
 */
test.describe("google accounts: product changes and the Gmail pointer (L3)", () => {
  let cid = "";
  test.beforeAll(() => {
    cid = googleContainerId(); // lazily: `playwright test --list` loads this file without a harness
  });

  let flows: string[] = [];
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await resetGoogle(page.request, cid);
    flows = trackFlows(page);
  });

  test.afterEach(async ({ page }) => {
    await cancelFlows(page.request, flows);
    await resetGoogle(page.request, cid);
  });

  /** Expand the account row and return it. */
  async function expandRow(page: Page, email: string): Promise<Locator> {
    const r = accountRow(page, email);
    await expect(r).toBeVisible({ timeout: 20_000 });
    await r.getByTestId("google-account-toggle").click();
    return r;
  }

  /** Complete the flow the open dialog is waiting on through its paste fallback. */
  async function pasteConsent(page: Page): Promise<Locator> {
    const dialog = page.getByTestId("google-connect-dialog");
    await dialog.getByTestId("google-continue").click();
    await expect(dialog.getByTestId("google-waiting")).toBeVisible({ timeout: 20_000 });
    await dialog.getByTestId("google-fallback-toggle").click();
    const auth = (await dialog.locator(`a[href^="${FAKE_GOOGLE_BASE}/o/oauth2/v2/auth"]`).getAttribute("href")) as string;
    await dialog.getByTestId("dialog-input-field").fill(fakeGoogleConsent(cid, auth));
    await dialog.getByTestId("dialog-input-submit").click();
    return dialog;
  }

  // (test-plan #A100) — Google's reply lacks what the account already uses → nothing changes.
  test("A100: a narrower consent reply changes nothing", async ({ page, context }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    const narrowEmail = `narrow-${Date.now()}@fake.test`;
    const client = await addOwnClient(page.request);
    await seedAccount(page.request, cid, narrowEmail, client, { gmail: { level: "readonly" } });
    const before = await googleState(page.request);

    await openGoogleSettings(page);
    const row = await expandRow(page, narrowEmail);
    // The consent page "unticks Gmail": the reply no longer carries the Gmail scope.
    fakeGoogleControl(cid, "config", { dropScopes: ["gmail"] });
    await row.getByTestId("google-level-calendar").selectOption("read");
    const dialog = await pasteConsent(page);
    await expect(dialog.getByTestId("google-connect-error")).toContainText(`Nothing was changed for ${narrowEmail}`, { timeout: 20_000 });
    await dialog.getByTestId("google-cancel").click();
    await expect(dialog).toHaveCount(0);

    const again = accountRow(page, narrowEmail);
    await expect(again.getByTestId("google-level-gmail")).toHaveValue("readonly");
    await expect(again.getByTestId("google-level-calendar")).toHaveValue("off");
    await expect(again.getByTestId("google-account-status")).toHaveAttribute("data-status", "ok");
    // Server side: the same products, status and grant time; no token material in what the page reads.
    const after = await googleState(page.request);
    expect(after.accounts.map((a) => [a.email, a.status, a.products])).toEqual(before.accounts.map((a) => [a.email, a.status, a.products]));
    expect(JSON.stringify(after)).not.toMatch(/refresh|access_token|client_secret/i);
  });

  // (test-plan #A111) — a product change reuses the connect dialog.
  test("A111: setting Slides to Read reuses the dialog and leaves Gmail untouched", async ({ page, context }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    const client = await addOwnClient(page.request, "Semmi", ["semmi.se"]);
    await seedAccount(page.request, cid, "robson@semmi.se", client, { gmail: { level: "readonly" }, calendar: { level: "read" } });

    await openGoogleSettings(page);
    const row = await expandRow(page, "robson@semmi.se");
    await row.getByTestId("google-level-slides").selectOption("read");
    const dialog = await pasteConsent(page);
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("robson@semmi.se", { timeout: 20_000 });
    await expect(dialog.getByTestId("google-connect-result")).toContainText(/Slides/);
    await dialog.getByTestId("google-done").click();
    await expect(dialog).toHaveCount(0);

    await expect(row.getByTestId("google-level-slides")).toHaveValue("read");
    await expect(row.getByTestId("google-level-gmail")).toHaveValue("readonly");
    const acct = (await googleState(page.request)).accounts.find((a) => a.email === "robson@semmi.se");
    expect(acct?.products.slides?.level).toBe("read");
    expect(acct?.products.gmail?.level).toBe("readonly");
  });

  /** Seed one connected account on `client` with a Gmail level (REST start → fake consent → paste input). */
  const connect = (page: Page, client: string, email: string, level: string) =>
    seedAccount(page.request, cid, email, client, { gmail: { level } });

  /** Open Settings → Google accounts and expand `email`'s row. */
  async function openRow(page: Page, email: string): Promise<Locator> {
    await openGoogleSettings(page);
    return expandRow(page, email);
  }

  /** Click Disconnect on the expanded row and confirm (optionally also revoking at Google). */
  async function disconnect(page: Page, row: Locator, opts: { revoke: boolean }): Promise<void> {
    await row.getByTestId("google-account-disconnect").click();
    if (opts.revoke) await page.getByLabel("Also remove access at Google").check();
    await page.getByTestId("google-disconnect-confirm").click();
  }

  // (test-plan #B137) — what the removed Gmail wizard/REST used to do now answers 410 `moved`; the state stays readable.
  test("B137: the removed Gmail management routes answer 410 moved and nothing is stored", async ({ page }) => {
    const client = await addOwnClient(page.request);
    await connect(page, client, "moved@fake.test", "readonly");
    const routes: Array<[string, string]> = [
      ["PUT", "/client"],
      ["PUT", "/setup"],
      ["GET", "/accounts"],
      ["POST", "/accounts"],
      ["PATCH", "/accounts/x"],
      ["DELETE", "/accounts/x"],
      ["POST", "/accounts/x/level"],
      ["POST", "/accounts/x/reauth"],
      ["POST", "/accounts/x/filters"],
      ["POST", "/setup/run"],
      ["GET", "/setup/run/r1"],
    ];
    for (const [method, path] of routes) {
      const res = await page.request.fetch(`/api/plugins/gmail${path}`, { method, data: method === "GET" ? undefined : {} });
      expect(res.status(), `${method} ${path}`).toBe(410);
      expect(await res.json(), `${method} ${path}`).toEqual({ error: "moved" });
    }
    const state = await page.request.get("/api/plugins/gmail/state");
    expect(state.status()).toBe(200);
    expect(await state.json()).toEqual({ moved: true });
    // Nothing the refused calls could have touched changed: the Google account is still there.
    expect((await googleState(page.request)).accounts.map((a) => a.email)).toEqual(["moved@fake.test"]);
  });

  // Replaces the removed Gmail wizard F1: a Gmail account now lives in Settings → Google accounts.
  test("F1: a Gmail account connected through Google converges to one readonly/ok row", async ({ page }) => {
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "readonly");
    const row = await openRow(page, "a@fake.test");
    await expect(page.getByTestId("google-account-row")).toHaveCount(1);
    await expect(row.getByTestId("google-level-gmail")).toHaveValue("readonly");
    await expect(row.getByTestId("google-account-status")).toHaveAttribute("data-status", "ok");
  });

  test("F2: a second account keeps its own Gmail level", async ({ page }) => {
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "readonly");
    await connect(page, client, "b@fake.test", "send");
    await openGoogleSettings(page);
    await expect(page.getByTestId("google-account-row")).toHaveCount(2);
    const a = await expandRow(page, "a@fake.test");
    const b = await expandRow(page, "b@fake.test");
    await expect(a.getByTestId("google-level-gmail")).toHaveValue("readonly");
    await expect(b.getByTestId("google-level-gmail")).toHaveValue("send");
  });

  test("F3: raising Gmail re-consents; lowering applies immediately with no flow", async ({ page, context }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "readonly");
    const row = await openRow(page, "a@fake.test");

    await row.getByTestId("google-level-gmail").selectOption("send");
    const dialog = await pasteConsent(page);
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("a@fake.test", { timeout: 20_000 });
    await dialog.getByTestId("google-done").click();
    await expect(row.getByTestId("google-level-gmail")).toHaveValue("send", { timeout: 15_000 });

    await row.getByTestId("google-level-gmail").selectOption("draft");
    await expect(row.getByTestId("google-level-gmail")).toHaveValue("draft");
    await expect(page.getByTestId("google-connect-dialog")).toHaveCount(0);
    await expect.poll(async () => (await googleState(page.request)).accounts[0]?.products.gmail?.level).toBe("draft");
  });

  test("F4: disconnect removes the row; Google down → must remove access manually", async ({ page }) => {
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "readonly");
    await connect(page, client, "b@fake.test", "readonly");
    await openGoogleSettings(page);
    const b = await expandRow(page, "b@fake.test");

    // Dismissing the confirmation sends nothing.
    await b.getByTestId("google-account-disconnect").click();
    const dialog = page.getByTestId("google-disconnect-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("b@fake.test");
    await page.getByTestId("google-disconnect-cancel").click();
    await expect(dialog).toHaveCount(0);
    await expect(accountRow(page, "b@fake.test")).toHaveCount(1);
    expect(fakeGoogleState(cid).revokes).toBe(0);

    await disconnect(page, b, { revoke: true });
    await expect(accountRow(page, "b@fake.test")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("google-disconnect-result")).toHaveCount(0);
    expect(fakeGoogleState(cid).revokes).toBe(1);

    fakeGoogleControl(cid, "config", { revokeDown: true });
    const a = await expandRow(page, "a@fake.test");
    await disconnect(page, a, { revoke: true });
    await expect(accountRow(page, "a@fake.test")).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("google-disconnect-result")).toContainText("myaccount.google.com/connections");
  });

  test("F5: gmail_send raises its confirm card; approving sends once", async ({ page }) => {
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "send");

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:gmail-send]] go");

    await expect(page.getByText("Gmail: send from a@fake.test").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/To: x@dest\.test, y@dest\.test/).first()).toBeVisible();
    expect(fakeGoogleState(cid).sends).toHaveLength(0);

    await page.getByRole("button", { name: /^yes$/i }).first().click();
    await expect(page.getByText("gmail send done").first()).toBeVisible({ timeout: 30_000 });
    const sends = fakeGoogleState(cid).sends;
    expect(sends).toHaveLength(1);
    expect(sends[0]?.to).toEqual(["x@dest.test", "y@dest.test"]);
  });

  test("F6: a dead grant surfaces reauth_required in the tool and the Google accounts badge", async ({ page }) => {
    // Short-lived access tokens force a refresh on the first lease.
    fakeGoogleControl(cid, "config", { expiresIn: 30 });
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "readonly");
    fakeGoogleControl(cid, "config", { invalidGrant: true });

    const prefs = await page.request.patch("/api/preferences/display", {
      data: { toolResults: true, toolCalls: { generic: true } },
    });
    expect(prefs.ok()).toBeTruthy();
    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:gmail-search]] go");
    await expect(page.getByText("gmail search done").first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("tool-burst-header").first().click();
    const step = page.getByTestId("tool-burst-body").first().getByRole("button", { name: /^gmail_search/ }).first();
    await step.click();
    await expect(page.getByText(/reauth_required/).first()).toBeVisible({ timeout: 15_000 });

    await openGoogleSettings(page);
    const status = accountRow(page, "a@fake.test").getByTestId("google-account-status");
    await expect(status).toHaveAttribute("data-status", "reauth_required");
    await expect(status).toHaveText("Sign in again");
  });

  test("F3 (filters): turning Gmail filters on re-consents with settings.basic; an agent archive rule becomes one filter", async ({
    page,
    context,
  }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    const client = await addOwnClient(page.request);
    await connect(page, client, "a@fake.test", "send");
    const row = await openRow(page, "a@fake.test");
    const toggle = row.getByRole("checkbox", { name: "Gmail filters for a@fake.test" });
    await expect(toggle).not.toBeChecked();

    // Off → on needs the extra scope, so the box stays unchecked until the grant lands.
    await toggle.click();
    const dialog = await pasteConsent(page);
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("a@fake.test", { timeout: 20_000 });
    await dialog.getByTestId("google-done").click();
    await expect(toggle).toBeChecked({ timeout: 15_000 });
    const scopes = fakeGoogleState(cid).authorizeScopes;
    expect(scopes.at(-1)).toContain("https://www.googleapis.com/auth/gmail.settings.basic");
    expect(scopes.at(-1)).not.toContain("gmail.settings.sharing");

    const card = await spawnFreshGitSession(page);
    await card.click();
    await sendPrompt(page, "[[faux:gmail-filter-create]] go");
    await expect(page.getByText("Gmail: create filter in a@fake.test").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/all future matching mail/).first()).toBeVisible();
    expect(fakeGoogleState(cid).filters).toHaveLength(0);

    await page.getByRole("button", { name: /^yes$/i }).first().click();
    await expect(page.getByText("gmail filter done").first()).toBeVisible({ timeout: 30_000 });
    const filters = fakeGoogleState(cid).filters;
    expect(filters).toHaveLength(1);
    expect(filters[0]?.action?.removeLabelIds).toEqual(["INBOX"]);
    expect(filters[0]?.criteria).toEqual({ from: "newsletter@dest.test" });
  });

  // (test-plan #B140) — Gmail's settings only point to Google accounts.
  test("B140: the Gmail settings notice links to Settings → Google accounts", async ({ page }) => {
    const client = await addOwnClient(page.request);
    await seedAccount(page.request, cid, "pointer@fake.test", client, { gmail: { level: "readonly" } });
    await page.goto("/settings/plugins/gmail");
    const section = page.getByTestId("gmail-settings");
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(section.getByTestId("gmail-moved")).toBeVisible();
    // No account / client controls remain on the Gmail page.
    await expect(section.getByTestId("gmail-add-account")).toHaveCount(0);
    await section.getByTestId("gmail-open-google").click();
    await expect(page).toHaveURL(/\/settings\/plugins\/google$/);
    const google = page.getByTestId("google-settings");
    await expect(google).toBeVisible({ timeout: 20_000 });
    await expect(google.getByRole("heading", { name: "Google accounts" })).toBeVisible();
    await expect(accountRow(page, "pointer@fake.test")).toBeVisible();
  });
});
