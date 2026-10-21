import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { harnessContainer } from "./helpers/folder-collapse.js";
import { sendPrompt, spawnFreshGitSession } from "./helpers/index.js";

// ─────────────────────────────────────────────────────────────────────────
// improve-canvas-html-and-url-ux — L3 F5 (test-plan #F5).
//
// A loopback `canvas({target:{kind:"url", url:"http://127.0.0.1:5188/app"}})`
// declare is routed by the server to the confirm chip: NOTHING is opened and
// NOTHING is fetched until the operator taps it. The tap probes 127.0.0.1:5188
// (inside the harness container, where the agent runs), registers an in-memory
// preset target and opens it restricted at `/app`.
//
// The fixture server runs INSIDE the container (that is where the dashboard's
// loopback probe connects) and counts every request in a file.
// Faux scenario: `canvas-declare-url-loopback` (qa/fixtures/faux-scenarios.ts).
// Exemplar: tests/e2e/canvas-declare-tool.spec.ts.
// ─────────────────────────────────────────────────────────────────────────

const PORT = 5188;
const HITS = "/tmp/f5-fixture-hits";

/** Start a counting HTTP server on 127.0.0.1:PORT in the container (detached). */
function startFixtureServer(): void {
  const script = `
    const http = require("node:http");
    const fs = require("node:fs");
    fs.writeFileSync(${JSON.stringify(HITS)}, "0");
    http.createServer((req, res) => {
      fs.writeFileSync(${JSON.stringify(HITS)}, String(Number(fs.readFileSync(${JSON.stringify(HITS)}, "utf8")) + 1));
      res.setHeader("content-type", "text/html");
      res.end("<!doctype html><title>app</title><h1>fixture app</h1>");
    }).listen(${PORT}, "127.0.0.1");
  `;
  execFileSync("docker", ["exec", "-d", harnessContainer(), "node", "-e", script]);
}

function stopFixtureServer(): void {
  try {
    execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", `pkill -f "listen(${PORT}" || true`]);
  } catch {
    // best effort
  }
}

const hits = (): number =>
  Number(execFileSync("docker", ["exec", harnessContainer(), "cat", HITS], { encoding: "utf8" }).trim() || "0");

test.describe("improve-canvas-html-and-url-ux — loopback URL declare (F5)", () => {
  test.beforeAll(() => startFixtureServer());
  test.afterAll(() => stopFixtureServer());

  test("F5: the declare shows the confirm chip, opens nothing, and fetches nothing until the tap", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const card = await spawnFreshGitSession(page);
    await card.click();

    await sendPrompt(page, "[[faux:canvas-declare-url-loopback]] go");

    const chip = page.getByTestId("canvas-server-chip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText(":5188/app");
    // No editor tab was opened by the declare, and the fixture was never touched.
    await expect(page.getByTestId("live-iframe")).toHaveCount(0);
    await expect(page.getByTestId("split-editor-pane")).toHaveCount(0);
    expect(hits(), "no request may reach the declared port before the tap").toBe(0);

    // The tap probes, registers a preset and opens a restricted tab at /app.
    await chip.click();
    await expect(page.getByTestId("live-iframe")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("live-restricted-pill")).toBeVisible();
    await expect(page.getByTestId("live-address")).toHaveValue("http://127.0.0.1:5188/app");
    await expect.poll(hits, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  });
});
