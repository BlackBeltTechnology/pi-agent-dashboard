import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { FAKE_GOOGLE_BASE, fakeGoogleConsent, fakeGoogleControl, fakeGoogleState } from "./helpers/fake-google.js";
import {
  accountRow,
  acceptDisclosureOnHost,
  addOwnClient,
  API,
  containerId as googleContainerId,
  continueWithGoogle,
  dashboardPublicOrigin,
  googleState,
  openGoogleSettings,
  resetGoogle,
  routeReturnPageSignIn,
  routeTunnel,
} from "./helpers/google-connect.js";
import { harnessProject } from "./lifecycle.js";

/**
 * L3 — plugin seams end-to-end through the demo-plugin fixture
 * (change: expose-plugin-credential-and-oauth-seams, test-plan F1, F2, X13).
 * F3 (provider dialog unchanged) is the existing
 * delegate-provider-oauth-flow.spec.ts, run unmodified.
 *
 * Nothing is mocked: the demo server entry starts a REAL fake login through
 * `ctx.oauth.startFlow` (auth URL + manual_code; the answer `ok` completes it),
 * the demo settings section renders it via the `ui:oauth-flow` primitive, and
 * completion persists via `ctx.credentials` into the container's
 * `~/.pi/agent/plugin-credentials.json`. X13 drives the demo bridge tool
 * `demo_echo` over the private request lane. The harness sets
 * PI_DASHBOARD_FIXTURE_PLUGINS=1 at build + runtime (docker/compose.test.yml).
 */

function containerId(): string {
  return execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
}

/** Keys of the `demo` namespace in the container's plugin credential store. */
function demoCredentialKeys(): string[] {
  try {
    const raw = execFileSync(
      "docker",
      ["exec", containerId(), "cat", "/home/pi/.pi/agent/plugin-credentials.json"],
      { encoding: "utf8", timeout: 30_000 },
    );
    return Object.keys((JSON.parse(raw) as Record<string, Record<string, unknown>>).demo ?? {});
  } catch {
    return [];
  }
}

async function openDemoSettings(page: Page) {
  await gotoDashboard(page);
  // Start signed-out: a previous run may have left the demo credential.
  await page.request.delete("/api/plugins/demo/account");
  // Plugin settings sections render only under the owning plugin's row.
  await page.goto("/settings/plugins/demo");
  const section = page.getByTestId("demo-oauth");
  await section.waitFor({ state: "visible", timeout: 20_000 });
  await expect(section.getByTestId("demo-oauth-account")).toHaveText("signed out");
  return section;
}

test.describe("plugin OAuth flow via the demo plugin", () => {
  test("F1: start → auth link + paste field → paste ok → complete + persisted", async ({ page }) => {
    const section = await openDemoSettings(page);

    await section.getByTestId("demo-oauth-start").click();
    const waiting = section.getByTestId("dialog-flow-waiting");
    await expect(waiting).toBeVisible({ timeout: 20_000 });
    await expect(waiting.locator('a[href="https://example.invalid/demo/authorize"]')).toBeVisible();
    await expect(section.getByTestId("dialog-input-field")).toBeVisible();

    await section.getByTestId("dialog-input-field").fill("ok");
    await section.getByTestId("dialog-input-submit").click();

    await expect(section.getByTestId("demo-oauth-outcome")).toHaveText("complete", { timeout: 20_000 });
    await expect(section.getByTestId("demo-oauth-account")).toHaveText("signed in");
    expect(demoCredentialKeys()).toContain("demo-account");
  });

  test("F2: cancel converges to the cancelled state and a new start works", async ({ page }) => {
    const section = await openDemoSettings(page);

    await section.getByTestId("demo-oauth-start").click();
    await expect(section.getByTestId("dialog-flow-waiting")).toBeVisible({ timeout: 20_000 });
    await section.getByTestId("dialog-cancel").click();

    await expect(section.getByTestId("demo-oauth-outcome")).toHaveText("Cancelled", { timeout: 20_000 });
    await expect(section.getByTestId("dialog-flow-waiting")).toHaveCount(0);
    await expect(section.getByTestId("demo-oauth-account")).toHaveText("signed out");

    await section.getByTestId("demo-oauth-start").click();
    await expect(section.getByTestId("dialog-flow-waiting")).toBeVisible({ timeout: 20_000 });
    await expect(section.getByTestId("dialog-input-field")).toBeVisible();
    await section.getByTestId("dialog-cancel").click();
  });
});

