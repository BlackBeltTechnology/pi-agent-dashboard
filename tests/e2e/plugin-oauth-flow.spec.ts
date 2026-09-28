import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, sendPrompt, spawnFreshGitSession } from "./helpers/index.js";
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
