/**
 * E2E: pi-agent credential files are refused over the live harness (change: close-security-map-high-findings,
 * D1; test-plan #E43, #F7).
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the decision table and each route's refusal shape against tmp homes. Only the real server
 * in the container, with its REAL `~/.pi/agent` (the harness seeds a fake `auth.json`; this spec adds
 * `models.json` and `mcp.json`), a paired observe-tier device and the browser's editor pane shows that
 *   - `/api/file`, `/api/session-file`, `/api/pi-resource-file` and `/api/file/write-binary` all refuse a
 *     credential file (403 / never 2xx) with no credential bytes in the body, and
 *   - the editor pane, asked to open `~/.pi/agent/models.json`, shows a plain denial with NO grant remedy
 *     (no grantable subject, no Access prompt) while a skill `.md` still renders.
 *
 * The harness HOME is `/home/pi` (see `docker/test-entrypoint.sh`); `auth.json` is the seeded
 * `{"anthropic":{"type":"oauth","access":"e2e-fake",...}}`, so `e2e-fake` is the marker for that file.
 *
 * HARNESS STATE: the spec adds `models.json`, `mcp.json` and one skill file only when absent and removes
 * exactly what it created.
 */
import { execSync } from "node:child_process";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { pairDeviceBearer } from "./helpers/bridge-credential.js";
import { ensureGitSession, FIXTURE_GIT } from "./helpers/index.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

const AGENT = "/home/pi/.pi/agent";
const MARKER = "E2E-CRED-MARKER-7ac4";
const SKILL = `${AGENT}/skills/e2e-cred-refusal/SKILL.md`;
const SEEDED_AUTH_MARKER = "e2e-fake";

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}

function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

let bearer = "";
let created: string[] = [];

test.describe("agent credential refusal (L3)", () => {
  test.beforeAll(async () => {
    bearer = await pairDeviceBearer(BASE_URL);
    created = JSON.parse(
      inContainer(`
        const fs = require("node:fs");
        const made = [];
        const seed = (p, body) => {
          if (fs.existsSync(p)) return;
          fs.mkdirSync(require("node:path").dirname(p), { recursive: true });
          fs.writeFileSync(p, body);
          made.push(p);
        };
        seed(${JSON.stringify(`${AGENT}/models.json`)}, ${JSON.stringify(`{"marker":"${MARKER}-models"}`)});
        seed(${JSON.stringify(`${AGENT}/mcp.json`)}, ${JSON.stringify(`{"marker":"${MARKER}-mcp"}`)});
        seed(${JSON.stringify(SKILL)}, ${JSON.stringify(`# e2e skill\n\n${MARKER}-skill\n`)});
        process.stdout.write(JSON.stringify(made));
      `),
    ) as string[];
  });

  test.afterAll(() => {
    inContainer(`
      const fs = require("node:fs");
      for (const p of ${JSON.stringify(created)}) { try { fs.unlinkSync(p); } catch {} }
      try { fs.rmdirSync(${JSON.stringify(`${AGENT}/skills/e2e-cred-refusal`)}); } catch {}
    `);
  });

  const auth = () => ({ authorization: `Bearer ${bearer}` });
  const leaks = (body: string): boolean => body.includes(MARKER) || body.includes(SEEDED_AUTH_MARKER);

  async function sessionId(page: Page): Promise<string> {
    const card: Locator = await ensureGitSession(page);
    const id = await card.getAttribute("data-session-id");
    if (!id) throw new Error("session card has no data-session-id");
    return id;
  }

  test("#E43 every credential file is refused by the file, session-file, pi-resource-file and write-binary routes", async ({ page }) => {
    const id = await sessionId(page);
    const files = [`${AGENT}/auth.json`, `${AGENT}/models.json`, `${AGENT}/mcp.json`];
    for (const f of files) {
      const read = await page.request.get(`${BASE_URL}/api/file`, { headers: auth(), params: { cwd: FIXTURE_GIT, path: f } });
      expect(read.status(), `/api/file ${f}`).toBe(403);
      expect(leaks(await read.text()), `/api/file ${f}`).toBe(false);

      const sf = await page.request.get(`${BASE_URL}/api/session-file`, { headers: auth(), params: { sessionId: id, path: f } });
      expect(sf.status(), `/api/session-file ${f}`).toBe(403);
      expect(leaks(await sf.text()), `/api/session-file ${f}`).toBe(false);

      const pr = await page.request.get(`${BASE_URL}/api/pi-resource-file`, { headers: auth(), params: { path: f } });
      expect(pr.status(), `/api/pi-resource-file ${f}`).toBe(403);
      expect(leaks(await pr.text()), `/api/pi-resource-file ${f}`).toBe(false);

      // No claimed handler for `.json` here: the route may refuse earlier (400/403/404), never succeed or leak.
      const wb = await page.request.post(`${BASE_URL}/api/file/write-binary`, {
        headers: { ...auth(), "content-type": "application/octet-stream" },
        params: { cwd: FIXTURE_GIT, path: f, mode: "overwrite", claim: "none/none", expectSha1: "0".repeat(40) },
        data: Buffer.from("overwrite"),
      });
      expect(wb.status(), `/api/file/write-binary ${f}`).toBeGreaterThanOrEqual(400);
      expect(leaks(await wb.text()), `/api/file/write-binary ${f}`).toBe(false);
    }

    // Non-credential resources keep working through the same routes.
    const skill = await page.request.get(`${BASE_URL}/api/pi-resource-file`, { headers: auth(), params: { path: SKILL } });
    expect(skill.status()).toBe(200);
    expect(await skill.text()).toContain(`${MARKER}-skill`);
  });

  test("#F7 the editor pane shows a plain denial for models.json — no grantable subject, no Access prompt — and a skill .md still renders", async ({ page }) => {
    await page.route(/\/api\/(file|session-file)/, (route) =>
      route.continue({ headers: { ...route.request().headers(), ...auth() } }),
    );
    const id = await sessionId(page);
    const open = (file: string) =>
      page.evaluate((u) => window.history.pushState(null, "", u), `/session/${id}/editor?file=${encodeURIComponent(file)}`);

    await open(`${AGENT}/models.json`);
    const notice = page.getByTestId("denial-notice");
    await expect(notice).toBeVisible({ timeout: 15_000 });
    // A credential refusal carries no remedy: nothing to grant, nothing to ask.
    await expect(page.getByTestId("grant-dialog")).toHaveCount(0);
    await expect(page.getByTestId("grant-allow-once")).toHaveCount(0);
    await expect(page.getByTestId("grant-allow-always")).toHaveCount(0);
    await expect(page.getByTestId("split-editor-pane")).not.toContainText(MARKER);

    await open(SKILL);
    await expect(page.getByTestId("split-editor-pane")).toContainText(`${MARKER}-skill`, { timeout: 15_000 });
  });
});
