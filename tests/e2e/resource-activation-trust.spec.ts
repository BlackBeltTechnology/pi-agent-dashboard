import { expect, type Locator, type Page, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard } from "./helpers/index.js";

/**
 * change: project-scope-disable-global-resources — the folder Resources surface
 * must not converge a control to a state the server never accepted.
 *
 * These are the test plan's frontend-quirk scenarios F1–F5. They exercise the
 * *client's* convergence, revert, error-surfacing and presentation rules, so
 * the toggle endpoint is stubbed via `page.route`: the server-side write
 * semantics (origin forms, trust gate, package deltas) are covered by the L1
 * suites, and stubbing keeps these specs deterministic regardless of the
 * container's real trust state.
 *
 * No session is spawned: the folder Resources surface reads its `cwd` from the
 * route and fetches over REST, so it renders for any folder path. Keeping the
 * specs session-free also keeps them off a spawn path they do not exercise.
 */

const SKILLS_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/settings/skills`;

const TRUST_OPTIONS = [
  { id: "trust", label: "Trust", trusted: true },
  { id: "trust-parent", label: "Trust parent folder (/fixtures)", trusted: true },
  { id: "decline", label: "Do not trust", trusted: false },
];

const IMPLICIT_MESSAGE =
  "This folder is trusted implicitly today because it has no pi project configuration. " +
  "Saving this setting creates .pi/settings.json, so pi will require an explicit trust " +
  "decision for this folder from now on.";

/** Land on the folder's Skills page with at least one toggleable card. */
async function openSkillsPage(page: Page): Promise<Locator> {
  // Arms the first-launch-modal dismissal handler (its backdrop would otherwise
  // intercept every click on a freshly wiped container).
  await gotoDashboard(page);
  await page.goto(SKILLS_URL);
  await page.getByTestId("resource-grid-panel").waitFor({ state: "visible", timeout: 20_000 });
  const toggle = page.getByTestId("resource-activation-toggle").first();
  await toggle.waitFor({ state: "visible", timeout: 30_000 });
  return toggle;
}

/** Stub POST /api/resources/toggle with a fixed response. */
async function stubToggle(page: Page, status: number, body: unknown) {
  await page.route("**/api/resources/toggle", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

const trustRequiredBody = {
  success: false,
  error: IMPLICIT_MESSAGE,
  data: { trustRequired: true, trustOptions: TRUST_OPTIONS, implicitlyTrusted: true },
};

test.describe("folder Resources activation — trust, failures and presentation", () => {
  test("F1: a folder with no recorded trust decision gets a dialog, not a converged control", async ({ page }) => {
    const toggle = await openSkillsPage(page);
    const before = await toggle.getAttribute("aria-checked");
    await stubToggle(page, 403, trustRequiredBody);

    await toggle.click();

    const dialog = page.getByTestId("resource-trust-dialog");
    await expect(dialog).toBeVisible();
    for (const opt of TRUST_OPTIONS) {
      await expect(dialog.getByTestId(`resource-trust-option-${opt.id}`)).toBeVisible();
    }
    // The prompt explains why an implicitly-trusted folder is being asked.
    await expect(page.getByTestId("resource-trust-message")).toContainText(/implicitly/i);
    // The control has NOT converged to the requested state.
    await expect(toggle).toHaveAttribute("aria-checked", before ?? "true");
  });

  test("F2: dismissing the dialog without choosing reverts the control and writes nothing", async ({ page }) => {
    const toggle = await openSkillsPage(page);
    const before = await toggle.getAttribute("aria-checked");
    await stubToggle(page, 403, trustRequiredBody);

    let trustCalls = 0;
    await page.route("**/api/resources/trust", async (route) => {
      trustCalls++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });

    await toggle.click();
    await expect(page.getByTestId("resource-trust-dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("resource-trust-dialog")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-checked", before ?? "true");
    expect(trustCalls).toBe(0);
  });

  test("F3: a rejected toggle reverts the control and shows the server's message; a dead request reads differently", async ({ page }) => {
    const toggle = await openSkillsPage(page);
    const before = await toggle.getAttribute("aria-checked");

    // Server refusal: its own message is presented.
    await stubToggle(page, 409, {
      success: false,
      error: "cannot write /fixtures/sample-git/.pi/settings.json: the settings file could not be parsed",
    });
    await toggle.click();

    const banner = page.getByTestId("resource-toggle-error");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "server");
    await expect(banner).toContainText("could not be parsed");
    await expect(toggle).toHaveAttribute("aria-checked", before ?? "true");

    await page.getByTestId("resource-toggle-error-dismiss").click();
    await expect(banner).toHaveCount(0);

    // A request that never reaches the server is reported distinctly.
    await page.unroute("**/api/resources/toggle");
    await page.route("**/api/resources/toggle", (route) => route.abort("failed"));
    await toggle.click();

    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-kind", "network");
    await expect(toggle).toHaveAttribute("aria-checked", before ?? "true");
  });

  test("F4: a disabled global resource keeps its row and says the folder controls activation", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto(SKILLS_URL);
    await page.getByTestId("resource-grid-panel").waitFor({ state: "visible", timeout: 20_000 });

    // Narrow the grid to the global section, so "the section acted in" is
    // unambiguous.
    await page.getByTestId("resource-scope-filter").getByRole("tab", { name: /global/i }).click();
    const card = page.getByTestId("resource-card").first();
    await card.waitFor({ state: "visible", timeout: 30_000 });
    const name = await card.locator("span").first().innerText();
    const toggle = card.getByTestId("resource-activation-toggle");

    await stubToggle(page, 200, { success: true, data: { affectedSessions: [] } });

    await toggle.click();
    // Same row, same section — plus the folder-controlled marker.
    await expect(card.getByTestId("badge-folder-controlled")).toBeVisible();
    await expect(card.getByTestId("badge-scope")).toContainText(/global/i);
    await expect(page.getByTestId("resource-card").first().locator("span").first()).toHaveText(name);

    // Re-enabling restores the original grouping.
    await toggle.click();
    await expect(card.getByTestId("badge-folder-controlled")).toHaveCount(0);
  });

  test("F5: the folder surface states that the change is written to the tracked, shared settings file", async ({ page }) => {
    await openSkillsPage(page);
    const notice = page.getByTestId("resource-repo-scope-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(".pi/settings.json");
    await expect(notice).toContainText(/shared/i);
    await expect(notice).toContainText(/whole-file diff/i);
  });
});

/**
 * change: addons-hub-folder-view (test-plan #F10) — the Add-ons folder switch
 * goes through the same trust gate and the same trust endpoint as the Resources
 * toggle: a needed decision is a 403 `trustRequired`, the follow-up
 * `POST /api/resources/trust` is accepted (the challenge was registered by the
 * add-ons toggle), and the toggle is retried.
 */
test.describe("folder Add-ons switch — trust flow", () => {
  const ADDONS_URL = `/folder/${Buffer.from(FIXTURE_GIT).toString("base64url")}/settings/add-ons`;

  test("F10: turning a From Global row off asks for trust when the folder needs a decision, records it via the shared endpoint, then writes", async ({ page }) => {
    await gotoDashboard(page);
    await page.goto(ADDONS_URL);
    await expect(page.getByTestId("folder-addons-strip")).toBeVisible({ timeout: 30_000 });
    const sw = page.locator('[data-testid^="folder-addon-switch-"]').first();
    await sw.waitFor({ state: "visible", timeout: 30_000 }); // the harness ships global packages (docker/test-entrypoint.sh)
    const row = page.locator('[data-testid^="folder-addon-row-"]').first();

    await sw.click();
    // Real server, real trust state: a folder that needs a decision asks (403 trustRequired → dialog);
    // an already-trusted one writes straight away. Either way the row ends up off.
    const dialog = page.getByTestId("resource-trust-dialog");
    const offBadge = row.locator('[data-testid^="folder-addon-state-"]');
    // Wait for whichever comes first (isVisible() does not wait): the prompt, or the completed off state.
    await expect(dialog.or(offBadge)).toBeVisible({ timeout: 15_000 });
    if (await dialog.isVisible()) {
      const trust = page.waitForResponse((r) => r.url().includes("/api/resources/trust") && r.request().method() === "POST");
      await dialog.getByTestId("resource-trust-option-trust").click();
      // The add-ons toggle registered the challenge, so the shared endpoint accepts the decision (not 409).
      expect((await trust).status()).toBe(200);
    }
    await expect(offBadge).toHaveText("off in this folder", { timeout: 15_000 });

    // Leave the shared fixture as found: turn it back on.
    await sw.click();
    await expect(row.locator('[data-testid^="folder-addon-state-"]')).toHaveCount(0, { timeout: 15_000 });
  });
});