test.describe("plugin bridge request lane via the demo plugin", () => {
  test("X13: demo_echo round-trips through the private lane", async ({ page }) => {
    // A fresh container seeds no display prefs (all tool bodies hidden): show
    // generic tool results so the expanded step renders its output.
    const prefs = await page.request.patch("/api/preferences/display", {
      data: { toolResults: true, toolCalls: { generic: true } },
    });
    expect(prefs.ok()).toBeTruthy();

    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:demo-echo]] go");

    // The tool step renders its name; expanding it shows the server's reply.
    await expect(page.getByText("demo echo done").first()).toBeVisible({ timeout: 30_000 });
    // Universal grouping wraps even one call in a burst: expand the group
    // header, then the member step, to mount the result body.
    await page.getByTestId("tool-burst-header").first().click();
    const step = page
      .getByTestId("tool-burst-body")
      .first()
      .getByRole("button", { name: /^demo_echo/ })
      .first();
    await expect(step).toBeVisible();
    await step.click();
    await expect(page.getByText("echo: hi").first()).toBeVisible({ timeout: 15_000 });
  });
});

/**
 * L3 — the Google connect dialog end to end (change: add-google-connect; test-plan #A59, #B16, #B21, #B22,
 * #B32, #B39). Real server + client + in-container fake Google; the harness browser is a REMOTE peer, so the
 * built-in app on offer is the `builtin-remote` placeholder (`PI_E2E_GOOGLE_BUILTIN=1`) whose sign-in goes
 * through the return page. The return page is the repo's static `site/oauth/return.html`, served from a fixture
 * route for `https://pi-dashboard.dev`; the Google window is resolved by the fake inside the container.
 */
