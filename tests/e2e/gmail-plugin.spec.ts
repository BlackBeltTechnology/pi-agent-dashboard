import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "./fixtures.js";
import {
  FAKE_GOOGLE_BASE,
  fakeGoogleConsent,
  fakeGoogleControl,
  fakeGoogleState,
  startFakeGoogle,
} from "./helpers/fake-google.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

/**
 * L3 — gmail-plugin end to end against an in-container fake Google
 * (change: add-gmail-plugin, test-plan F1–F6; F7/F8 are manual-only).
 *
 * Nothing in the dashboard is mocked: the REAL wizard uploads the client JSON,
 * the REAL server runs the Google sign-in flow (`ctx.oauth.startFlow` →
 * `ui:oauth-flow`) against `PI_E2E_GOOGLE_BASE_URL` (docker/test-up.sh →
 * 127.0.0.1:18090 inside the container), and the REAL bridge tools lease
 * tokens over the private request lane. The browser cannot reach the
 * container's loopback, so consent is completed through the paste fallback:
 * the spec follows the auth URL inside the container and pastes the redirect.
 */

function containerId(): string {
  return execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
    encoding: "utf8",
    timeout: 30_000,
  })
    .trim()
    .split("\n")[0] as string;
}

const CLIENT_JSON = JSON.stringify({
  installed: { client_id: "e2e.apps.googleusercontent.com", client_secret: "e2e-secret", project_id: "e2e-proj-1" },
});

interface Summary {
  sub: string;
  email: string;
  tier: string;
  status: string;
}

async function clearAccounts(page: Page): Promise<void> {
  const res = await page.request.get("/api/plugins/gmail/state");
  const state = (await res.json()) as { accounts: Summary[] };
  for (const a of state.accounts) await page.request.delete(`/api/plugins/gmail/accounts/${encodeURIComponent(a.sub)}`);
}

async function openGmailSettings(page: Page): Promise<Locator> {
  await page.goto("/settings/plugins/gmail");
  const section = page.getByTestId("gmail-settings");
  await section.waitFor({ state: "visible", timeout: 20_000 });
  return section;
}

async function uploadClient(section: Locator): Promise<void> {
  await section.getByTestId("gmail-client-upload").setInputFiles({
    name: "client_secret_e2e.json",
    mimeType: "application/json",
    buffer: Buffer.from(CLIENT_JSON),
  });
  await expect(section.getByTestId("gmail-client-ok")).toBeVisible({ timeout: 15_000 });
}

/** Complete the flow currently shown in `section` via the paste fallback. */
async function consentViaPaste(section: Locator, cid: string): Promise<void> {
  const waiting = section.getByTestId("dialog-flow-waiting");
  await expect(waiting).toBeVisible({ timeout: 20_000 });
  const link = waiting.locator(`a[href^="${FAKE_GOOGLE_BASE}/o/oauth2/v2/auth"]`);
  await expect(link).toBeVisible();
  const redirect = fakeGoogleConsent(cid, (await link.getAttribute("href")) as string);
  expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?code=/);
  await section.getByTestId("dialog-input-field").fill(redirect);
  await section.getByTestId("dialog-input-submit").click();
  await expect(waiting).toHaveCount(0, { timeout: 20_000 });
}

async function addAccount(section: Locator, cid: string, email: string, tier: string): Promise<void> {
  fakeGoogleControl(cid, "config", { nextEmail: email });
  await section.getByTestId("gmail-new-level").selectOption(tier);
  await section.getByTestId("gmail-add-account").click();
  await consentViaPaste(section, cid);
  await expect(row(section, email)).toBeVisible({ timeout: 15_000 });
}

/** Click Revoke on the row and confirm in the host `ui:confirm-dialog`. */
async function revokeConfirmed(page: Page, section: Locator, email: string): Promise<void> {
  await row(section, email).getByTestId("gmail-account-revoke").click();
  const dialog = page.getByTestId("confirm-dialog");
  await expect(dialog).toBeVisible();
  await page.getByTestId("confirm-dialog-action").click();
  await expect(dialog).toHaveCount(0);
}

const row = (section: Locator, email: string) => section.locator(`[data-testid="gmail-account-row"][data-email="${email}"]`);

