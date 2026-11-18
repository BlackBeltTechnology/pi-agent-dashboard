/**
 * E2E: agent secret guards (change: harden-agent-tool-guards, test-plan #F1–#F5).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the credential guard, the path-gate carve-out and the sensitive
 * list. Only a live browser against a real server + real bridge + faux model proves
 * the user-visible outcome: a read of a pi-agent secret is refused with
 * `credential_guard` and NEVER raises a card (even under unscoped YOLO); an ask-on-read
 * file raises exactly one card that offers `Allow once` / `Deny` and no `Always allow`;
 * credential directories and browser profiles are marked sensitive the same way; and
 * unscoped YOLO does not auto-allow a credential directory while still covering an
 * ordinary out-of-root read.
 *
 * Faux scenarios (qa/fixtures/faux-scenarios.ts): `tool-read-agent-models`,
 * `tool-read-agent-auth`, `tool-read-credential-dirs`, `tool-read-other-session-twice`,
 * `tool-read-aws-then-outside`. The paths need not exist: the guard and the gate decide
 * on the path before any read.
 *
 * Not covered here: "a read in the session's OWN session dir raises no card" (#F3 second
 * half) — the dir name encodes the clone cwd, which a static faux script cannot know; it is
 * pinned at L1 (decide-carveout T.16).
 *
 * Authored WITHOUT a runnable docker harness: first run happens in CI / ship-it.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

const GATE_TITLE = /outside its workspace/i;
const SENSITIVE = /sensitive location/i;

const allowOnce = (page: Page) => page.getByRole("button", { name: /^Allow once/i }).first();
const deny = (page: Page) => page.getByRole("button", { name: /^Deny/i }).first();
const always = (page: Page) => page.getByRole("button", { name: /^Always allow/i });

async function setGate(page: Page, enabled: boolean) {
  const res = await page.request.put("/api/config", { data: { agentPathGate: { enabled, timeoutSeconds: 120 } } });
  expect(res.ok()).toBe(true);
}
const startYolo = (page: Page) =>
  page.request.post("/api/access/yolo", { data: { durationMinutes: 15, base: "/tmp", unscoped: true } });
const endYolo = (page: Page) => page.request.delete("/api/access/yolo").catch(() => undefined);

async function run(page: Page, scenario: string) {
  const card = await spawnFreshGitSession(page);
  await card.click();
  await sendPrompt(page, `[[faux:${scenario}]] go`);
}

/** Expand the tool burst (auto-collapsed when done) until `text` is visible. */
async function expectToolText(page: Page, text: RegExp) {
  const target = page.getByText(text).first();
  await expect(async () => {
    if (!(await target.isVisible())) {
      if (!(await page.getByTestId("tool-burst-body").isVisible())) await page.getByTestId("tool-burst-header").click();
      if (!(await target.isVisible())) await page.getByTestId("tool-burst-body").getByRole("button").first().click();
    }
    await expect(target).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("agent secret guards (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await setGate(page, true);
  });
  test.afterEach(async ({ page }) => {
    await endYolo(page);
    await setGate(page, true).catch(() => undefined);
  });

  test("#F1 models.json raises one sensitive card with Allow once / Deny only; Deny blocks the read", async ({ page }) => {
    await run(page, "tool-read-agent-models");
    await expect(page.getByText(SENSITIVE).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(GATE_TITLE)).toHaveCount(1);
    await expect(allowOnce(page)).toBeVisible();
    await expect(deny(page)).toBeVisible();
    await expect(always(page)).toHaveCount(0);
    await deny(page).click();
    await expect(page.getByText("agent models read done")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tool-burst-failed-badge")).toBeVisible({ timeout: 15_000 });
  });

  test("#F2 credential dirs and a browser profile are each sensitive: no Always allow", async ({ page }) => {
    await run(page, "tool-read-credential-dirs");
    for (const target of ["/.aws/credentials", "/.netrc", "/.config/google-chrome/Default/Cookies"]) {
      await expect(page.getByText(target).filter({ hasText: SENSITIVE }).first()).toBeVisible({ timeout: 30_000 });
      await expect(always(page)).toHaveCount(0);
      await deny(page).click();
    }
    await expect(page.getByText("credential dirs read done")).toBeVisible({ timeout: 30_000 });
  });

  test("#F3 Allow once on another project's session file does not carry to a repeat read", async ({ page }) => {
    await run(page, "tool-read-other-session-twice");
    await expect(page.getByText(SENSITIVE).first()).toBeVisible({ timeout: 30_000 });
    await allowOnce(page).click();
    // The identical second read is a NEW decision: a second card appears, nothing was remembered.
    await expect(page.getByText(GATE_TITLE)).toHaveCount(2, { timeout: 30_000 });
    await expect(always(page)).toHaveCount(0);
    await deny(page).click();
    await expect(page.getByText("other session reads done")).toBeVisible({ timeout: 30_000 });
  });

  test("#F4 auth.json is blocked with credential_guard and never prompts, with and without unscoped YOLO", async ({ page }) => {
    for (const yolo of [false, true]) {
      if (yolo) expect((await startYolo(page)).ok()).toBe(true);
      await run(page, "tool-read-agent-auth");
      await expect(page.getByText("agent auth read done")).toBeVisible({ timeout: 30_000 });
      await expectToolText(page, /credential_guard/);
      await expect(page.getByText(GATE_TITLE)).toHaveCount(0);
      await expect(allowOnce(page)).toHaveCount(0);
    }
  });

  test("#F5 unscoped YOLO: a credential dir still asks (no auto-allow), an ordinary outside read runs silently", async ({ page }) => {
    expect((await startYolo(page)).ok()).toBe(true);
    await run(page, "tool-read-aws-then-outside");
    await expect(page.getByText(SENSITIVE).first()).toBeVisible({ timeout: 30_000 });
    await expect(always(page)).toHaveCount(0);
    await deny(page).click();
    await expect(page.getByText("aws then outside done")).toBeVisible({ timeout: 30_000 });
    // Only the credential read raised a card; the /srv/fixtures-outside read was covered by YOLO.
    await expect(page.getByText(GATE_TITLE)).toHaveCount(1);
  });
});