test.describe("google connect dialog (L3)", () => {
  const cid = googleContainerId();

  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await resetGoogle(page.request, cid);
    acceptDisclosureOnHost(cid);
  });

  test.afterEach(async ({ page }) => {
    await resetGoogle(page.request, cid);
  });

  // (test-plan #A59) — the dialog keeps waiting while the user never finishes on Google.
  test("A59: the dialog keeps waiting while Google is never completed", async ({ page, context }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    await openGoogleSettings(page);
    await continueWithGoogle(page);
    const dialog = page.getByTestId("google-connect-dialog");
    await expect(dialog.getByTestId("google-waiting")).toBeVisible({ timeout: 20_000 });
    // Several poll cycles later (500 ms each) it is still waiting, still pending, nothing stored.
    await page.waitForTimeout(5_000);
    await expect(dialog.getByTestId("google-waiting")).toBeVisible();
    await expect(dialog.getByTestId("google-connect-error-text")).toHaveCount(0);
    expect((await googleState(page.request)).accounts).toHaveLength(0);
  });

  // (test-plan #B21) — remote built-in sign-in: Google → return page → confirm → dashboard, no paste.
  test("B21: remote built-in sign-in through the return page connects without paste", async ({ page, context }) => {
    fakeGoogleControl(cid, "config", { nextEmail: "remote@fake.test" });
    await routeReturnPageSignIn(context, cid);
    const origin = await dashboardPublicOrigin(page.request);
    await routeTunnel(context, origin);
    await openGoogleSettings(page);
    const popup = await continueWithGoogle(page);

    const dialog = page.getByTestId("google-connect-dialog");
    await expect(dialog.getByTestId("google-return-path")).toContainText(/return page/i);
    await expect(popup.locator("#origin")).toHaveText(origin, { timeout: 20_000 });
    const closed = popup.waitForEvent("close", { timeout: 30_000 });
    await popup.getByRole("button", { name: `Continue to ${origin}` }).click();

    await closed;
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("remote@fake.test", { timeout: 30_000 });
    await expect(dialog.getByTestId("dialog-input-field")).toHaveCount(0);
    const state = await googleState(page.request);
    expect(state.accounts.map((a) => [a.email, a.client])).toEqual([["remote@fake.test", "builtin-remote"]]);
  });

  // (test-plan #B22) — the user closes the Google window before returning.
  test("B22: a closed Google window leaves the dialog waiting with the switch; reopening starts a fresh flow", async ({ page, context }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    await openGoogleSettings(page);
    const flows: string[] = [];
    page.on("response", async (r) => {
      if (r.request().method() === "POST" && new URL(r.url()).pathname === `${API}/accounts`) {
        flows.push(((await r.json()) as { flowId: string }).flowId);
      }
    });
    const popup = await continueWithGoogle(page);
    await popup.close();

    const dialog = page.getByTestId("google-connect-dialog");
    await expect(dialog.getByTestId("google-waiting")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3_000);
    await expect(dialog.getByTestId("google-waiting")).toBeVisible();
    await dialog.getByTestId("google-fallback-toggle").click();
    await expect(dialog.getByRole("button", { name: /Window didn.t open or didn.t come back/i })).toBeVisible();
    await expect(dialog.getByTestId("google-fallback")).toBeVisible();
    expect((await googleState(page.request)).accounts).toHaveLength(0);

    await dialog.getByTestId("google-cancel").click();
    await expect(dialog).toHaveCount(0);
    await continueWithGoogle(page);
    await expect(page.getByTestId("google-connect-dialog").getByTestId("google-waiting")).toBeVisible({ timeout: 20_000 });
    expect(flows).toHaveLength(2);
    expect(flows[1]).not.toBe(flows[0]);
  });

  // (test-plan #B16) — a paste fallback exists on every path and a valid redirect URL completes it.
  test("B16: the paste fallback is present on the paste and return paths and completes the sign-in", async ({ page, context }) => {
    const client = await addOwnClient(page.request, "E2E org");
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    await openGoogleSettings(page);

    // Own installed client → the paste path.
    fakeGoogleControl(cid, "config", { nextEmail: "paste@fake.test" });
    await page.getByTestId("google-connect").click();
    let dialog = page.getByTestId("google-connect-dialog");
    await dialog.getByTestId("google-signin-with").selectOption(client);
    await dialog.getByTestId("google-continue").click();
    await dialog.getByTestId("google-fallback-toggle").click();
    const input = dialog.getByTestId("dialog-input-field");
    await expect(input).toBeVisible({ timeout: 20_000 });
    const auth = (await dialog.locator(`a[href^="${FAKE_GOOGLE_BASE}/o/oauth2/v2/auth"]`).getAttribute("href")) as string;
    await input.fill(fakeGoogleConsent(cid, auth));
    await dialog.getByTestId("dialog-input-submit").click();
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("paste@fake.test", { timeout: 20_000 });
    await dialog.getByTestId("google-done").click();

    // Built-in remote → the return path: paste the page's redirect URL (code + state).
    fakeGoogleControl(cid, "config", { nextEmail: "return@fake.test" });
    await page.getByTestId("google-connect").click();
    dialog = page.getByTestId("google-connect-dialog");
    await dialog.getByTestId("google-signin-with").selectOption("builtin-remote");
    await dialog.getByTestId("google-continue").click();
    await dialog.getByTestId("google-fallback-toggle").click();
    await expect(dialog.getByTestId("dialog-input-field")).toBeVisible({ timeout: 20_000 });
    const authReturn = (await dialog.locator(`a[href^="${FAKE_GOOGLE_BASE}/o/oauth2/v2/auth"]`).getAttribute("href")) as string;
    const back = fakeGoogleConsent(cid, authReturn);
    expect(back).toMatch(/^https:\/\/pi-dashboard\.dev\/oauth\/return\.html\?code=.+&state=.+/);
    await dialog.getByTestId("dialog-input-field").fill(back);
    await dialog.getByTestId("dialog-input-submit").click();
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("return@fake.test", { timeout: 20_000 });
    expect((await googleState(page.request)).accounts.map((a) => a.client).sort()).toEqual(["builtin-remote", client]);
  });

  // (test-plan #B32) — only the dashboard's own navigation completes a flow; foreign messages are ignored.
  test("B32: messages from foreign origins never complete the waiting dialog nor call the server", async ({ page, context }) => {
    await context.route(`${FAKE_GOOGLE_BASE}/**`, (r) => r.abort());
    const origins = [
      "https://evil.example",
      "https://pi-dashboard.dev.evil.example",
      "http://pi-dashboard.dev",
      "https://www.pi-dashboard.dev",
    ];
    // Each foreign origin serves a page that posts {code,state} to its parent (the dashboard tab).
    for (const o of origins) {
      await context.route(`${o}/**`, (r) =>
        r.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<script>parent.postMessage({ code: "stolen", state: new URLSearchParams(location.search).get("state") }, "*");</script>`,
        }),
      );
    }
    // Record every message the tab really receives, so "ignored" cannot mean "never delivered".
    await page.addInitScript(() => {
      (window as unknown as { __msgs: string[] }).__msgs = [];
      window.addEventListener("message", (e) => (window as unknown as { __msgs: string[] }).__msgs.push(e.origin));
    });
    await openGoogleSettings(page);
    await continueWithGoogle(page);
    const dialog = page.getByTestId("google-connect-dialog");
    await expect(dialog.getByTestId("google-waiting")).toBeVisible({ timeout: 20_000 });
    await dialog.getByTestId("google-fallback-toggle").click();
    const auth = (await dialog.locator(`a[href^="${FAKE_GOOGLE_BASE}/o/oauth2/v2/auth"]`).getAttribute("href")) as string;
    const state = new URL(auth).searchParams.get("state") as string;

    const writes: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/")) writes.push(`${r.method()} ${r.url()}`);
    });
    for (const o of origins) {
      await page.evaluate(
        ([origin, st]) =>
          new Promise<void>((resolve) => {
            const f = document.createElement("iframe");
            f.onload = () => resolve();
            f.src = `${origin}/return?state=${encodeURIComponent(st as string)}`;
            document.body.appendChild(f);
            setTimeout(resolve, 3_000);
          }),
        [o, state],
      );
    }
    await page.waitForTimeout(1_500);
    const received = await page.evaluate(() => (window as unknown as { __msgs: string[] }).__msgs);
    expect(received.sort()).toEqual([...origins].sort());
    await expect(dialog.getByTestId("google-waiting")).toBeVisible();
    await expect(dialog.getByTestId("google-connected-email")).toHaveCount(0);
    expect(writes, writes.join("\n")).toEqual([]);
    expect((await googleState(page.request)).accounts).toHaveLength(0);
  });

  // (test-plan #B39) — through the tunnel with the built-in remote app, restricted products are unavailable.
  test("B39: the remote built-in app offers no Gmail / full Drive and asks Google for no restricted scope", async ({ page, context }) => {
    await routeReturnPageSignIn(context, cid);
    const origin = await dashboardPublicOrigin(page.request);
    await routeTunnel(context, origin);
    fakeGoogleControl(cid, "config", { nextEmail: "scopes@fake.test" });
    await openGoogleSettings(page);
    await page.getByTestId("google-connect").click();
    const dialog = page.getByTestId("google-connect-dialog");
    await expect(dialog.getByTestId("google-product-check-gmail")).toBeDisabled();
    const reason = dialog.getByTestId("google-gmail-unavailable");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(/own computer/i);
    await expect(reason).toContainText(/organisation sign-in/i);

    const popupPromise = page.context().waitForEvent("page");
    await dialog.getByTestId("google-continue").click();
    const popup = await popupPromise;
    await popup.getByRole("button", { name: `Continue to ${origin}` }).click();
    await expect(dialog.getByTestId("google-connected-email")).toHaveText("scopes@fake.test", { timeout: 30_000 });

    // The outgoing authorization request carried no restricted scope (Gmail, full / read-only Drive).
    const requested = fakeGoogleState(cid).authorizeScopes.join(" ");
    expect(requested).not.toMatch(/gmail/);
    expect(requested).not.toMatch(/auth\/drive(\.readonly)?(\s|$)/);

    // Drive read / write stay unavailable on the account card, with the visible reason.
    await dialog.getByTestId("google-done").click();
    const row = accountRow(page, "scopes@fake.test");
    await row.getByRole("button", { name: /scopes@fake\.test/ }).first().click().catch(() => {});
    await expect(row.getByTestId("google-drive-note")).toContainText(/organisation|own sign-in/i);
    const drive = row.getByTestId("google-level-drive");
    for (const level of ["read", "write"]) await expect(drive.locator(`option[value="${level}"]`)).toBeDisabled();
  });
});