test.describe("gmail plugin", () => {
  test.describe.configure({ mode: "serial" });
  let cid = "";

  test.beforeAll(async () => {
    cid = containerId();
    await startFakeGoogle(cid);
  });

  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await clearAccounts(page);
    // Reset AFTER clearing: the cleanup's own revokes must not count.
    fakeGoogleControl(cid, "reset");
  });

  test("F1: wizard upload → add account → converges to one readonly/ok row", async ({ page }) => {
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "readonly");
    const rows = section.getByTestId("gmail-account-row");
    await expect(rows).toHaveCount(1);
    const r = row(section, "a@fake.test");
    await expect(r.getByTestId("gmail-account-level")).toHaveValue("readonly");
    await expect(r.getByTestId("gmail-account-status")).toHaveAttribute("data-status", "ok");
  });

  test("F2: a second account keeps its own level", async ({ page }) => {
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "readonly");
    await addAccount(section, cid, "b@fake.test", "send");
    await expect(section.getByTestId("gmail-account-row")).toHaveCount(2);
    await expect(row(section, "a@fake.test").getByTestId("gmail-account-level")).toHaveValue("readonly");
    await expect(row(section, "b@fake.test").getByTestId("gmail-account-level")).toHaveValue("send");
  });

  test("F3: raise re-consents; lower applies immediately with no flow", async ({ page }) => {
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "readonly");
    fakeGoogleControl(cid, "config", { nextEmail: "a@fake.test" });
    await row(section, "a@fake.test").getByTestId("gmail-account-level").selectOption("send");
    await consentViaPaste(section, cid);
    await expect(row(section, "a@fake.test").getByTestId("gmail-account-level")).toHaveValue("send", { timeout: 15_000 });

    await row(section, "a@fake.test").getByTestId("gmail-account-level").selectOption("draft");
    await expect(row(section, "a@fake.test").getByTestId("gmail-account-level")).toHaveValue("draft");
    await expect(section.getByTestId("dialog-flow-waiting")).toHaveCount(0);
  });

  test("F4: revoke removes the row; Google down → must revoke manually", async ({ page }) => {
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "readonly");
    await addAccount(section, cid, "b@fake.test", "readonly");

    // test-plan #F8 (improve-gmail-settings-ux): dismissing the confirm sends nothing.
    const dialog = page.getByTestId("confirm-dialog");
    await row(section, "b@fake.test").getByTestId("gmail-account-revoke").click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("b@fake.test");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(row(section, "b@fake.test")).toHaveCount(1);
    expect(fakeGoogleState(cid).revokes).toBe(0);

    await revokeConfirmed(page, section, "b@fake.test");
    await expect(row(section, "b@fake.test")).toHaveCount(0, { timeout: 15_000 });
    await expect(section.getByTestId("gmail-revoke-result")).toContainText("revoked at Google");
    expect(fakeGoogleState(cid).revokes).toBe(1);

    fakeGoogleControl(cid, "config", { revokeDown: true });
    await revokeConfirmed(page, section, "a@fake.test");
    await expect(row(section, "a@fake.test")).toHaveCount(0, { timeout: 15_000 });
    await expect(section.getByTestId("gmail-revoke-result")).toContainText("myaccount.google.com/permissions");
  });

  test("F5: gmail_send raises its confirm card; approving sends once", async ({ page }) => {
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "send");

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

  test("F6: a dead grant surfaces reauth_required in the tool and the panel badge", async ({ page }) => {
    // Short-lived access tokens force a refresh on the first lease.
    fakeGoogleControl(cid, "config", { expiresIn: 30 });
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "readonly");
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

    const again = await openGmailSettings(page);
    await expect(row(again, "a@fake.test").getByTestId("gmail-account-status")).toHaveAttribute("data-status", "reauth_required");
    await expect(row(again, "a@fake.test").getByTestId("gmail-account-status")).toHaveText("Re-auth needed");
  });

  test("improve-gmail-plugin-setup-ux F2: a display name is explained; the saved id and owner survive a reload and tint the links", async ({
    page,
  }) => {
    const section = await openGmailSettings(page);
    const project = section.getByTestId("gmail-project-id");
    const owner = section.getByTestId("gmail-owner-account");
    try {
      await project.fill("PiDashboard");
      await expect(section.getByTestId("gmail-project-error")).toHaveCount(0); // not while typing
      await expect(section.getByTestId("gmail-need-project-id")).toBeVisible();
      await project.blur();
      await expect(section.getByTestId("gmail-project-error")).toBeVisible();
      await expect(section.getByTestId("gmail-project-error")).toContainText(/project name/i);

      await project.fill("pidashboard-510015");
      await expect(section.getByTestId("gmail-project-error")).toHaveCount(0);
      await project.blur();
      await owner.fill("csakany.robert@gmail.com");
      await owner.blur();
      await expect.poll(async () => (await (await page.request.get("/api/plugins/gmail/state")).json()).setup).toEqual({
        projectId: "pidashboard-510015",
        ownerAccount: "csakany.robert@gmail.com",
      });

      await page.reload();
      const again = page.getByTestId("gmail-settings");
      await again.waitFor({ state: "visible", timeout: 20_000 });
      await expect(again.getByTestId("gmail-project-id")).toHaveValue("pidashboard-510015");
      await expect(again.getByTestId("gmail-owner-account")).toHaveValue("csakany.robert@gmail.com");
      await expect(again.locator('a[href*="gmail.googleapis.com"]').first()).toHaveAttribute(
        "href",
        /authuser=csakany\.robert%40gmail\.com/,
      );
    } finally {
      await page.request.put("/api/plugins/gmail/setup", { data: { projectId: "", ownerAccount: "" } });
    }
  });

  test("improve-gmail-plugin-setup-ux F3: turning filters on re-consents with settings.basic; an agent archive rule becomes one filter", async ({
    page,
  }) => {
    const section = await openGmailSettings(page);
    await uploadClient(section);
    await addAccount(section, cid, "a@fake.test", "send");
    const toggle = row(section, "a@fake.test").getByRole("switch", { name: "Filters for a@fake.test" });
    await expect(toggle).not.toBeChecked();

    fakeGoogleControl(cid, "config", { nextEmail: "a@fake.test" });
    // Off → on needs the extra scope, so the box stays unchecked until the grant lands (check() would assert it flips).
    await toggle.click();
    await consentViaPaste(section, cid);
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
  // add-gmail-auto-setup (test-plan F5): the real settings page with the automatic-setup endpoints
  // answered by route stubs (the dedicated Chrome is not part of the harness). The computed
  // contrast/size/focus probes for every state run in retro-ux-plugin-settings-forms.spec.ts via
  // `fixtures/retro-ux/gmail.ts`; this spec proves the states render, follow the 1 s poll, and that
  // every pre-existing `gmail-*` test id still renders beside them.
  test("add-gmail-auto-setup F5: entry → run states follow the poll; existing test ids still render", async ({ page }) => {
    const real = (await (await page.request.get("/api/plugins/gmail/state")).json()) as Record<string, unknown>;
    const steps = (step: string) =>
      ["project", "api", "branding", "publish", "client", "capture"].map((id, i, all) => ({
        id,
        status: i < all.indexOf(step) ? "done" : i === all.indexOf(step) ? "running" : "pending",
      }));
    const base = { runId: "r1", created: { clients: [] }, ownerEmail: "owner@gmail.com" };
    let view: Record<string, unknown> = { ...base, state: "running", step: "project", steps: steps("project") };
    await page.route("**/api/plugins/gmail/state", (route) =>
      route.fulfill({ json: { ...real, autoSetup: { available: true, local: true } } }),
    );
    await page.route("**/api/plugins/gmail/setup/run", (route) => route.fulfill({ json: { runId: "r1" } }));
    await page.route("**/api/plugins/gmail/setup/run/r1", (route) => route.fulfill({ json: view }));

    const section = await openGmailSettings(page);
    for (const id of ["gmail-wizard", "gmail-accounts", "gmail-add-account", "gmail-new-level", "gmail-cross-org-hint", "gmail-level-help"]) {
      await expect(section.getByTestId(id), id).toBeVisible();
    }
    await expect(section.locator('button[class*="bg-[var(--accent-solid)]"]:not([role="switch"])')).toHaveCount(1); // Add account stays the one primary

    await section.getByTestId("gmail-setup-entry").click();
    await section.getByTestId("gmail-setup-owner").fill("owner@gmail.com");
    await section.getByTestId("gmail-setup-start").click();
    await expect(section.getByTestId("gmail-setup-working")).toBeVisible();
    await expect(section.getByTestId("gmail-setup-step-project")).toHaveAttribute("aria-current", "step");

    view = { ...base, state: "waiting_user", step: "branding", steps: steps("branding"), checkpoint: { kind: "policy" } };
    await expect(section.getByTestId("gmail-setup-checkpoint")).toContainText("User Data Policy", { timeout: 10_000 });
    await expect(section.getByTestId("gmail-setup-step-branding")).toHaveAttribute("aria-current", "step");

    view = {
      ...base,
      state: "waiting_decision",
      step: "branding",
      steps: steps("branding"),
      decision: { kind: "audience", detected: "external" },
    };
    await expect(section.getByTestId("gmail-setup-audience-external")).toBeVisible({ timeout: 10_000 });
    await expect(section.getByTestId("gmail-setup-audience-internal")).toHaveCount(0);

    view = { ...base, state: "busy", step: "project", steps: steps("project"), busy: { holder: "agent session 7" } };
    await expect(section.getByTestId("gmail-setup-busy-holder")).toContainText("agent session 7", { timeout: 10_000 });

    view = {
      ...base,
      state: "handoff",
      step: "capture",
      steps: steps("capture").map((s) => (s.id === "capture" ? { ...s, status: "handoff" } : s)),
      handoff: { step: "capture", wizardStep: 4, reason: "secret_capture_failed" },
      projectId: "e2e-proj-1",
      created: { projectId: "e2e-proj-1", clients: ["pi-dashboard-2"] },
    };
    await expect(section.getByTestId("gmail-setup-handoff")).toBeVisible({ timeout: 10_000 });
    await expect(section.getByTestId("gmail-step-4")).toHaveAttribute("aria-current", "step");
    await expect(section.getByTestId("gmail-project-id")).toHaveValue("e2e-proj-1");
    await expect(section.getByTestId("gmail-setup-secret-help")).toContainText("pi-dashboard-2");
  });
});
