import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { gotoDashboard } from "./helpers/index.js";

// THROWAWAY diagnostic — real-spec pin flow + WS payload capture.
const ports = JSON.parse(fs.readFileSync(".pi-test-harness.json", "utf8"));
const RUN = Date.now().toString(36);

function harnessContainer(): string {
  return execFileSync(
    "docker",
    ["ps", "--filter", `publish=${ports.dashboardPort}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
}
function dsh(cmd: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", cmd], { encoding: "utf8" });
}

test("debug init convergence — real helpers", async ({ page }) => {
  test.setTimeout(120_000);
  const dir = `/fixtures/e2e-dbg2-${RUN}`;
  dsh(`rm -rf ${dir} && mkdir -p ${dir}`);

  const updates: string[] = [];
  await page.exposeFunction("dbgUpdate", (json: string) => updates.push(json));
  page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE-", m.type().toUpperCase(), ":", m.text().slice(0, 200));
  });
  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__dbgMarker = "applied:" + location.href;
    const OrigWS = window.WebSocket;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).WebSocket = function (...args: any[]) {
      console.log("WS-CTOR:", String(args[0]).slice(0, 100));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = new (OrigWS as any)(...args);
      const origSend = ws.send.bind(ws);
      ws.send = (data: string) => {
        try {
          const m = JSON.parse(data);
          console.log("WS-SEND:", String(data).slice(0, 120));
        } catch { /* ignore */ }
        return origSend(data);
      };
      ws.addEventListener("message", (ev: MessageEvent) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === "openspec_update") (window as any).dbgUpdate(JSON.stringify({ cwd: m.cwd, data: m.data }));
          if (m.type === "pinned_dirs_updated") console.log("WS-RECV pinned_dirs_updated:", JSON.stringify(m.paths ?? []).slice(0, 200));
        } catch { /* ignore */ }
      });
      return ws;
    };
  });

  await gotoDashboard(page);
  console.log("MARKER:", await page.evaluate(() => (window as any).__dbgMarker ?? "NOT-SET"));

  // ── pinAndExpand verbatim (folder spec lines 145-162) ──
  const card = page
    .locator('[data-testid="sortable-workspace-folder"], [data-testid="sortable-pinned-group"]')
    .filter({ has: page.getByTestId(`folder-home-row-${dir}`) })
    .first();
  if ((await card.count()) === 0) {
    const affordance = page
      .getByTestId("dashboard-add-folder-btn")
      .first()
      .or(page.getByTestId("onboarding-step-2-cta"));
    await expect(affordance.first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(600);
  }
  // pinDirectory verbatim (helpers 176-203)
  {
    const onboardingCta = page.getByTestId("onboarding-step-2-cta");
    if (await onboardingCta.isVisible().catch(() => false)) await onboardingCta.click();
    else await page.getByTestId("dashboard-add-folder-btn").first().click();
    const dialog = page.getByTestId("add-folders-dialog");
    await dialog.waitFor({ state: "visible" });
    const textbox = dialog.getByRole("textbox").first();
    await dialog.getByRole("option").first().waitFor({ state: "visible", timeout: 20_000 });
    await textbox.fill(dir);
    await expect(textbox).toHaveValue(dir);
    const check = dialog.getByTestId(`path-picker-check-${dir}`);
    await check.waitFor({ state: "visible", timeout: 20_000 });
    await check.click();
    const commit = dialog.getByTestId("add-folders-commit");
    await expect(commit).toBeEnabled();
    await commit.click();
    await dialog.waitFor({ state: "hidden" });
  }
  await page.waitForTimeout(2000);
  const pins = await page.evaluate(async () => (await fetch("/api/pinned-dirs")).json());
  console.log("PINS-AFTER:", JSON.stringify(pins).slice(0, 300));

  const r = await page.evaluate(async (d) => {
    const res = await fetch(`/api/openspec/init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: d }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, dir);
  console.log("INIT:", r.status, JSON.stringify(r.body).slice(0, 300));

  await page.waitForTimeout(12000);
  const mine = updates.map((u) => JSON.parse(u)).filter((u) => u.cwd === dir);
  console.log(`PAYLOADS(${mine.length}):`);
  for (const u of mine.slice(-6)) console.log("  ", JSON.stringify(u.data).slice(0, 240));
});
