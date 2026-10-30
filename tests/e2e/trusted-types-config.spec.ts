import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { BASE_URL } from "./lifecycle.js";

/**
 * Trusted Types mode through the operator control (test-plan #F6): Settings → Security → "Enforce" →
 * Save → restart → the document states `enforce` and an enforcing policy carries
 * `require-trusted-types-for 'script'`; then Default is restored (key removed) and the document is
 * back to `report`. Glue: tests/e2e/acp-restart-midturn.spec.ts (restart), tests/e2e/blackhole-settings.spec.ts
 * (settings save). The harness must run with `PI_DASHBOARD_TRUSTED_TYPES` unset (env beats config).
 *
 * See change: enforce-trusted-types-default.
 */
const TT = "require-trusted-types-for 'script'";

async function serverPid(page: Page): Promise<number | null> {
  try {
    const res = await page.request.get("/api/health", { timeout: 5_000 });
    return res.ok() ? (((await res.json()) as { pid?: number }).pid ?? null) : null;
  } catch {
    return null;
  }
}

async function restart(page: Page): Promise<void> {
  const before = await serverPid(page);
  expect(before).not.toBeNull();
  await page.request.post("/api/restart", { timeout: 10_000 }).catch(() => {});
  await expect
    .poll(async () => {
      const p = await serverPid(page);
      return p !== null && p !== before;
    }, { timeout: 90_000, intervals: [1_000] })
    .toBe(true);
}

/** The document's stated mode and whether an ENFORCING policy carries the directive (no interception). */
async function documentState(page: Page): Promise<{ meta: string | null; enforcing: boolean }> {
  const res = await page.request.get(`${BASE_URL}/`);
  const html = await res.text();
  const meta = /<meta name="pi-trusted-types" content="([^"]*)"/.exec(html)?.[1] ?? null;
  const enforcing = (res.headers()["content-security-policy"] ?? "").includes(TT);
  return { meta, enforcing };
}

async function chooseAndSave(page: Page, value: string): Promise<void> {
  await gotoDashboard(page, "/settings/security");
  const select = page.getByTestId("trusted-types-select");
  await expect(select).toBeVisible({ timeout: 30_000 });
  await select.selectOption(value);
  await page.getByTestId("save-btn").click();
  await expect(page.getByText(/require a server restart/i)).toBeVisible({ timeout: 30_000 });
}

test("F6: Settings → Enforce → restart enforces; Default restores report", async ({ page }) => {
  test.setTimeout(240_000);
  let saved = false;
  try {
    const initial = await documentState(page);
    expect(initial, "harness runs with the Trusted Types default (report)").toEqual({ meta: "report", enforcing: false });

    await chooseAndSave(page, "enforce");
    saved = true;
    await restart(page);
    expect(await documentState(page)).toEqual({ meta: "enforce", enforcing: true });
  } finally {
    // Restore Default (removes the key) and restart, so later specs see the harness default.
    if (saved) {
      await chooseAndSave(page, "");
      await restart(page);
    }
  }
  expect(await documentState(page)).toEqual({ meta: "report", enforcing: false });
});
